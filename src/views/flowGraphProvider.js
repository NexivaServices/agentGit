const vscode = require('vscode');
const { listFlows, showFlow, normalizeRepo, initRepo } = require('../core/agentgit');

class FlowGraphItem extends vscode.TreeItem {
  constructor(label, collapsibleState, payload) {
    super(label, collapsibleState);
    this.payload = payload;
  }
}

class FlowGraphProvider {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this.workspaceRoot) return Promise.resolve([]);

    try {
      const repoRoot = normalizeRepo(this.workspaceRoot);
      initRepo(repoRoot);

      if (!element) {
        const flows = listFlows({ cwd: repoRoot, limit: 50 });
        if (flows.length === 0) {
          const empty = new FlowGraphItem('No flows recorded yet', vscode.TreeItemCollapsibleState.None, { type: 'empty' });
          empty.description = 'Start and stop a tracked task to create flow history';
          empty.iconPath = new vscode.ThemeIcon('graph-line');
          return Promise.resolve([empty]);
        }

        const items = flows.map((flow) => {
          const item = new FlowGraphItem(
            `Flow ${String(flow.flowId).slice(0, 12)}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            { type: 'flow', flowId: flow.flowId, repoRoot }
          );
          item.description = `${flow.sessionCount} session${flow.sessionCount === 1 ? '' : 's'}`;
          item.tooltip = `Flow ID: ${flow.flowId}\nLatest: ${flow.latestSummary || 'n/a'}`;
          item.iconPath = new vscode.ThemeIcon('type-hierarchy-sub');
          item.contextValue = 'agentgitFlow';
          return item;
        });
        return Promise.resolve(items);
      }

      if (element.payload?.type === 'flow') {
        const sessions = showFlow({ cwd: element.payload.repoRoot, flowId: element.payload.flowId });
        const byId = new Map(sessions.map((session) => [session.id, session]));
        const roots = sessions
          .filter((session) => !session.parentSessionId || !byId.has(session.parentSessionId))
          .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());

        return Promise.resolve(roots.map((session) => this.createSessionNode(session, sessions, element.payload.repoRoot)));
      }

      if (element.payload?.type === 'session') {
        const allSessions = element.payload.sessions || [];
        const children = allSessions
          .filter((session) => session.parentSessionId === element.payload.session.id)
          .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime())
          .map((session) => this.createSessionNode(session, allSessions, element.payload.repoRoot));
        return Promise.resolve(children);
      }

      return Promise.resolve([]);
    } catch (error) {
      const err = new FlowGraphItem(`AgentGit graph error: ${error.message}`, vscode.TreeItemCollapsibleState.None, { type: 'error' });
      err.iconPath = new vscode.ThemeIcon('error');
      return Promise.resolve([err]);
    }
  }

  createSessionNode(session, allSessions, repoRoot) {
    const hasChildren = allSessions.some((candidate) => candidate.parentSessionId === session.id);
    const item = new FlowGraphItem(
      clamp(session.summary || session.prompt || session.id, 80),
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      { type: 'session', session, sessions: allSessions, repoRoot }
    );
    item.description = [session.branchName ? `branch:${session.branchName}` : null, `${session.changedFileCount || 0} files`]
      .filter(Boolean)
      .join(' • ');
    item.tooltip = [
      `ID: ${session.id}`,
      `Agent: ${session.agentName || 'agent'}${session.modelName ? ` / ${session.modelName}` : ''}`,
      `Started: ${session.startedAt || 'n/a'}`,
      session.branchName ? `Branch: ${session.branchName}` : null,
      session.parentSessionId ? `Parent: ${session.parentSessionId}` : null
    ].filter(Boolean).join('\n');
    item.iconPath = new vscode.ThemeIcon(session.parentSessionId ? 'git-merge' : 'git-branch');
    item.contextValue = 'agentgitSession';
    item.command = {
      command: 'agentgit.showDiff',
      title: 'Show Diff',
      arguments: [session]
    };
    return item;
  }
}

function clamp(value, max) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

module.exports = {
  FlowGraphProvider
};
