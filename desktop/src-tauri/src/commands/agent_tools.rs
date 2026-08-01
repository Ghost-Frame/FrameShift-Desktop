//! Installs bundled FrameShift tools and connects supported agent hosts.

use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::Serialize;
use tauri::{AppHandle, Manager as _};

use crate::project::{make_client, project_root};

/// Maximum command output retained in an error returned to the frontend.
const MAX_COMMAND_OUTPUT_BYTES: usize = 4_096;

/// Supported agent hosts that expose an MCP registration command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentTarget {
    /// OpenAI Codex CLI.
    Codex,
    /// Anthropic Claude Code CLI.
    Claude,
    /// Google Gemini CLI.
    Gemini,
}

/// Status of the CLI and MCP tools shipped inside the desktop bundle.
#[derive(Debug, Serialize)]
pub struct AgentToolsStatus {
    /// FrameShift core version included with this desktop release.
    version: Option<String>,
    /// Exact FrameShift core Git revision included with this desktop release.
    revision: Option<String>,
    /// Whether this build contains both required tool binaries.
    bundled: bool,
    /// Whether both tools have been copied to stable app storage.
    installed: bool,
    /// Stable install directory, when the bundled version is available.
    install_dir: Option<String>,
    /// Installed MCP executable path, when installation is complete.
    mcp_path: Option<String>,
}

/// Result returned after an agent host accepts its MCP registration.
#[derive(Debug, Serialize)]
pub struct AgentConnection {
    /// Agent host configured by the command.
    target: String,
    /// Human-readable success detail from FrameShift.
    message: String,
    /// Absolute MCP executable path registered with the host.
    mcp_path: String,
}

/// Paths for the tools packaged into the running application.
#[derive(Debug)]
struct BundledTools {
    /// Bundled FrameShift core version.
    version: String,
    /// Exact bundled FrameShift core Git revision.
    revision: String,
    /// Source CLI executable inside the app bundle.
    cli: PathBuf,
    /// Source MCP executable inside the app bundle.
    mcp: PathBuf,
}

/// Paths for the tools copied into stable per-user application storage.
#[derive(Debug)]
struct InstalledTools {
    /// Stable CLI executable path.
    cli: PathBuf,
    /// Stable MCP executable path.
    mcp: PathBuf,
    /// Stable versioned install directory.
    directory: PathBuf,
}

/// Returns the current bundled-tool installation state.
#[tauri::command]
pub fn get_agent_tools_status(app: AppHandle) -> Result<AgentToolsStatus, String> {
    let Some(bundled) = bundled_tools(&app)? else {
        return Ok(AgentToolsStatus {
            version: None,
            revision: None,
            bundled: false,
            installed: false,
            install_dir: None,
            mcp_path: None,
        });
    };
    let installed = installed_tools(&app, &bundled.version, &bundled.revision)?;
    let is_installed = installed.cli.is_file()
        && installed.mcp.is_file()
        && files_equal(&bundled.cli, &installed.cli)?
        && files_equal(&bundled.mcp, &installed.mcp)?;

    Ok(AgentToolsStatus {
        version: Some(bundled.version),
        revision: Some(bundled.revision),
        bundled: true,
        installed: is_installed,
        install_dir: Some(installed.directory.display().to_string()),
        mcp_path: is_installed.then(|| installed.mcp.display().to_string()),
    })
}

/// Copies bundled CLI and MCP binaries into stable per-user storage.
#[tauri::command]
pub fn install_agent_tools(app: AppHandle) -> Result<AgentToolsStatus, String> {
    let bundled = bundled_tools(&app)?.ok_or_else(|| {
        "This development build does not include the FrameShift agent tools.".to_string()
    })?;
    let installed = installed_tools(&app, &bundled.version, &bundled.revision)?;
    fs::create_dir_all(&installed.directory).map_err(|error| {
        format!(
            "create agent tools directory {}: {error}",
            installed.directory.display()
        )
    })?;
    install_file(&bundled.cli, &installed.cli)?;
    install_file(&bundled.mcp, &installed.mcp)?;

    get_agent_tools_status(app)
}

/// Installs the bundled tools and registers FrameShift with one agent host.
#[tauri::command]
pub fn connect_agent(app: AppHandle, target: String) -> Result<AgentConnection, String> {
    let target = AgentTarget::parse(&target)?;
    let status = install_agent_tools(app.clone())?;
    let mcp_path = status
        .mcp_path
        .map(PathBuf::from)
        .ok_or_else(|| "FrameShift MCP installation did not produce an executable.".to_string())?;
    let client = make_client()?;
    let project = project_root(&client)?;
    let output = run_agent_registration(target, &project, &mcp_path)?;
    if !output.status.success() {
        return Err(format_command_failure(target, &output));
    }

    Ok(AgentConnection {
        target: target.as_str().to_string(),
        message: format!(
            "FrameShift is connected to {} for {}.",
            target.display_name(),
            project.display()
        ),
        mcp_path: mcp_path.display().to_string(),
    })
}

