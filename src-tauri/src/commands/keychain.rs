use keyring::Entry;

const SERVICE: &str = "Odessay";

#[tauri::command]
pub fn keychain_write_token(account: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_read_token(account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn keychain_delete_token(account: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Full Keychain read-write requires a signed app with proper entitlements.
    // This test is verified manually via the DMG (signIn → restart → getSession).
    #[test]
    #[ignore = "requires macOS Keychain access — run inside the DMG, not via cargo test"]
    fn keychain_roundtrip() {
        let account = "test-ode-219-roundtrip".to_string();
        let value = r#"{"access_token":"tok_test","refresh_token":"ref_test"}"#.to_string();

        keychain_write_token(account.clone(), value.clone()).expect("write should succeed");
        let read = keychain_read_token(account.clone())
            .expect("read should succeed")
            .expect("value should be present");
        assert_eq!(read, value);

        keychain_delete_token(account.clone()).expect("delete should succeed");
        let after_delete = keychain_read_token(account).expect("read after delete should succeed");
        assert!(after_delete.is_none());
    }

    #[test]
    fn keychain_delete_missing_is_idempotent() {
        let account = "test-ode-219-nonexistent-key".to_string();
        let _ = keychain_delete_token(account.clone());
        keychain_delete_token(account).expect("deleting missing entry should not error");
    }
}
