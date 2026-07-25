//! Growth command backed by the real Frameshift growth store.
//!
//! The desktop frontend expects a JSON string with the existing report shape,
//! so this module converts structured growth entries into that response.

use serde::{Deserialize, Serialize};

use crate::project::{make_client, project_root};

/// The frontend growth log entry shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct GrowthEntry {
    /// RFC3339 timestamp string.
    pub timestamp: String,
    /// Human-readable growth event text.
    pub event: String,
    /// Per-entry delta shown by the dashboard.
    pub delta: f32,
}

/// The frontend capability score shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct CapabilityScore {
    /// Capability identifier.
    pub capability: String,
    /// Normalized score value.
    pub score: f32,
    /// Seven-day delta value.
    pub delta_7d: f32,
}

/// The frontend growth report payload shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct GrowthReport {
    /// Persona name.
    pub persona: String,
    /// Number of log entries returned.
    pub total_sessions: u32,
    /// Aggregate token count placeholder for the current engine slice.
    pub total_tokens_processed: u64,
    /// Capability scores are not computed by the current engine slice.
    pub capability_scores: Vec<CapabilityScore>,
    /// Growth log entries rendered in the UI.
    pub log: Vec<GrowthEntry>,
}

/// Returns the growth report JSON string for the requested persona.
#[tauri::command]
pub fn get_growth(name: String) -> Result<String, String> {
    if name.is_empty() {
        return Err("persona name cannot be empty".to_string());
    }

    let client = make_client()?;
    let root = project_root(&client)?;
    let project_id = client
        .project_id(&root)
        .map_err(|error| error.to_string())?;
    let entries = frameshift_growth::recent_entries(client.data_root(), &project_id, &name, 50)
        .map_err(|error| error.to_string())?;

    let log: Vec<GrowthEntry> = entries
        .into_iter()
        .map(|entry| GrowthEntry {
            timestamp: entry.ts,
            event: entry.text,
            delta: 0.0,
        })
        .collect();

    let report = GrowthReport {
        persona: name,
        total_sessions: log.len() as u32,
        total_tokens_processed: 0,
        capability_scores: Vec::new(),
        log,
    };

    serde_json::to_string(&report).map_err(|error| error.to_string())
}
