//! Persona commands backed by the real Frameshift client.
//!
//! The desktop shell requires an explicit project selection, so these commands
//! resolve all state through the shared project helper.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use frameshift_client::{InstallRequest, InstallSource, Lockfile, PersonaSpec};
use frameshift_pack::PackManifest;
use serde::{Deserialize, Serialize};

use crate::project::{make_client, project_root};

/// The installed persona summary shape consumed by the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonaSummary {
    /// Persona name.
    pub name: String,
    /// Curated one-line summary from the installed pack manifest's
    /// `description` field. Blank when the manifest is missing or omits it.
    pub description: String,
    /// Resolved installed version.
    pub version: String,
    /// Whether this persona is active in the selected project.
    pub active: bool,
    /// Topical tags from the installed pack manifest's `tags` field, shown to
    /// the user as capability labels. Empty when the manifest is missing or
    /// declares no tags.
    pub capabilities: Vec<String>,
    /// RFC3339 install time from the persona directory mtime.
    pub installed_at: String,
}

/// Lists the installed personas in the selected desktop project.
#[tauri::command]
pub fn list_personas() -> Result<Vec<PersonaSummary>, String> {
    let client = make_client()?;
    let root = project_root(&client)?;

    let report = client.sync(&root).map_err(|error| error.to_string())?;
    let paths = client
        .project_paths(&root)
        .map_err(|error| error.to_string())?;

    let active = read_active_persona(&paths.active_path);
    let lockfile = read_lockfile(&paths.lock_path)?;

    let mut personas = Vec::with_capacity(report.personas.len());
    for name in report.personas {
        let version = lockfile
            .as_ref()
            .and_then(|lock| lock.personas.iter().find(|persona| persona.name == name))
            .map(|persona| persona.version.clone())
            .unwrap_or_default();

        let manifest = read_pack_manifest(&paths.personas_dir, &name);
        let description = manifest
            .as_ref()
            .and_then(|manifest| manifest.description.clone())
            .unwrap_or_default();
        let capabilities = manifest.map(|manifest| manifest.tags).unwrap_or_default();

        personas.push(PersonaSummary {
            name: name.clone(),
            description,
            version,
            active: active.as_deref() == Some(name.as_str()),
            capabilities,
            installed_at: installed_at(&paths.personas_dir.join(&name)),
        });
    }

    Ok(personas)
}

/// Returns the active persona name for the selected desktop project.
#[tauri::command]
pub fn active_persona() -> Result<Option<String>, String> {
    let client = make_client()?;
    let root = project_root(&client)?;
    let paths = client
        .project_paths(&root)
        .map_err(|error| error.to_string())?;
    Ok(read_active_persona(&paths.active_path))
}

/// Activates an installed persona inside the selected desktop project.
#[tauri::command]
pub fn activate_persona(name: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("persona name cannot be empty".to_string());
    }

    let client = make_client()?;
    let root = project_root(&client)?;
    client
        .activate(&root, &name)
        .map_err(|error| error.to_string())?;

    let session = format!("desktop:{}", std::process::id());
    if let Err(error) = client.record_selection_event(&root, &name, &session, false, None) {
        eprintln!("frameshift desktop: record_selection_event failed: {error}");
    }
    if let Err(error) = client.send_telemetry_for_persona(&root, &name, &session) {
        eprintln!("frameshift desktop: send_telemetry_for_persona failed: {error}");
    }

    Ok(())
}

/// Installs a registry pack through the shared Frameshift client.
#[tauri::command]
pub fn install_persona(name: String, version: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("persona name cannot be empty".to_string());
    }
    if version.is_empty() {
        return Err("persona version cannot be empty".to_string());
    }

    let client = make_client()?;
    let root = project_root(&client)?;
    let request = InstallRequest {
        project_root: root,
        spec: PersonaSpec { name, version },
        source: InstallSource::Registry,
    };
    client.install(request).map_err(|error| error.to_string())?;
    Ok(())
}

/// Reads the active persona file, returning `None` when it is absent or blank.
fn read_active_persona(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Reads the central lockfile when it exists.
fn read_lockfile(path: &Path) -> Result<Option<Lockfile>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => toml::from_str::<Lockfile>(&raw)
            .map(Some)
            .map_err(|error| format!("parse lockfile {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read lockfile {}: {error}", path.display())),
    }
}

/// Reads and parses the installed pack manifest for `name`, returning `None`
/// when the manifest is absent (bare local installs may omit `source/`) or
/// fails to parse. Mirrors the manifest path convention used by
/// `frameshift_client::Client::memory_requirement_status`:
/// `<personas_dir>/<name>/source/pack.toml`.
fn read_pack_manifest(personas_dir: &Path, name: &str) -> Option<PackManifest> {
    let manifest_path = personas_dir.join(name).join("source").join("pack.toml");
    match fs::read_to_string(&manifest_path) {
        Ok(raw) => match toml::from_str::<PackManifest>(&raw) {
            Ok(manifest) => Some(manifest),
            Err(error) => {
                eprintln!(
                    "frameshift desktop: failed to parse pack manifest {}: {error}",
                    manifest_path.display()
                );
                None
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            eprintln!(
                "frameshift desktop: failed to read pack manifest {}: {error}",
                manifest_path.display()
            );
            None
        }
    }
}

/// Formats the persona directory modification time as RFC3339.
fn installed_at(persona_dir: &Path) -> String {
    fs::metadata(persona_dir)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(|modified| DateTime::<Utc>::from(modified).to_rfc3339())
        .unwrap_or_default()
}
