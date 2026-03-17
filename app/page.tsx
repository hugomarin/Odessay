import { createClient } from "@/utils/supabase/server";

type Todo = {
  id: string | number;
  name: string;
};

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("todos")
    .select("id, name")
    .order("id", { ascending: true })
    .limit(20);

  const todos = (data ?? []) as Todo[];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 bg-background px-6 py-16 text-foreground">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Odessay + Supabase</h1>
        <p className="text-sm text-muted-foreground">
          Lectura SSR de ejemplo sobre la tabla <code>todos</code>.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border-[0.5px] border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Error consultando <code>todos</code>: {error.message}
        </div>
      ) : null}

      <ul className="space-y-2">
        {todos.map((todo) => (
          <li key={todo.id} className="rounded-md border-[0.5px] border-border bg-card p-3">
            {todo.name}
          </li>
        ))}
      </ul>

      {!error && todos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin filas en <code>todos</code> todavía.
        </p>
      ) : null}
    </main>
  );
}
