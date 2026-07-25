//! Automate-mode commands backed by the shared orchestrator state format.

use std::path::Path;

use frameshift_client::Client;
use frameshift_orchestrator::{Mode, ModeState};
use serde::{Deserialize, Serialize};

use crate::project::{make_client, project_root};

/// Filename shared by the CLI, MCP server, daemon, and desktop mode controls.
const AUTOMATE_STATE_FILENAME: &str = "automate.json";
/// Lock marker shared by every host that can perform automatic selection.
const AUTOMATE_LOCK_FILENAME: &str = "automate-lock.json";

/// Automate preferences displayed by the desktop Settings page.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
pub struct AutomateSettings {
    /// Whether host-driven automatic persona selection is enabled.
    pub enabled: bool,
    /// Switching sensitivity from stable (`0.0`) to responsive (`1.0`).
    pub sensitivity: f32,
    /// Whether the current persona is locked against automatic switching.
    pub locked: bool,
}

/// Returns automate preferences for the selected desktop project.
#[tauri::command]
pub fn get_automate_settings() -> Result<AutomateSettings, String> {
    let client = make_client()?;
    let root = project_root(&client)?;
    load_automate_settings(&client, &root)
}

/// Persists automate mode and sensitivity for the selected desktop project.
#[tauri::command]
pub fn set_automate_settings(enabled: bool, sensitivity: f32) -> Result<AutomateSettings, String> {
    validate_sensitivity(sensitivity)?;
    let client = make_client()?;
    let root = project_root(&client)?;
    save_automate_settings(&client, &root, enabled, sensitivity)
}

/// Loads shared mode state and lock status for one project.
fn load_automate_settings(client: &Client, root: &Path) -> Result<AutomateSettings, String> {
    let state_dir = client
        .orchestrator_state_dir(root)
        .map_err(|error| error.to_string())?;
    let state = ModeState::load(&state_dir.join(AUTOMATE_STATE_FILENAME))
        .map_err(|error| error.to_string())?;
    Ok(AutomateSettings {
        enabled: state.mode == Mode::On,
        sensitivity: state.sensitivity,
        locked: state_dir.join(AUTOMATE_LOCK_FILENAME).exists(),
    })
}

/// Writes shared mode state without changing an existing persona lock.
fn save_automate_settings(
    client: &Client,
    root: &Path,
    enabled: bool,
    sensitivity: f32,
) -> Result<AutomateSettings, String> {
    validate_sensitivity(sensitivity)?;
    let state_dir = client
        .orchestrator_state_dir(root)
        .map_err(|error| error.to_string())?;
    ModeState {
        mode: if enabled { Mode::On } else { Mode::Off },
        sensitivity,
    }
    .save(&state_dir.join(AUTOMATE_STATE_FILENAME))
    .map_err(|error| error.to_string())?;
    load_automate_settings(client, root)
}

/// Rejects non-finite or out-of-range sensitivity values at the command edge.
fn validate_sensitivity(sensitivity: f32) -> Result<(), String> {
    if !sensitivity.is_finite() || !(0.0..=1.0).contains(&sensitivity) {
        return Err("Automate sensitivity must be between 0.0 and 1.0.".to_string());
    }
    Ok(())
}

/// Tests shared automate persistence in isolated project state.
#[cfg(test)]
mod tests {
    use super::*;
    use frameshift_client::ClientOptions;
    use std::fs;
    use std::path::PathBuf;

    /// Creates a unique test directory for one command-state fixture.
    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "frameshift-desktop-automate-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ))
    }

    /// Builds an isolated client whose central state stays inside the fixture.
    fn test_client(data_root: PathBuf) -> Client {
        Client::new(ClientOptions {
            data_root,
            config_root: None,
            vault: None,
        })
    }

    /// Missing state is off with balanced sensitivity and no lock.
    #[test]
    fn missing_state_uses_safe_defaults() {
        let root = test_root("missing");
        let project = root.join("project");
        fs::create_dir_all(&project).expect("create project fixture");
        let client = test_client(root.join("data"));

        let settings = load_automate_settings(&client, &project).expect("load defaults");
        assert_eq!(
            settings,
            AutomateSettings {
                enabled: false,
                sensitivity: 0.5,
                locked: false,
            }
        );

        fs::remove_dir_all(root).expect("remove test fixture");
    }

    /// Desktop writes round-trip through the orchestrator's shared mode file.
    #[test]
    fn settings_round_trip_in_shared_format() {
        let root = test_root("round-trip");
        let project = root.join("project");
        fs::create_dir_all(&project).expect("create project fixture");
        let client = test_client(root.join("data"));

        let saved =
            save_automate_settings(&client, &project, true, 0.8).expect("save automate settings");
        assert!(saved.enabled);
        assert!((saved.sensitivity - 0.8).abs() < f32::EPSILON);
        assert!(!saved.locked);

        let state_dir = client
            .orchestrator_state_dir(&project)
            .expect("resolve state dir");
        let shared = ModeState::load(&state_dir.join(AUTOMATE_STATE_FILENAME))
            .expect("load shared mode state");
        assert_eq!(shared.mode, Mode::On);
        assert!((shared.sensitivity - 0.8).abs() < f32::EPSILON);

        fs::remove_dir_all(root).expect("remove test fixture");
    }

    /// Invalid sensitivity values never reach persisted state.
    #[test]
    fn sensitivity_validation_rejects_invalid_values() {
        assert!(validate_sensitivity(-0.1).is_err());
        assert!(validate_sensitivity(1.1).is_err());
        assert!(validate_sensitivity(f32::NAN).is_err());
        assert!(validate_sensitivity(0.0).is_ok());
        assert!(validate_sensitivity(1.0).is_ok());
    }
}
