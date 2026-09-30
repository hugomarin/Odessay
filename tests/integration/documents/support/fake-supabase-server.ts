import { randomUUID } from "node:crypto"

/**
 * Fake de Supabase: la frontera externa de red de `desktopCatalogSyncService`.
 *
 * Reemplaza al cliente real (`@/lib/supabase/desktop-client`) con un servidor
 * en memoria que:
 *
 * - aplica última-escritura-gana (update fusiona el patch; insert reemplaza);
 * - responde como PostgREST: `{ error, count }`, con `count: "exact"` = filas
 *   afectadas, `0` sin error cuando un UPDATE/DELETE no matchea, y
 *   `code: "23505"` en un insert duplicado (la ruta de convergencia de
 *   `insertVerified`, `desktop-catalog-sync-service.ts:197-204`);
 * - registra cada write emitido, en orden, para poder afirmar "esto es lo que
 *   llegó a la nube" sin espiar el transporte;
 * - permite retener la respuesta del próximo write (ventana de flush en vuelo)
 *   y forzar fallos one-shot o permanentes — el montaje que ODE-612
 *   (SYNC-03 desktop) reutiliza para el fallo reintentable y terminal.
 *
 * Solo cubre las formas de llamada que `desktopCatalogSyncService` usa hoy
 * (auth.getSession; writings insert/update/delete/select; collections upsert/
 * delete/select; writing_collections delete/insert/select), aceptando las
 * mismas cadenas `.eq()`/`.not()`/`.maybeSingle()` de supabase-js v2.
 */
export type FakeSupabaseError = { message: string; code?: string }

export type FakeSupabaseWriteKind = "insert" | "update" | "delete" | "upsert"

export type FakeSupabaseWrite = {
  table: string
  kind: FakeSupabaseWriteKind
  /** Copia del payload emitido (row para insert/upsert, patch para update). */
  payload: Record<string, unknown> | Array<Record<string, unknown>>
  /** Condiciones de la cadena `.eq()`/`.not()`, como las recibió el fake. */
  conditions: Array<{ column: string; operator: "eq" | "not-is-null"; value?: unknown }>
  /** Filas que la operación afectó (PostgREST `count: "exact"`), 0 si falló. */
  matched: number
  error: FakeSupabaseError | null
}

type Row = Record<string, unknown>

type PendingCondition = { column: string; operator: "eq" | "not-is-null"; value?: unknown }

type QueryResult = { data: unknown; error: FakeSupabaseError | null; count: number | null }

function conditionMatches(row: Row, condition: PendingCondition): boolean {
  if (condition.operator === "not-is-null") {
    return row[condition.column] !== null && row[condition.column] !== undefined
  }
  return row[condition.column] === condition.value
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  private conditions: PendingCondition[] = []

  constructor(
    private readonly server: FakeSupabaseServer,
    private readonly table: string,
    private readonly kind: "select" | FakeSupabaseWriteKind,
    private readonly payload?: Row | Row[],
    private readonly options?: Record<string, unknown>,
    private readonly columns?: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.conditions.push({ column, operator: "eq", value })
    return this
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.conditions.push({ column, operator: "not-is-null" })
    }
    return this
  }

  /** Cadena real de supabase-js: `.select()` sobre un builder solo fija columnas. */
  select(columns?: string): this {
    return new FakeQueryBuilder(this.server, this.table, this.kind, this.payload, this.options, columns ?? this.columns) as this
  }

  maybeSingle(): Promise<QueryResult> {
    return this.server.executeSelect(this.table, this.conditions, true, this.columns)
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const pending =
      this.kind === "select"
        ? this.server.executeSelect(this.table, this.conditions, false, this.columns)
        : this.server.executeWrite(this.table, this.kind, this.payload ?? {}, this.conditions, this.options)
    return pending.then(onfulfilled, onrejected)
  }
}

/** `from(table)` como lo expone supabase-js: un selector con las operaciones de tabla. */
class FakeTableClient {
  constructor(
    private readonly server: FakeSupabaseServer,
    private readonly table: string,
  ) {}

  select(columns?: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this.server, this.table, "select", undefined, undefined, columns)
  }

  insert(payload: Row | Row[], options?: Record<string, unknown>): FakeQueryBuilder {
    return new FakeQueryBuilder(this.server, this.table, "insert", payload, options)
  }

  update(payload: Row, options?: Record<string, unknown>): FakeQueryBuilder {
    return new FakeQueryBuilder(this.server, this.table, "update", payload, options)
  }

  delete(options?: Record<string, unknown>): FakeQueryBuilder {
    return new FakeQueryBuilder(this.server, this.table, "delete", {}, options)
  }

  upsert(payload: Row | Row[], options?: Record<string, unknown>): FakeQueryBuilder {
    return new FakeQueryBuilder(this.server, this.table, "upsert", payload, options)
  }
}

type Hold = { gate: Promise<void>; release: () => void; arrived: () => void; started: Promise<void> }

export class FakeSupabaseServer {
  private readonly tables = new Map<string, Map<string, Row>>()
  private readonly writes: FakeSupabaseWrite[] = []
  private sessionUserId: string | null = "user-1"
  private oneShotFailure: FakeSupabaseError | null = null
  private stickyFailure: FakeSupabaseError | null = null
  private hold: Hold | null = null

  reset(): void {
    this.tables.clear()
    this.writes.length = 0
    this.sessionUserId = "user-1"
    this.oneShotFailure = null
    this.stickyFailure = null
    this.hold = null
  }

  setSessionUserId(userId: string | null): void {
    this.sessionUserId = userId
  }

