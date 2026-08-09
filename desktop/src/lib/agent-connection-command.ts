// Shell-safe construction for manual FrameShift MCP registration commands.

/** Agent hosts with documented FrameShift MCP registration commands. */
export type AgentTarget = "codex" | "claude" | "gemini";

/** Quotes one dynamic value as an inert POSIX shell argument. */
export function quotePosixShellArgument(value: string): string {
  if (value.includes("\0")) {
    throw new TypeError("shell arguments must not contain NUL");
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Builds the documented MCP registration command for one agent host. */
export function connectionCommand(
  target: AgentTarget,
  projectPath: string,
  mcpPath = "frameshift-mcp",
): string {
  const project = quotePosixShellArgument(projectPath);
  const executable = quotePosixShellArgument(mcpPath);
  if (target === "claude") {
    return `claude mcp add --scope local --transport stdio --env FRAMESHIFT_TARGET=claude --env FRAMESHIFT_PROJECT_ROOT=${project} frameshift -- ${executable}`;
  }
  if (target === "gemini") {
    return `gemini mcp add --scope project --env FRAMESHIFT_TARGET=gemini --env FRAMESHIFT_PROJECT_ROOT=${project} frameshift ${executable}`;
  }
  return `codex mcp add frameshift --env FRAMESHIFT_TARGET=codex --env FRAMESHIFT_PROJECT_ROOT=${project} -- ${executable}`;
}
