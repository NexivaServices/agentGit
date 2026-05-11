# AgentGit

AgentGit is a local-first Git companion for AI coding agents.

It adds an agent-aware tracking layer on top of your repository without replacing Git.

## Why AgentGit

AI agents move fast, but project memory gets messy. AgentGit helps you answer:
- What was asked?
- Which files changed?
- Can we safely roll it back?

## Core Features

- Task/session tracking with prompt, agent name, and model metadata
- Before/after snapshots and generated patch diffs
- Searchable local history and changelog export
- Flow lineage for follow-up and branched tasks
- Preview-first, safety-checked reverts
- Works with any agent via CLI, MCP, and VS Code extension

## Quick Start

### 1. Install

```bash
npm ci --omit=dev
npm link
```

### 2. Initialize in your project

```bash
agentgit init
```

### 3. One-command MCP setup

Claude:

```bash
agentgit init --with-mcp --client claude
agentgit mcp doctor --client claude
```

Codex:

```bash
agentgit init --with-mcp --client codex
agentgit mcp doctor --client codex
```

Generic MCP config output:

```bash
agentgit mcp setup --client generic
```

## What AgentGit Creates

```txt
.agentgit/
  active-session.json
  ledger.json
  patches/
  snapshots/
```

Keep `.agentgit/` local unless you intentionally want to share agent history.

## Daily CLI Workflow

```bash
agentgit start "Fix login redirect after token refresh" --agent claude --model sonnet
# make changes
agentgit stop --summary "Updated auth guard and session redirect handling"
agentgit log
agentgit diff <session-id-prefix>
```

## Wrap Any Agent CLI

```bash
agentgit run "Fix failing tests" --agent aider -- aider
agentgit run "Refactor session DTOs" --agent claude -- claude
agentgit run "Fix API error handling" --agent custom-agent -- my-agent-cli
```

## Search, Compare, and PR Draft

```bash
agentgit search "auth redirect claude"
agentgit compare <left-session-id> <right-session-id>
agentgit pr-draft <session-id-prefix>
agentgit export --out AGENT_CHANGELOG.md
```

## Flow Tracking

```bash
agentgit start "Continue auth fix" --agent codex --continue <session-id-prefix> --branch hotfix-auth
agentgit flow list --limit 20
agentgit flow show <flow-id-prefix>
agentgit flow graph <flow-id-prefix>
```

## Safe Revert Workflow

Preview first:

```bash
agentgit revert <session-id-prefix> --preview
```

Apply with preview token:

```bash
agentgit revert <session-id-prefix> --apply --preview-token <token>
```

Force only when you understand overwrite risk:

```bash
agentgit revert <session-id-prefix> --apply --force
```

## MCP Integration

### Supported Clients

- Claude Code
- Codex
- Any MCP-compatible client

### MCP Setup Commands

```bash
agentgit mcp setup --client claude
agentgit mcp setup --client codex
agentgit mcp setup --client generic
```

Options:
- `--name <server-name>` default: `agentgit`
- `--absolute` uses `node /absolute/path/to/src/mcp-server.mjs` instead of `agentgit-mcp`

### MCP Doctor

```bash
agentgit mcp doctor
agentgit mcp doctor --client claude
agentgit mcp doctor --client codex
```

### Exposed MCP Tools

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

## VS Code Extension

Run extension dev host:

```bash
npm run dev
```

Main commands:
- `AgentGit: Initialize Repository`
- `AgentGit: Start Tracking Agent Task`
- `AgentGit: Stop Tracking Agent Task`
- `AgentGit: Search Agent History`
- `AgentGit: Show Diff`
- `AgentGit: Preview Revert`
- `AgentGit: Apply Revert`
- `AgentGit: Refresh Flow Graph`

## Validation

```bash
npm run smoke
```

## Troubleshooting

- `.agentgit/` exists but MCP tools are missing: MCP server is not connected yet. Run `agentgit mcp setup --client <claude|codex>` and restart your client.
- `agentgit-mcp` not found: run `npm link` in this repo, or use `--absolute` mode.
- MCP still not visible: run `agentgit mcp doctor` and verify your client session was restarted.

## License

MIT License. See [LICENSE](./LICENSE).
