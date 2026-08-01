//! Tauri entrypoint for the desktop runtime slice.

/// Registers the persona and growth commands that the frontend invokes.
mod commands;
/// Provides persisted desktop project selection and client helpers.
mod project;

use commands::account::{
    account_login, account_login_first_party, account_logout, account_register, account_status,
};
use commands::agent_tools::{connect_agent, get_agent_tools_status, install_agent_tools};
use commands::automate::{get_automate_settings, set_automate_settings};
use commands::growth::get_growth;
use commands::keys::{
    publisher_key_create, publisher_key_enroll, publisher_key_export, publisher_key_import,
    publisher_key_label, publisher_key_recover, publisher_key_remote_revoke, publisher_key_revoke,
    publisher_key_rotate, publisher_key_select, publisher_keys_initialize, publisher_keys_status,
};
use commands::marketplace::list_marketplace_packs;
use commands::personas::{activate_persona, active_persona, install_persona, list_personas};
use commands::settings::{get_settings, set_telemetry_opt_in};
use project::{get_project, set_project_root};

/// Runs the desktop Tauri application with the command handler table.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single-instance must be registered before every other plugin (Tauri's own
    // deep-link guidance): on Windows and Linux, clicking a `frameshift://` link
    // while the app is already running spawns a brand-new OS process instead of
    // notifying the running one, so this plugin re-exec's into the existing
    // instance and hands us the second process's argv to inspect for the link.
    // macOS/mobile deliver the URL directly to the running process via the
    // deep-link plugin's own `onOpenUrl` event, so this is a desktop Windows/
    // Linux concern only -- gated the same as the other desktop-only plugins.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        use tauri::Emitter as _;
        if let Err(error) = app.emit("single-instance", SingleInstancePayload { argv, cwd }) {
            eprintln!("frameshift desktop: emit single-instance event failed: {error}");
        }
    }));

    // The updater, process, and deep-link plugins are desktop-only; gate
    // registration so a future mobile target still compiles.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .invoke_handler(tauri::generate_handler![
            list_personas,
            active_persona,
            activate_persona,
            install_persona,
            list_marketplace_packs,
            get_growth,
            get_settings,
            set_telemetry_opt_in,
            get_project,
            set_project_root,
            get_automate_settings,
            set_automate_settings,
            get_agent_tools_status,
            install_agent_tools,
            connect_agent,
            account_status,
            account_login,
            account_login_first_party,
            account_register,
            account_logout,
            publisher_keys_status,
            publisher_keys_initialize,
            publisher_key_create,
            publisher_key_label,
            publisher_key_select,
            publisher_key_enroll,
            publisher_key_recover,
            publisher_key_rotate,
            publisher_key_revoke,
            publisher_key_remote_revoke,
            publisher_key_export,
            publisher_key_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Payload forwarded to the frontend when the single-instance plugin redirects
/// a second `frameshift://` launch into this already-running instance (the
/// Windows/Linux delivery path). The frontend re-scans `argv` for the deep
/// link URL the same way it handles the plugin's own `onOpenUrl` event.
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
struct SingleInstancePayload {
    /// Full argv of the second process invocation, including the deep-link URL.
    argv: Vec<String>,
    /// Working directory the second process was launched from.
    cwd: String,
}
