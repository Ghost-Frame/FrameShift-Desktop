// Security tests for shell-safe manual MCP registration commands.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectionCommand,
  quotePosixShellArgument,
} from "./agent-connection-command";

test("quotePosixShellArgument keeps shell metacharacters inert", () => {
  assert.equal(quotePosixShellArgument("plain path"), "'plain path'");
  assert.equal(quotePosixShellArgument(""), "''");
  assert.equal(quotePosixShellArgument("a'b"), `'a'"'"'b'`);
  assert.equal(
    quotePosixShellArgument("$(touch /tmp/pwn)`id`\nnext"),
    "'$(touch /tmp/pwn)`id`\nnext'",
  );
});

test("quotePosixShellArgument rejects the one byte POSIX argv cannot carry", () => {
  assert.throws(
    () => quotePosixShellArgument("before\0after"),
    /NUL/,
  );
});

test("connectionCommand quotes both untrusted filesystem arguments", () => {
  const projectPath = "/tmp/project $(touch /tmp/project-pwned) 'quoted'";
  const mcpPath = "/tmp/tools/`touch /tmp/tool-pwned`/frameshift-mcp";

  assert.equal(
    connectionCommand("claude", projectPath, mcpPath),
    "claude mcp add --scope local --transport stdio --env FRAMESHIFT_TARGET=claude --env FRAMESHIFT_PROJECT_ROOT='/tmp/project $(touch /tmp/project-pwned) '" +
      `"'"'quoted'"'"'' frameshift -- '/tmp/tools/\`touch /tmp/tool-pwned\`/frameshift-mcp'`,
  );
  assert.equal(
    connectionCommand("gemini", projectPath, mcpPath),
    "gemini mcp add --scope project --env FRAMESHIFT_TARGET=gemini --env FRAMESHIFT_PROJECT_ROOT='/tmp/project $(touch /tmp/project-pwned) '" +
      `"'"'quoted'"'"'' frameshift '/tmp/tools/\`touch /tmp/tool-pwned\`/frameshift-mcp'`,
  );
  assert.equal(
    connectionCommand("codex", projectPath, mcpPath),
    "codex mcp add frameshift --env FRAMESHIFT_TARGET=codex --env FRAMESHIFT_PROJECT_ROOT='/tmp/project $(touch /tmp/project-pwned) '" +
      `"'"'quoted'"'"'' -- '/tmp/tools/\`touch /tmp/tool-pwned\`/frameshift-mcp'`,
  );
});
