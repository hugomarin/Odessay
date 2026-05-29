pub mod commands;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let new_file = MenuItem::with_id(app, "new-file", "New File", true, None::<&str>)?;
      let open_file = MenuItem::with_id(app, "open-file", "Open File...", true, Some("CmdOrCtrl+O"))?;
      let file_submenu = Submenu::with_items(app, "File", true, &[&new_file, &open_file])?;
      let menu = Menu::with_items(app, &[&file_submenu])?;
      app.set_menu(menu)?;

      app.on_menu_event(|app, event| {
        let _ = app.emit(&format!("menu:{}", event.id().as_ref()), ());
      });

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
