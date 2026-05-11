# AgentGit

AgentGit is a local-first Git companion for AI coding agents.

It does **not** replace Git. It adds an agent-aware layer on top of your repo so you can track:

- the prompt or task given to an agent
- the agent name/model
- before/after file snapshots
- generated diffs
- local task history
- searchable changelogs and history
- safe task-level revert

AgentGit works with any agent because it supports manual tracking, command wrapping, MCP tools, and a VS Code UI.

## Description

AgentGit provides task/session tracking, before-after snapshots, diffs, flow timeline visualization, searchable history, and safe preview-based reverts with CLI, MCP, and VS Code integration.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

## What gets created in your project

```txt
.agentgit/
  active-session.json
  ledger.json
  patches/
  snapshots/
```

Keep `.agentgit/` local. Do not commit it unless you intentionally want to share agent work history.

## Install locally as a CLI

From this folder:

```bash
npm link
```

Then in any repo:

```bash
agentgit init
```

You can also use it without linking:

```bash
node /path/to/agentgit/src/cli.js init
```

## Manual workflow

```bash
agentgit init
agentgit start "Fix login redirect after token refresh" --agent claude --model sonnet
# Ask your coding agent to make changes.
agentgit stop --summary "Updated auth guard and session redirect handling"
agentgit log
agentgit diff <session-id-prefix>
```

## Wrap any CLI agent

This tracks before/after snapshots around any command:

```bash
agentgit run "Fix login redirect" --agent codex -- codex
```

Examples:

```bash
agentgit run "Refactor session DTOs" --agent claude -- claude
agentgit run "Fix failing tests" --agent aider -- aider
agentgit run "Update API gateway error handling" --agent custom-agent -- my-agent-cli
```

## Search history

```bash
agentgit search "auth redirect claude"
agentgit search "docker healthcheck"
agentgit search "session dto"
```

## Flow and branch visualization

AgentGit can now connect related tasks into the same flow and render lineage in a tree view.

Start with explicit continuation metadata when needed:

```bash
agentgit start "Continue auth fix" --agent codex --continue <session-id-prefix> --branch hotfix-auth
```

Or let auto-linking connect recent similar prompts in the same flow:

```bash
agentgit start "continue auth redirect edge cases" --agent codex
```

Inspect flows:

```bash
agentgit flow list --limit 20
agentgit flow show <flow-id-prefix>
agentgit flow graph <flow-id-prefix>
```

`flow graph` prints a tree-like branch structure so follow-up prompts are easier to trace.

## Preview and apply a revert

Preview first:

```bash
agentgit revert <session-id-prefix> --preview
agentgit revert <session-id-prefix> --apply --preview-token <token>
agentgit compare <left-session-id> <right-session-id>
agentgit pr-draft <session-id-prefix>
agentgit verify
agentgit templates
agentgit template-add bugfix --prompt "Fix bug in <area>" --tags hotfix
```

Apply only if clean and with preview token:

```bash
agentgit revert <session-id-prefix> --preview
# copy Preview token from output
agentgit revert <session-id-prefix> --apply --preview-token <token>
```

AgentGit will refuse a clean revert if the current file content no longer matches what the agent originally produced. This prevents accidental overwrites.

Force is available, but use it carefully:

```bash
agentgit revert <session-id-prefix> --apply --force
```

## Export changelog

```bash
agentgit export --out AGENT_CHANGELOG.md
```


## MCP server mode

AgentGit can also run as a local MCP server, so coding agents can start/stop tracking themselves through tools instead of asking the user to run `agentgit start` and `agentgit stop` manually.

Install dependencies first:

```bash
npm ci --omit=dev
npm link
```

Run the included smoke test:

```bash
npm run smoke
```

Start the MCP server directly:

```bash
agentgit-mcp
```

Or without linking:

```bash
node /absolute/path/to/agentgit/src/mcp-server.mjs
```

### MCP tools exposed

- `agentgit_init`
- `agentgit_start_task`
- `agentgit_stop_task`
- `agentgit_status`
- `agentgit_list_tasks`
- `agentgit_search_history`
- `agentgit_show_task`
- `agentgit_show_diff`
- `agentgit_revert_preview`
- `agentgit_revert_apply`
- `agentgit_export_changelog`
- `agentgit_compare_tasks`
- `agentgit_generate_pr_draft`
- `agentgit_verify_integrity`
- `agentgit_list_templates`
- `agentgit_save_template`

