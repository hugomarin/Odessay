pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::document::open_file,
      commands::document::create_file,
      commands::document::write_file,
      commands::document::rename_file,
      commands::document::list_recent_files,
      commands::document::resolve_asset_path,
      commands::index::index_upsert,
      commands::index::index_list,
      commands::index::index_delete,
      commands::index::index_rebuild,
      commands::settings::settings_read,
      commands::settings::settings_write,
      commands::settings::settings_delete,
      commands::settings::settings_list_keys,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
