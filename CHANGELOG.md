# Changelog

## 0.2.8

- Added direct shell command support for `agentgit_start_task` and `agentgit_stop_task`.
- Added CLI aliases `agentgit start-task` and `agentgit stop-task`.
- Improved MCP tool compatibility by publishing per-tool input schemas.
- Updated README guidance to clarify MCP tool names vs shell commands.

## 0.2.7

- Added a dedicated **Flow Graph** tree view in the AgentGit activity bar to visualize task lineage and branching directly in the extension UI.
- Added `AgentGit: Refresh Flow Graph` command and wired refresh actions for start/stop/revert operations.
- Updated `AgentGit: Start Tracking Agent Task` to support selecting a parent session and optional branch label for explicit flow branching.
- Improved extension provider registration lifecycle by attaching tree provider registrations to subscriptions.

## 0.2.2

- Improved Agent Timeline with professional, changelog-style session presentation.
- Added compact session rollups with status, file count, agent identity, and relative time.
- Added richer tooltips with key metadata (summary, prompt, ID, status, timestamps, file count).
- Grouped file changes into Added, Updated, and Removed sections for faster review.
- Kept agent context/token usage unchanged by deriving view data from existing session fields.

## 0.2.1

- Added `package-lock.json` for reproducible installs.
- Added `npm run smoke` validation script.
- Smoke test now verifies CLI tracking/revert, conflict refusal, and MCP tool flow.
- Added `TEST_REPORT.md`.
- Updated MCP server version metadata.

## 0.2.0

- Added MCP server mode.
- Added `agentgit-mcp` and `agentgit_mcp` executables.
- Added MCP tools for init, start task, stop task, status, list, search, show, diff, revert preview, revert apply, and changelog export.
- Added Claude Code, Codex, and generic MCP setup notes.

## 0.1.0

- Initial CLI and VS Code extension MVP.
- Local `.agentgit` ledger.
- Task start/stop tracking.
- Before/after snapshots.
- Diff, search, changelog, and safe task-level revert.
