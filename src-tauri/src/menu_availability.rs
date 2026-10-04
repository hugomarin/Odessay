//! ODE-632 — disponibilidad del menú nativo por modo del editor.
//!
//! El frontend es el dueño del modo y de qué acciones no tienen rama Markdown
//! (`lib/editor/shortcuts.ts`, `EDITOR_MARKDOWN_UNAVAILABLE_ACTIONS`); este
//! adapter solo habilita/deshabilita los ítems nativos que recibe. La decisión
//! (qué ids acepta el contrato y cómo se proyecta cada uno) vive aquí separada
//! del runtime de Tauri para poder probarla sin una app empaquetada.

use tauri::menu::MenuItem;
use tauri::Runtime;

/// Los ítems del menú nativo que el frontend puede declarar no disponibles.
/// Es el contrato espejo de `EDITOR_MARKDOWN_UNAVAILABLE_ACTIONS`.
pub const EDITOR_MENU_MODE_ITEM_IDS: [&str; 6] = [
    "codeBlock",
    "horizontalRule",
    "clearStyles",
    "copyAsMarkdown",
    "copyAsHtml",
    "date",
];

/// Handle mínimo de un ítem de menú, para poder doblarlo en las pruebas.
pub trait EditorMenuItemHandle {
    fn id(&self) -> &str;
    fn set_item_enabled(&self, enabled: bool) -> Result<(), String>;
}

impl<R: Runtime> EditorMenuItemHandle for MenuItem<R> {
    fn id(&self) -> &str {
        self.id().as_ref()
    }

    fn set_item_enabled(&self, enabled: bool) -> Result<(), String> {
        self.set_enabled(enabled).map_err(|error| error.to_string())
    }
}

/// Los ítems del menú nativo que el editor gobierna; viven en el estado de la
/// app para que el comando de disponibilidad los alcance.
pub struct EditorMenuItems(pub Vec<MenuItem>);

/// Valida la lista que empuja el frontend: solo ids del contrato del editor.
/// Un id desconocido es un fallo ruidoso, no un ítem que se queda habilitado.
pub fn validate_editor_menu_availability(unavailable_actions: &[String]) -> Result<(), String> {
    for action in unavailable_actions {
        if !EDITOR_MENU_MODE_ITEM_IDS.contains(&action.as_str()) {
            return Err(format!("unknown editor menu action: {action}"));
        }
    }

    Ok(())
}

/// Aplica la disponibilidad: cada ítem queda deshabilitado si el frontend lo
/// declaró no disponible y habilitado en caso contrario. La lista vacía (modo
/// Rich) restaura todos los ítems.
pub fn apply_editor_menu_availability<T: EditorMenuItemHandle>(
    items: &[T],
    unavailable_actions: &[String],
) -> Result<(), String> {
    validate_editor_menu_availability(unavailable_actions)?;

    for item in items {
        let enabled = !unavailable_actions.iter().any(|action| action == item.id());
        item.set_item_enabled(enabled)?;
    }

    Ok(())
}

/// Comando IPC: el frontend empuja la disponibilidad vigente en cada cambio de
/// modo. Si el canal falla o el menú queda desincronizado, el despacho del
/// frontend sigue siendo el dueño del modo y las seis acciones sin rama son
/// inertes en Markdown (no hay caso en su switch).
#[tauri::command]
pub fn set_editor_menu_availability(
    state: tauri::State<'_, EditorMenuItems>,
    unavailable_actions: Vec<String>,
) -> Result<(), String> {
    apply_editor_menu_availability(&state.0, &unavailable_actions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct FakeMenuItem {
        id: String,
        enabled: RefCell<bool>,
    }

    impl FakeMenuItem {
        fn new(id: &str) -> Self {
            Self {
                id: id.to_string(),
                enabled: RefCell::new(true),
            }
        }

        fn enabled(&self) -> bool {
            *self.enabled.borrow()
        }
    }

    impl EditorMenuItemHandle for FakeMenuItem {
        fn id(&self) -> &str {
            &self.id
        }

        fn set_item_enabled(&self, enabled: bool) -> Result<(), String> {
            *self.enabled.borrow_mut() = enabled;
            Ok(())
        }
    }

    fn editor_items() -> Vec<FakeMenuItem> {
        EDITOR_MENU_MODE_ITEM_IDS
            .iter()
            .map(|id| FakeMenuItem::new(id))
            .collect()
    }

    fn all_unavailable() -> Vec<String> {
        EDITOR_MENU_MODE_ITEM_IDS
            .iter()
            .map(|id| (*id).to_string())
            .collect()
    }

    fn named(items: &[FakeMenuItem], id: &str) -> &FakeMenuItem {
        items
            .iter()
            .find(|item| item.id == id)
            .unwrap_or_else(|| panic!("missing fake item {id}"))
    }

    #[test]
    fn markdown_disables_the_six_contract_items() {
        let items = editor_items();

        apply_editor_menu_availability(&items, &all_unavailable()).expect("apply");

        for id in EDITOR_MENU_MODE_ITEM_IDS {
            assert!(!named(&items, id).enabled(), "{id} should be disabled");
        }
    }

    #[test]
    fn returning_to_rich_reenables_every_item() {
        let items = editor_items();
        apply_editor_menu_availability(&items, &all_unavailable()).expect("markdown");
        assert!(items.iter().all(|item| !item.enabled()));

        apply_editor_menu_availability(&items, &[]).expect("rich");

        assert!(
            items.iter().all(|item| item.enabled()),
            "rich restores every item"
        );
    }

    #[test]
    fn a_partial_list_only_disables_the_named_item() {
        let items = editor_items();

        apply_editor_menu_availability(&items, &["date".to_string()]).expect("apply");

        assert!(!named(&items, "date").enabled());
        for id in EDITOR_MENU_MODE_ITEM_IDS.iter().filter(|id| **id != "date") {
            assert!(named(&items, id).enabled(), "{id} should stay enabled");
        }
    }

    #[test]
    fn unknown_actions_are_rejected_without_touching_any_item() {
        let items = editor_items();

        let result = apply_editor_menu_availability(&items, &["bold".to_string()]);

        assert_eq!(
            result,
            Err("unknown editor menu action: bold".to_string())
        );
        assert!(
            items.iter().all(|item| item.enabled()),
            "a rejected list must not change any item"
        );
    }
}
