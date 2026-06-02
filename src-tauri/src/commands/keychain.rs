use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "secure.dat";

#[tauri::command]
pub fn keychain_write_token(app: AppHandle, account: String, value: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(account, serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_read_token(app: AppHandle, account: String) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    match store.get(&account) {
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(_) => Ok(None),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn keychain_delete_token(app: AppHandle, account: String) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(&account);
    store.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    // Full roundtrip requires a running Tauri app (AppHandle unavailable in unit tests).
    // Verify manually via the DMG: signIn → quit → relaunch → getSession must return the session.
    #[test]
    #[ignore = "requires a running Tauri app context — verify via the DMG"]
    fn store_roundtrip_placeholder() {}
}
