//! Tauri commands for reading and mutating desktop workspace settings.

use frameshift_client::ProjectConfig;
use serde::Serialize;

use crate::project::{make_client, project_root};

/// Serializable desktop settings payload consumed by the frontend.
#[derive(Debug, Serialize)]
pub struct DesktopSettings {
    /// Whether project telemetry sharing is enabled for the selected project.
    pub telemetry_opt_in: bool,
    /// Resolved Frameshift data directory.
    pub data_dir: String,
}

/// Load the current desktop settings from the shared project config.
#[tauri::command]
pub fn get_settings() -> Result<DesktopSettings, String> {
    let client = make_client()?;
    let root = project_root(&client)?;
    let config = client
        .project_config(&root)
        .map_err(|error| error.to_string())?;

    Ok(DesktopSettings {
        telemetry_opt_in: config.telemetry_opt_in,
        data_dir: client.data_root().display().to_string(),
    })
}

/// Persists the telemetry opt-in flag for the selected desktop project.
#[tauri::command]
pub fn set_telemetry_opt_in(enabled: bool) -> Result<(), String> {
    let client = make_client()?;
    let root = project_root(&client)?;
    let paths = client
        .project_paths(&root)
        .map_err(|error| error.to_string())?;
    let mut config = client
        .project_config(&root)
        .map_err(|error| error.to_string())?;
    config.telemetry_opt_in = enabled;
    write_project_config(&paths.config_path, &config)
}

/// Write the desktop workspace config file, creating parent directories as needed.
fn write_project_config(path: &std::path::Path, config: &ProjectConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create config dir: {error}"))?;
    }
    let raw =
        toml::to_string_pretty(config).map_err(|error| format!("serialize config: {error}"))?;
    std::fs::write(path, raw).map_err(|error| format!("write config: {error}"))
}