/// Parses a frontend target identifier into a supported host.
impl AgentTarget {
    /// Accepts only the three explicitly supported agent CLIs.
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            "gemini" => Ok(Self::Gemini),
            _ => Err(format!("Unsupported agent host: {value}")),
        }
    }

    /// Returns the executable name used to launch the host CLI.
    fn executable(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }

    /// Returns the stable identifier passed to FrameShift MCP.
    fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }

    /// Returns the human-facing host name used in status messages.
    fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude Code",
            Self::Gemini => "Gemini CLI",
        }
    }

    /// Builds the exact MCP registration arguments without invoking a shell.
    fn registration_args(self, project: &Path, mcp_path: &Path) -> Vec<String> {
        let target_env = format!("FRAMESHIFT_TARGET={}", self.as_str());
        let project_env = format!("FRAMESHIFT_PROJECT_ROOT={}", project.display());
        let mcp = mcp_path.display().to_string();
        match self {
            Self::Codex => vec![
                "mcp".into(),
                "add".into(),
                "frameshift".into(),
                "--env".into(),
                target_env,
                "--env".into(),
                project_env,
                "--".into(),
                mcp,
            ],
            Self::Claude => vec![
                "mcp".into(),
                "add".into(),
                "--scope".into(),
                "local".into(),
                "--transport".into(),
                "stdio".into(),
                "--env".into(),
                target_env,
                "--env".into(),
                project_env,
                "frameshift".into(),
                "--".into(),
                mcp,
            ],
            Self::Gemini => vec![
                "mcp".into(),
                "add".into(),
                "--scope".into(),
                "project".into(),
                "--env".into(),
                target_env,
                "--env".into(),
                project_env,
                "frameshift".into(),
                mcp,
            ],
        }
    }
}

/// Locates and validates the binaries embedded by the release workflow.
fn bundled_tools(app: &AppHandle) -> Result<Option<BundledTools>, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve application resources: {error}"))?
        .join("resources")
        .join("tools");
    let version_path = root.join("version.txt");
    if !version_path.is_file() {
        return Ok(None);
    }
    let version = fs::read_to_string(&version_path)
        .map_err(|error| format!("read bundled tool version: {error}"))?
        .trim()
        .to_string();
    validate_version(&version)?;
    let revision = fs::read_to_string(root.join("revision.txt"))
        .map_err(|error| format!("read bundled tool revision: {error}"))?
        .trim()
        .to_string();
    validate_revision(&revision)?;
    let cli = root.join(executable_name("frameshift"));
    let mcp = root.join(executable_name("frameshift-mcp"));
    if !cli.is_file() || !mcp.is_file() {
        return Err("Desktop bundle is missing a required FrameShift tool.".to_string());
    }
    Ok(Some(BundledTools {
        version,
        revision,
        cli,
        mcp,
    }))
}

/// Resolves the immutable install paths for one bundled core build.
fn installed_tools(
    app: &AppHandle,
    version: &str,
    revision: &str,
) -> Result<InstalledTools, String> {
    let data_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?;
    let directory = install_directory(&data_root, version, revision);
    Ok(InstalledTools {
        cli: directory.join(executable_name("frameshift")),
        mcp: directory.join(executable_name("frameshift-mcp")),
        directory,
    })
}

/// Builds a stable install directory from the semantic version and exact revision.
fn install_directory(data_root: &Path, version: &str, revision: &str) -> PathBuf {
    data_root.join("agent-tools").join(version).join(revision)
}

/// Adds the platform executable suffix when required.
fn executable_name(base: &str) -> String {
    format!("{base}{}", std::env::consts::EXE_SUFFIX)
}

/// Rejects unsafe version strings before using them as a path component.
fn validate_version(version: &str) -> Result<(), String> {
    if version.is_empty()
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err("Bundled FrameShift version is invalid.".to_string());
    }
    Ok(())
}

/// Requires the full hexadecimal Git object ID emitted by release packaging.
fn validate_revision(revision: &str) -> Result<(), String> {
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Bundled FrameShift revision is invalid.".to_string());
    }
    Ok(())
}

/// Copies one immutable bundled file without overwriting a changed destination.
fn install_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.is_file() {
        if files_equal(source, destination)? {
            return Ok(());
        }
        return Err(format!(
            "Installed tool differs from this release: {}",
            destination.display()
        ));
    }
    let temporary = destination.with_extension(format!("installing-{}", std::process::id()));
    if temporary.exists() {
        return Err(format!(
            "A prior installation did not finish: {}",
            temporary.display()
        ));
    }
    fs::copy(source, &temporary)
        .map_err(|error| format!("copy bundled tool {}: {error}", source.display()))?;
    set_executable_permissions(&temporary)?;
    fs::rename(&temporary, destination)
        .map_err(|error| format!("activate installed tool {}: {error}", destination.display()))?;
    if !files_equal(source, destination)? {
        return Err(format!(
            "Installed tool verification failed: {}",
            destination.display()
        ));
    }
    Ok(())
}