  /** El próximo write responde con este error y no aplica nada; después el fake se recupera. */
  failNextWrite(error: FakeSupabaseError): void {
    this.oneShotFailure = error
  }

  /** Todos los writes fallan con este error hasta `clearFailures()`. */
  failAllWrites(error: FakeSupabaseError): void {
    this.stickyFailure = error
  }

  clearFailures(): void {
    this.oneShotFailure = null
    this.stickyFailure = null
  }

  /**
   * Retiene la respuesta del próximo write hasta `release()`: el payload ya
   * llegó al servidor (`received` lo registra), pero el llamador no recibe
   * respuesta — la ventana exacta de "sync en vuelo" que SYNC-05 necesita.
   * `started` resuelve cuando el write retenido llegó.
   */
  holdNextWrite(): { started: Promise<void>; release: () => void } {
    let release!: () => void
    let arrived!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      arrived = resolve
    })
    this.hold = { gate, release, arrived, started }
    return { started, release }
  }

  /** Todos los writes emitidos, en orden. La aserción "qué llegó a la nube" se hace aquí. */
  get received(): ReadonlyArray<FakeSupabaseWrite> {
    return this.writes.map((write) => ({ ...write, payload: structuredClone(write.payload) }))
  }

  /** Fila actual de una tabla (última escritura ganó), o null. */
  row(table: string, id: string): Row | null {
    const row = this.tables.get(table)?.get(id)
    return row ? structuredClone(row) : null
  }

  private rowsFor(table: string): Map<string, Row> {
    let rows = this.tables.get(table)
    if (!rows) {
      rows = new Map()
      this.tables.set(table, rows)
    }
    return rows
  }

  private async waitForResponse(): Promise<FakeSupabaseError | null> {
    const hold = this.hold
    if (hold) {
      this.hold = null
      hold.arrived()
      await hold.gate
    }
    if (this.oneShotFailure) {
      const failure = this.oneShotFailure
      this.oneShotFailure = null
      return failure
    }
    return this.stickyFailure
  }

  async executeWrite(
    table: string,
    kind: FakeSupabaseWriteKind,
    payload: Row | Row[],
    conditions: PendingCondition[],
    _options?: Record<string, unknown>,
  ): Promise<QueryResult> {
    const failure = await this.waitForResponse()
    const rows = this.rowsFor(table)
    let matched = 0
    if (failure) {
      this.writes.push({ table, kind, payload: structuredClone(payload), conditions: [...conditions], matched: 0, error: failure })
      return { data: null, error: failure, count: null }
    }

    if (kind === "insert") {
      const inserted = Array.isArray(payload) ? payload : [payload]
      for (const row of inserted) {
        const id = typeof row.id === "string" ? row.id : randomUUID()
        if (rows.has(id)) {
          const error = { message: `duplicate key value violates unique constraint "${table}_pkey"`, code: "23505" }
          this.writes.push({ table, kind, payload: structuredClone(payload), conditions: [...conditions], matched: 0, error })
          return { data: null, error, count: null }
        }
        rows.set(id, structuredClone(row))
        matched += 1
      }
      this.writes.push({ table, kind, payload: structuredClone(payload), conditions: [...conditions], matched, error: null })
      return { data: null, error: null, count: matched }
    }

    if (kind === "upsert") {
      const upserted = Array.isArray(payload) ? payload : [payload]
      for (const row of upserted) {
        const id = typeof row.id === "string" ? row.id : randomUUID()
        rows.set(id, { ...(rows.get(id) ?? {}), ...structuredClone(row) })
        matched += 1
      }
      this.writes.push({ table, kind, payload: structuredClone(payload), conditions: [...conditions], matched, error: null })
      return { data: null, error: null, count: matched }
    }

    if (kind === "update") {
      const patch = payload as Row
      for (const [id, row] of [...rows.entries()]) {
        if (!conditions.every((condition) => conditionMatches(row, condition))) continue
        rows.set(id, { ...row, ...structuredClone(patch) })
        matched += 1
      }
      this.writes.push({ table, kind, payload: structuredClone(patch), conditions: [...conditions], matched, error: null })
      return { data: null, error: null, count: matched }
    }

    for (const [id, row] of [...rows.entries()]) {
      if (!conditions.every((condition) => conditionMatches(row, condition))) continue
      rows.delete(id)
      matched += 1
    }
    this.writes.push({ table, kind, payload: structuredClone(payload), conditions: [...conditions], matched, error: null })
    return { data: null, error: null, count: matched }
  }

  async executeSelect(
    table: string,
    conditions: PendingCondition[],
    single: boolean,
    _columns?: string,
  ): Promise<QueryResult> {
    const rows = [...this.rowsFor(table).values()].filter((row) =>
      conditions.every((condition) => conditionMatches(row, condition)),
    )
    const data = single ? (rows[0] ?? null) : rows
    return { data: structuredClone(data), error: null, count: null }
  }

  /** Cliente con la misma superficie que `createDesktopClient()` usa el servicio. */
  client(): {
    auth: { getSession: () => Promise<{ data: { session: { user: { id: string } } | null }; error: null }> }
    from: (table: string) => FakeTableClient
  } {
    return {
      auth: {
        getSession: async () => ({
          data: { session: this.sessionUserId ? { user: { id: this.sessionUserId } } : null },
          error: null,
        }),
      },
      from: (table: string) => new FakeTableClient(this, table),
    }
  }
}

/** Instancia única por archivo de prueba; `reset()` en el `beforeEach`. */
export const fakeSupabase = new FakeSupabaseServer()

export const fakeSupabaseClient = fakeSupabase.client()
