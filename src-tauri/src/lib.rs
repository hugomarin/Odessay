pub mod commands;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Restore user-granted filesystem scopes before the document watcher
        // starts; otherwise macOS asks again after every app restart.
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let settings =
                MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
            let app_menu = SubmenuBuilder::new(app, "Artifact Studio")
                .about(Some(AboutMetadata {
                    name: Some("Artifact Studio".to_string()),
                    ..Default::default()
                }))
                .separator()
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .separator()
                .quit()
                .build()?;

            // ⌘N is reserved for "New writing" (handled in the webview). The
            // on-disk "New File" flow moves to ⌘⌥N so ⌘N reaches the webview.
            let new_file =
                MenuItem::with_id(app, "new-file", "New File", true, Some("CmdOrCtrl+Alt+N"))?;
            let open_file =
                MenuItem::with_id(app, "open-file", "Open File...", true, Some("CmdOrCtrl+O"))?;
            let save_to_disk = MenuItem::with_id(
                app,
                "save-to-disk",
                "Save to Disk",
                true,
                Some("CmdOrCtrl+S"),
            )?;
            let save_as =
                MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .items(&[&new_file, &open_file])
                .separator()
                .items(&[&save_to_disk, &save_as])
                .build()?;

            let find = MenuItem::with_id(app, "find", "Find", true, Some("CmdOrCtrl+F"))?;
            let replace =
                MenuItem::with_id(app, "replace", "Replace", true, Some("CmdOrCtrl+Alt+F"))?;
            let copy_md = MenuItem::with_id(
                app,
                "copyAsMarkdown",
                "Copy as Markdown",
                true,
                None::<&str>,
            )?;
            let copy_html =
                MenuItem::with_id(app, "copyAsHtml", "Copy as HTML", true, None::<&str>)?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&find)
                .item(&replace)
                .separator()
                .item(&copy_md)
                .item(&copy_html)
                .build()?;

            let heading1 =
                MenuItem::with_id(app, "heading1", "Heading 1", true, Some("CmdOrCtrl+1"))?;
            let heading2 =
                MenuItem::with_id(app, "heading2", "Heading 2", true, Some("CmdOrCtrl+2"))?;
            let heading3 =
                MenuItem::with_id(app, "heading3", "Heading 3", true, Some("CmdOrCtrl+3"))?;
            let paragraph = MenuItem::with_id(app, "paragraph", "Body", true, Some("CmdOrCtrl+0"))?;
            let blockquote = MenuItem::with_id(
                app,
                "blockquote",
                "Blockquote",
                true,
                Some("CmdOrCtrl+Shift+B"),
            )?;
            let bullet_list =
                MenuItem::with_id(app, "bulletList", "Bullet List", true, Some("CmdOrCtrl+L"))?;
            let ordered_list = MenuItem::with_id(
                app,
                "orderedList",
                "Ordered List",
                true,
                Some("CmdOrCtrl+Shift+L"),
            )?;
            let bold = MenuItem::with_id(app, "bold", "Bold", true, Some("CmdOrCtrl+B"))?;
            let italic = MenuItem::with_id(app, "italic", "Italic", true, Some("CmdOrCtrl+I"))?;
            let strike = MenuItem::with_id(
                app,
                "strike",
                "Strikethrough",
                true,
                Some("CmdOrCtrl+Shift+X"),
            )?;
            let highlight = MenuItem::with_id(
                app,
                "highlight",
                "Highlight",
                true,
                Some("CmdOrCtrl+Shift+H"),
            )?;
            let inline_code =
                MenuItem::with_id(app, "inlineCode", "Code", true, Some("CmdOrCtrl+E"))?;
            let code_block = MenuItem::with_id(
                app,
                "codeBlock",
                "Code Block",
                true,
                Some("CmdOrCtrl+Shift+E"),
            )?;
            let link = MenuItem::with_id(app, "link", "Add Link", true, Some("CmdOrCtrl+Shift+K"))?;
            let footnote = MenuItem::with_id(
                app,
                "footnote",
                "Add Footnote",
                true,
                Some("CmdOrCtrl+Shift+A"),
            )?;
            let table = MenuItem::with_id(app, "table", "Add Table", true, Some("CmdOrCtrl+T"))?;
            let image =
                MenuItem::with_id(app, "image", "Add Image", true, Some("CmdOrCtrl+Shift+I"))?;
            let clear_styles =
                MenuItem::with_id(app, "clearStyles", "Clear Styles", true, None::<&str>)?;
            let horizontal_rule = MenuItem::with_id(
                app,
                "horizontalRule",
                "Horizontal Rule",
                true,
                Some("CmdOrCtrl+Shift+-"),
            )?;
            let date = MenuItem::with_id(app, "date", "Add Date", true, None::<&str>)?;

            let format_menu = SubmenuBuilder::new(app, "Format")
                .item(&heading1)
                .item(&heading2)
                .item(&heading3)
                .item(&paragraph)
                .separator()
                .item(&bullet_list)
                .item(&ordered_list)
                .item(&blockquote)
                .separator()
                .item(&bold)
                .item(&italic)
                .item(&strike)
                .item(&highlight)
                .item(&inline_code)
                .item(&code_block)
                .separator()
                .item(&link)
                .item(&footnote)
                .item(&table)
                .item(&image)
                .separator()
                .item(&clear_styles)
                .item(&horizontal_rule)
                .item(&date)
                .build()?;

            let focus_mode = MenuItem::with_id(
                app,
                "focusMode",
                "Focus Mode",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?;
            let toggle_sidebar =
                MenuItem::with_id(app, "toggleSidebar", "Show Library", true, None::<&str>)?;
            let toggle_topbar =
                MenuItem::with_id(app, "toggleTopbar", "Show Toolbar", true, None::<&str>)?;
            let toggle_tab_bar =
                MenuItem::with_id(app, "toggleTabBar", "Show Tab Bar", true, None::<&str>)?;
            let devtools = MenuItem::with_id(
                app,
                "openDevtools",
                "Open DevTools",
                true,
                Some("Alt+CmdOrCtrl+I"),
            )?;
            let shortcut_help = MenuItem::with_id(
                app,
                "shortcutHelp",
                "Keyboard Shortcuts",
                true,
                Some("CmdOrCtrl+/"),
            )?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&focus_mode)
                .separator()
                .item(&toggle_sidebar)
                .item(&toggle_topbar)
                .item(&toggle_tab_bar)
                .separator()
                .item(&devtools)
                .separator()
                .fullscreen()
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&shortcut_help)
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &format_menu,
                    &view_menu,
                    &window_menu,
                    &help_menu,
                ])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "openDevtools" {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                    return;
                }
                let _ = app.emit(&format!("menu:{}", event.id().as_ref()), ());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::document::open_file,
            commands::document::allow_watch_path,
            commands::document::create_file,
            commands::document::write_file,
            commands::document::write_binary_file,
            commands::document::rename_file,
            commands::document::relocate_file,
            commands::document::list_recent_files,
            commands::document::resolve_asset_path,
            commands::document::read_local_image_asset,
            commands::index::catalog_schema_version,
            commands::index::catalog_dual_write,
            commands::index::catalog_bulk_dual_write,
            commands::index::catalog_count_binding_root_documents,
            commands::index::catalog_list_binding_root_documents,
            commands::index::catalog_apply_workspace_removal,
            commands::index::catalog_list_retired_binding_roots,
            commands::index::catalog_activate_binding_root,
            commands::index::catalog_reactivate_binding_root,
            commands::index::catalog_apply_cloud_snapshots,
            commands::index::catalog_find_eligible_cloud_hash,
            commands::index::catalog_get_by_id,
            commands::index::catalog_resolve_path,
            commands::index::catalog_list,
            commands::index::catalog_hydrate_excerpts,
            commands::index::catalog_detach_local_file,
            commands::index::catalog_purge_document,
            commands::index::catalog_prune_synced_mutations,
            commands::index::catalog_apply_reconcile,
            commands::index::catalog_update_mutation_status,
            commands::index::catalog_enqueue_mutation,
            commands::index::catalog_list_pending_mutations,
            commands::index::catalog_apply_collection_snapshot,
            commands::index::catalog_list_collection_snapshot,
            commands::index::catalog_save_collection,
            commands::index::catalog_delete_collection,
            commands::index::catalog_replace_writing_collections,
            commands::index::catalog_list_pending_metadata_mutations,
            commands::index::catalog_update_metadata_mutation_status,
            commands::keychain::keychain_write_token,
            commands::keychain::keychain_read_token,
            commands::keychain::keychain_delete_token,
            commands::settings::settings_read,
            commands::settings::settings_write,
            commands::settings::settings_delete,
            commands::settings::settings_list_keys,
            commands::workspace::workspace_create,
            commands::workspace::workspace_agent_validate_path,
            commands::workspace::workspace_inspect,
            commands::workspace::workspace_repair_manifest_bindings,
            commands::workspace::workspace_unbound_paths,
            commands::workspace::workspace_sync,
            commands::workspace::workspace_touch_file,
            commands::workspace::workspace_compute_content_hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