/// Compares two files byte-for-byte without loading an executable into memory.
fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = fs::metadata(left)
        .map_err(|error| format!("inspect bundled tool {}: {error}", left.display()))?;
    let right_meta = fs::metadata(right)
        .map_err(|error| format!("inspect installed tool {}: {error}", right.display()))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let mut left_reader = BufReader::new(
        File::open(left).map_err(|error| format!("open {}: {error}", left.display()))?,
    );
    let mut right_reader = BufReader::new(
        File::open(right).map_err(|error| format!("open {}: {error}", right.display()))?,
    );
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_read = left_reader
            .read(&mut left_buffer)
            .map_err(|error| format!("read {}: {error}", left.display()))?;
        let right_read = right_reader
            .read(&mut right_buffer)
            .map_err(|error| format!("read {}: {error}", right.display()))?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

/// Makes a copied tool executable on Unix and is a no-op on Windows.
#[cfg(unix)]
fn set_executable_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;

    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("inspect copied tool {}: {error}", path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("make copied tool executable {}: {error}", path.display()))
}

/// Keeps the cross-platform installation call uniform on Windows.
#[cfg(windows)]
fn set_executable_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Runs one host's registration command from the selected project directory.
fn run_agent_registration(
    target: AgentTarget,
    project: &Path,
    mcp_path: &Path,
) -> Result<Output, String> {
    Command::new(target.executable())
        .args(target.registration_args(project, mcp_path))
        .current_dir(project)
        .output()
        .map_err(|error| {
            format!(
                "Could not run {}. Install {} first, then try again: {error}",
                target.executable(),
                target.display_name()
            )
        })
}

/// Formats bounded stdout and stderr when a host CLI rejects registration.
fn format_command_failure(target: AgentTarget, output: &Output) -> String {
    let stdout = bounded_output(&output.stdout);
    let stderr = bounded_output(&output.stderr);
    format!(
        "{} could not register FrameShift (exit {}). stdout: {} stderr: {}",
        target.display_name(),
        output.status,
        stdout,
        stderr
    )
}

/// Converts untrusted subprocess output to a bounded, trimmed string.
fn bounded_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_COMMAND_OUTPUT_BYTES)])
        .trim()
        .to_string()
}

/// Tests argument construction and path validation without launching host CLIs.
#[cfg(test)]
mod tests {
    use super::*;

    /// Codex receives explicit target and project context plus an absolute MCP path.
    #[test]
    fn codex_registration_is_project_explicit() {
        let args = AgentTarget::Codex.registration_args(
            Path::new("/tmp/a project"),
            Path::new("/opt/FrameShift/mcp"),
        );
        assert_eq!(args[0..3], ["mcp", "add", "frameshift"]);
        assert!(args.contains(&"FRAMESHIFT_TARGET=codex".to_string()));
        assert!(args.contains(&"FRAMESHIFT_PROJECT_ROOT=/tmp/a project".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("/opt/FrameShift/mcp"));
    }

    /// Claude uses local scope and the stdio transport expected by its CLI.
    #[test]
    fn claude_registration_uses_local_stdio_scope() {
        let args = AgentTarget::Claude
            .registration_args(Path::new("/tmp/project"), Path::new("/tmp/frameshift-mcp"));
        assert!(args.windows(2).any(|pair| pair == ["--scope", "local"]));
        assert!(args.windows(2).any(|pair| pair == ["--transport", "stdio"]));
    }

    /// Gemini stores the connection in its project-scoped configuration.
    #[test]
    fn gemini_registration_uses_project_scope() {
        let args = AgentTarget::Gemini
            .registration_args(Path::new("/tmp/project"), Path::new("/tmp/frameshift-mcp"));
        assert!(args.windows(2).any(|pair| pair == ["--scope", "project"]));
    }

    /// Versions used as directory names permit release syntax but reject separators.
    #[test]
    fn bundled_version_is_a_safe_path_component() {
        assert!(validate_version("0.10.0-rc_1").is_ok());
        assert!(validate_version("../escape").is_err());
        assert!(validate_version("0.10.0/path").is_err());
    }

    /// Core revisions must be exact Git object IDs and safe path components.
    #[test]
    fn bundled_revision_requires_a_full_git_object_id() {
        assert!(validate_revision("db8cc0215fcf56608cdfa3b79620fe713f2b0d61").is_ok());
        assert!(validate_revision("DB8CC0215FCF56608CDFA3B79620FE713F2B0D61").is_ok());
        assert!(validate_revision("db8cc02").is_err());
        assert!(validate_revision("../cc0215fcf56608cdfa3b79620fe713f2b0d61").is_err());
    }

    /// Different revisions of one semantic version resolve to different installs.
    #[test]
    fn install_identity_includes_version_and_revision() {
        let first = install_directory(
            Path::new("/tmp/frameshift-data"),
            "0.10.0",
            "1111111111111111111111111111111111111111",
        );
        let second = install_directory(
            Path::new("/tmp/frameshift-data"),
            "0.10.0",
            "2222222222222222222222222222222222222222",
        );

        assert_ne!(first, second);
        assert_eq!(
            first,
            Path::new("/tmp/frameshift-data")
                .join("agent-tools")
                .join("0.10.0")
                .join("1111111111111111111111111111111111111111")
        );
    }
}
