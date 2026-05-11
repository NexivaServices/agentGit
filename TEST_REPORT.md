# AgentGit MVP Test Report

Validated on Node.js 22 with a temporary Git repository.

## Passed

- `agentgit init`
- `agentgit start`
- `agentgit stop`
- Capturing modified files
- Capturing created files
- Capturing deleted files
- `agentgit log`
- `agentgit search`
- `agentgit diff`
- `agentgit revert --preview`
- `agentgit revert --apply`
- Conflict protection when current files changed after the tracked task
- `agentgit run "task" --agent name -- command`
- `agentgit export`
- MCP server startup through stdio
- MCP `tools/list`
- MCP `agentgit_init`
- MCP `agentgit_start_task`
- MCP `agentgit_stop_task`
- MCP `agentgit_search_history`
- MCP `agentgit_revert_preview`
- MCP `agentgit_revert_apply`

## Notes

The package includes `scripts/smoke-test.js`. After installing dependencies, run:

```bash
npm ci --omit=dev
npm run smoke
```

The smoke test creates temporary Git repositories, tracks changes, verifies rollback, and tests the MCP server through JSON-RPC over stdio.
