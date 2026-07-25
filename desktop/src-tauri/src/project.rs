//! Persisted project selection helpers for the Tauri runtime.
//!
//! Every Frameshift operation is project-scoped. The desktop shell therefore
//! requires an explicit user-selected directory before persona commands run.

use std::fs;
use std::path::{Path, PathBuf};

use frameshift_client::Client;
use serde::{Deserialize, Serialize};

/// Filename used for desktop-only preferences under the Frameshift data root.
const DESKTOP_CONFIG_FILENAME: &str = "desktop.json";

/// Desktop-only preferences persisted between application launches.
#[derive(Debug, Default, Deserialize, Serialize)]
struct DesktopConfig {
    /// Canonical project directory selected by the user.
    project_root: Option<PathBuf>,
}

/// Serializable project selection consumed by the frontend shell.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DesktopProject {
    /// Canonical absolute path, or `None` before first-run setup.
    pub path: Option<String>,
    /// Human-readable final path component shown in the sidebar.
    pub name: Option<String>,
}

/// Builds a Frameshift client using the default data root resolution.
pub fn make_client() -> Result<Client, String> {
    Client::with_default_data_root().map_err(|error| error.to_string())
}

/// Returns the currently selected project for the desktop shell.
#[tauri::command]
pub fn get_project() -> Result<DesktopProject, String> {
    let client = make_client()?;
    selected_project(client.data_root())
}

/// Validates and persists a project directory selected by the user.
#[tauri::command]
pub fn set_project_root(path: String) -> Result<DesktopProject, String> {
    let client = make_client()?;
    let canonical = validate_project_root(Path::new(&path))?;
    write_desktop_config(
        client.data_root(),
        &DesktopConfig {
            project_root: Some(canonical),
        },
    )?;
    selected_project(client.data_root())
}

/// Returns the configured project root or an actionable first-run error.
pub fn project_root(client: &Client) -> Result<PathBuf, String> {
    let config = read_desktop_config(client.data_root())?;
    let path = config.project_root.ok_or_else(|| {
        "Choose a project folder in FrameShift before using personas.".to_string()
    })?;
    validate_project_root(&path)
}

/// Loads the persisted project and converts it to the frontend payload.
fn selected_project(data_root: &Path) -> Result<DesktopProject, String> {
    let config = read_desktop_config(data_root)?;
    let Some(path) = config.project_root else {
        return Ok(DesktopProject {
            path: None,
            name: None,
        });
    };
    let canonical = validate_project_root(&path)?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .or_else(|| Some(canonical.display().to_string()));

    Ok(DesktopProject {
        path: Some(canonical.display().to_string()),
        name,
    })
}

/// Reads desktop preferences, treating an absent file as first-run state.
fn read_desktop_config(data_root: &Path) -> Result<DesktopConfig, String> {
    let path = data_root.join(DESKTOP_CONFIG_FILENAME);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("read desktop settings {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DesktopConfig::default()),
        Err(error) => Err(format!("read desktop settings {}: {error}", path.display())),
    }
}

/// Writes desktop preferences after ensuring the data directory exists.
fn write_desktop_config(data_root: &Path, config: &DesktopConfig) -> Result<(), String> {
    fs::create_dir_all(data_root)
        .map_err(|error| format!("create desktop settings directory: {error}"))?;
    let path = data_root.join(DESKTOP_CONFIG_FILENAME);
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("serialize desktop settings: {error}"))?;
    fs::write(&path, raw)
        .map_err(|error| format!("write desktop settings {}: {error}", path.display()))
}

/// Requires an existing absolute directory and returns its canonical path.
fn validate_project_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Project folder must be an absolute path.".to_string());
    }
    if !path.is_dir() {
        return Err(format!(
            "Project folder does not exist or is not a directory: {}",
            path.display()
        ));
    }
    fs::canonicalize(path)
        .map_err(|error| format!("resolve project folder {}: {error}", path.display()))
}

/// Tests project selection persistence and validation in isolated directories.
#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a unique test directory without adding a test-only dependency.
    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "frameshift-desktop-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ))
    }

    /// Missing preferences produce an unconfigured first-run payload.
    #[test]
    fn missing_config_returns_unconfigured_project() {
        let data_root = test_root("missing");
        let project = selected_project(&data_root).expect("read missing config");
        assert_eq!(
            project,
            DesktopProject {
                path: None,
                name: None
            }
        );
    }

    /// Persisted project paths round-trip as canonical absolute directories.
    #[test]
    fn project_selection_round_trips() {
        let root = test_root("round-trip");
        let data_root = root.join("data");
        let project_root = root.join("project-fixture");
        fs::create_dir_all(&project_root).expect("create project");

        write_desktop_config(
            &data_root,
            &DesktopConfig {
                project_root: Some(project_root.clone()),
            },
        )
        .expect("write config");

        let selected = selected_project(&data_root).expect("read selection");
        assert_eq!(selected.name.as_deref(), Some("project-fixture"));
        assert_eq!(selected.path, Some(project_root.display().to_string()));

        fs::remove_dir_all(root).expect("remove test directory");
    }

    /// Relative and missing paths are rejected before persistence.
    #[test]
    fn invalid_project_paths_are_rejected() {
        assert!(validate_project_root(Path::new("relative-project")).is_err());
        let missing = test_root("absent");
        assert!(validate_project_root(&missing).is_err());
    }
}