These are MCP tool names (called by an MCP client), not built-in shell commands by default.
If you want shell commands with the same names, run `npm link` first, then use:

```bash
agentgit_start_task --prompt "Fix login redirect" --agent codex
agentgit_stop_task --summary "Implemented redirect fix"
```

`agentgit_start_task` also supports flow continuity fields:

- `continueFromSessionId`
- `flowId`
- `branchName`
- `autoLink`

The intended agent workflow is:

```txt
1. Before editing files, call agentgit_start_task.
2. Make the code changes normally.
3. Run checks/tests if needed.
4. After finishing, call agentgit_stop_task with a short summary.
5. When reverting older agent work, search first, preview the revert, then apply only if clean.
```

This removes the manual start/stop burden from the user. The agent does the tracking calls automatically as part of its tool workflow.

### Claude Code setup

After `npm link`, add the server:

```bash
claude mcp add-json agentgit '{"type":"stdio","command":"agentgit-mcp","args":[]}'
```

For a project-local setup without `npm link`, use an absolute path:

```bash
claude mcp add-json agentgit '{"type":"stdio","command":"node","args":["/absolute/path/to/agentgit/src/mcp-server.mjs"]}'
```

Then tell Claude Code:

```txt
For every coding task in this repo, use AgentGit: call agentgit_start_task before edits and agentgit_stop_task after edits.
```

### Codex setup

Add this to `~/.codex/config.toml` or `.codex/config.toml` inside a trusted project:

```toml
[mcp_servers.agentgit]
command = "agentgit-mcp"
args = []
```

Or use a direct path:

```toml
[mcp_servers.agentgit]
command = "node"
args = ["/absolute/path/to/agentgit/src/mcp-server.mjs"]
```

Then instruct Codex:

```txt
Use the AgentGit MCP tools to track this task. Start tracking before file edits and stop tracking with a summary after edits.
```

### Generic MCP client config

Most MCP clients accept a stdio config like this:

```json
{
  "mcpServers": {
    "agentgit": {
      "type": "stdio",
      "command": "agentgit-mcp",
      "args": []
    }
  }
}
```

## VS Code extension usage

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

Commands:

- `AgentGit: Initialize Repository`
- `AgentGit: Start Tracking Agent Task`
- `AgentGit: Stop Tracking Agent Task`
- `AgentGit: Search Agent History`
- `AgentGit: Show Diff`
- `AgentGit: Preview Revert`
- `AgentGit: Apply Revert`
- `AgentGit: Refresh Flow Graph`

The extension adds an **AgentGit** activity bar view with:

- **Agent Timeline** tree for session history and file-level changes
- **Flow Graph** tree for parent-child branching lineage across related sessions

## Packaging the VS Code extension

Install packaging dependency if needed:

```bash
npm install
npm run package
```

This creates a `.vsix` file that can be installed manually in VS Code.

## Validation

This package includes a smoke test that verifies:

- CLI init/start/stop/log/search/diff/revert
- created, modified, and deleted file restoration
- dirty-file conflict protection
- MCP `tools/list` and MCP tool calls for start/stop/search/preview/apply

Run it after installing dependencies:

```bash
npm ci --omit=dev
npm run smoke
```

## Design limits in this MVP

This MVP intentionally avoids native dependencies and databases.

Current limitations:

- uses JSON ledger instead of SQLite
- task-level restore, not hunk-level restore
- MCP tools are available, but each agent still needs an instruction/rule to call start/stop around edits
- no semantic embeddings yet
- files larger than 2 MB are skipped
- binary files are tracked and restorable, but diff output is summary-only

## Recommended next versions

1. SQLite ledger
2. Claude Code hooks adapter
3. agent-specific rules/templates for automatic MCP start/stop
4. local semantic search
5. hunk-level revert
6. test-command capture
7. team-shared encrypted ledger export

## Suggested `.gitignore`

Add this to your project `.gitignore`:

```gitignore
.agentgit/
```
