export type DriftOk = { ok: true; version: string }
export type DriftFail = { ok: false; pkg: string; tauri: string }
export type DriftResult = DriftOk | DriftFail

export declare function checkVersionDrift(root?: string): DriftResult
