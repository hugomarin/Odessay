use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

fn settings_file_path(config_dir: &str) -> String {
    Path::new(config_dir)
        .join("odessay-settings.json")
        .to_string_lossy()
        .to_string()
}

fn read_store(config_dir: &str) -> Result<HashMap<String, Value>, String> {
    let path = settings_file_path(config_dir);
    if !Path::new(&path).exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read_settings file: {e}"))?;
    let store: HashMap<String, Value> =
        serde_json::from_str(&content).map_err(|e| format!("read_settings parse: {e}"))?;
    Ok(store)
}

fn write_store(config_dir: &str, store: &HashMap<String, Value>) -> Result<(), String> {
    let path = settings_file_path(config_dir);
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("write_settings mkdir: {e}"))?;
        }
    }
    let content =
        serde_json::to_string_pretty(store).map_err(|e| format!("write_settings serialize: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("write_settings file: {e}"))?;
    Ok(())
}

/// Read a single setting value by key. Returns null JSON if absent.
#[tauri::command]
pub fn settings_read(config_dir: String, key: String) -> Result<String, String> {
    let store = read_store(&config_dir)?;
    match store.get(&key) {
        Some(value) => serde_json::to_string(value).map_err(|e| format!("settings_read: {e}")),
        None => Ok("null".to_string()),
    }
}

/// Write a setting value (JSON string) for the given key.
#[tauri::command]
pub fn settings_write(
    config_dir: String,
    key: String,
    value_json: String,
) -> Result<(), String> {
    let mut store = read_store(&config_dir)?;
    let value: Value =
        serde_json::from_str(&value_json).map_err(|e| format!("settings_write parse: {e}"))?;
    store.insert(key, value);
    write_store(&config_dir, &store)
}

/// Delete a setting key. No-op if absent.
#[tauri::command]
pub fn settings_delete(config_dir: String, key: String) -> Result<(), String> {
    let mut store = read_store(&config_dir)?;
    store.remove(&key);
    write_store(&config_dir, &store)
}

/// List all setting keys.
#[tauri::command]
pub fn settings_list_keys(config_dir: String) -> Result<Vec<String>, String> {
    let store = read_store(&config_dir)?;
    Ok(store.keys().cloned().collect())
}
