# AgentGit

AgentGit is a local-first Git companion for AI coding agents.

It helps teams track agent-driven work with structured task history, before/after snapshots, generated diffs, flow lineage, and safe preview-based reverts.

## Description

AgentGit adds an agent-aware layer on top of your repository without replacing Git. It is designed for AI-assisted development workflows where traceability, reproducibility, and controlled rollback matter.

Core capabilities:
- Task/session tracking with prompt, agent name, and model metadata
- Before/after file snapshots and generated patch diffs
- Searchable local history and changelog export
- Flow/branch lineage for follow-up agent tasks
- Safe task-level reverts with preview token checks
- Integration options: CLI, MCP server, and VS Code extension

## Repository Naming

- Repository: `agentGit`
- Package/CLI name: `agentgit`
- Product name: `AgentGit`

This keeps branding readable while preserving conventional lowercase package naming.

## License

This project is licensed under the MIT License.
See [LICENSE](./LICENSE).

## Getting Started

### 1. Clone

```bash
git clone https://github.com/NexivaServices/agentGit.git
cd agentGit
```

### 2. Install

```bash
npm ci
```

### 3. Run (CLI)

```bash
npx agentgit init
npx agentgit start "Fix auth redirect" --agent codex
# make changes
npx agentgit stop --summary "Patched auth redirect and tests"
```

### 4. Optional: Global local link

```bash
npm link
agentgit init
```

## MCP Usage

Run as local MCP server:

```bash
npx agentgit-mcp
```

Example Codex config:

```toml
[mcp_servers.agentgit]
command = "agentgit-mcp"
args = []
```

## Roadmap

- Publish extension package and release tags
- Add richer PR draft generation templates
- Add integrity and policy checks for tracked sessions

## Contributing

- Use clear commit messages
- Keep docs and command examples in sync
- Add tests for behavior-changing features