const vscode = require('vscode');
const path = require('path');
const { listSessions, getActiveSession, initRepo, normalizeRepo } = require('../core/agentgit');

class AgentGitItem extends vscode.TreeItem {
  constructor(label, collapsibleState, payload) {
    super(label, collapsibleState);
    this.payload = payload;
  }
}

class TimelineProvider {
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
        const active = getActiveSession(repoRoot);
        const sessions = listSessions({ cwd: repoRoot, limit: 50 });
        const items = [];

        if (active) {
          const item = new AgentGitItem(`● Active: ${titleForSession(active)}`, vscode.TreeItemCollapsibleState.None, {
            type: 'active',
            session: active
          });
          item.description = `${active.agentName || 'tracking'} • ${relativeTime(active.startedAt)}`;
          item.tooltip = markdownTooltipForSession(active);
          item.iconPath = new vscode.ThemeIcon('record');
          items.push(item);
        }

        for (const session of sessions) {
          const item = new AgentGitItem(titleForSession(session), vscode.TreeItemCollapsibleState.Collapsed, {
            type: 'session',
            session
          });
          item.description = sessionRollup(session);
          item.tooltip = markdownTooltipForSession(session);
          item.iconPath = new vscode.ThemeIcon(session.status === 'reverted' ? 'history' : 'git-commit');
          item.contextValue = 'agentgitSession';
          item.command = {
            command: 'agentgit.showDiff',
            title: 'Show Diff',
            arguments: [session]
          };
          items.push(item);
        }

        if (items.length === 0) {
          const empty = new AgentGitItem('No agent tasks recorded yet', vscode.TreeItemCollapsibleState.None, { type: 'empty' });
          empty.description = 'Start tracking from command palette';
          empty.iconPath = new vscode.ThemeIcon('info');
          return Promise.resolve([empty]);
        }

        return Promise.resolve(items);
      }

      if (element.payload && element.payload.type === 'session') {
        const session = element.payload.session;
        const files = session.files || [];
        const children = [];

        const overview = new AgentGitItem('Overview', vscode.TreeItemCollapsibleState.None, {
          type: 'meta',
          session
        });
        overview.description = sessionRollup(session);
        overview.tooltip = markdownTooltipForSession(session);
        overview.iconPath = new vscode.ThemeIcon('note');
        children.push(overview);

        if (session.summary) {
          const summary = new AgentGitItem('Summary', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          summary.description = clamp(session.summary, 90);
          summary.tooltip = session.summary;
          summary.iconPath = new vscode.ThemeIcon('comment-discussion');
          children.push(summary);
        }

        if (session.prompt) {
          const prompt = new AgentGitItem('Prompt', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          prompt.description = clamp(session.prompt, 90);
          prompt.tooltip = session.prompt;
          prompt.iconPath = new vscode.ThemeIcon('comment');
          children.push(prompt);
        }

        if (session.smartSummary) {
          const smart = new AgentGitItem('Smart Summary', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          smart.description = clamp(session.smartSummary, 90);
          smart.tooltip = session.smartSummary;
          smart.iconPath = new vscode.ThemeIcon('sparkle');
          children.push(smart);
        }

        if (session.tags && session.tags.length > 0) {
          const tags = new AgentGitItem('Tags', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          tags.description = session.tags.join(', ');
          tags.tooltip = `Tags: ${session.tags.join(', ')}`;
          tags.iconPath = new vscode.ThemeIcon('tag');
          children.push(tags);
        }

        if (session.risk) {
          const risk = new AgentGitItem('Risk', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          risk.description = `${session.risk.level} (${session.risk.score})`;
          risk.tooltip = (session.risk.reasons || []).join('\n') || 'No risk reasons recorded.';
          risk.iconPath = new vscode.ThemeIcon(session.risk.level === 'high' ? 'warning' : session.risk.level === 'medium' ? 'alert' : 'check');
          children.push(risk);
        }

        if (session.confidence) {
          const confidence = new AgentGitItem('Confidence', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          confidence.description = session.confidence;
          confidence.tooltip = `Confidence: ${session.confidence}`;
          confidence.iconPath = new vscode.ThemeIcon('pulse');
          children.push(confidence);
        }

        if (session.nextSteps && session.nextSteps.length > 0) {
          const stepsHeader = new AgentGitItem('Suggested Next Steps', vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          stepsHeader.description = `${session.nextSteps.length} item${session.nextSteps.length === 1 ? '' : 's'}`;
          stepsHeader.iconPath = new vscode.ThemeIcon('list-unordered');
          children.push(stepsHeader);
          for (const step of session.nextSteps) {
            const stepItem = new AgentGitItem(step, vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
            stepItem.iconPath = new vscode.ThemeIcon('arrow-right');
            children.push(stepItem);
          }
        }

        const meta = new AgentGitItem(`Session ID: ${session.id}`, vscode.TreeItemCollapsibleState.None, {
          type: 'meta',
          session
        });
        meta.iconPath = new vscode.ThemeIcon('symbol-key');
        children.push(meta);
        if (session.flowId) {
          const flowMeta = new AgentGitItem(`Flow ID: ${session.flowId}`, vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          flowMeta.iconPath = new vscode.ThemeIcon('git-branch');
          children.push(flowMeta);
        }
        if (session.parentSessionId) {
          const parentMeta = new AgentGitItem(`Parent: ${session.parentSessionId}`, vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          parentMeta.iconPath = new vscode.ThemeIcon('debug-step-back');
          children.push(parentMeta);
        }
        if (session.branchName) {
          const branchMeta = new AgentGitItem(`Branch: ${session.branchName}`, vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          branchMeta.iconPath = new vscode.ThemeIcon('symbol-namespace');
          children.push(branchMeta);
        }

        const groups = groupFileChanges(files);
        for (const group of groups) {
          const groupHeader = new AgentGitItem(group.label, vscode.TreeItemCollapsibleState.None, { type: 'meta', session });
          groupHeader.description = `${group.files.length} file${group.files.length === 1 ? '' : 's'}`;
          groupHeader.iconPath = new vscode.ThemeIcon(iconForChange(group.type));
          children.push(groupHeader);

          for (const file of group.files) {
            const child = new AgentGitItem(file.relPath, vscode.TreeItemCollapsibleState.None, {
              type: 'file',
              session,
              file
            });
            child.description = file.changeType;
            child.tooltip = `${file.changeType}: ${file.relPath}`;
            child.iconPath = new vscode.ThemeIcon(iconForChange(file.changeType));
            child.command = {
              command: 'vscode.open',
              title: 'Open File',
              arguments: [vscode.Uri.file(path.join(repoRoot, file.relPath))]
            };
            children.push(child);
          }
        }

        return Promise.resolve(children);
      }

      return Promise.resolve([]);
    } catch (error) {
      const item = new AgentGitItem(`AgentGit error: ${error.message}`, vscode.TreeItemCollapsibleState.None, { type: 'error' });
      item.iconPath = new vscode.ThemeIcon('error');
      return Promise.resolve([item]);
    }
  }
}

function iconForChange(changeType) {
  if (changeType === 'created') return 'diff-added';
  if (changeType === 'deleted') return 'diff-removed';
  return 'diff-modified';
}

function titleForSession(session) {
  return clamp(session.summary || session.prompt || session.id, 70);
}

function sessionRollup(session) {
  const parts = [
    `${session.changedFileCount || 0} files`,
    session.agentName || 'agent',
    session.status || 'unknown',
    session.flowId ? `flow:${String(session.flowId).slice(0, 10)}` : null,
    session.parentSessionId ? 'continued' : null,
    session.risk ? `risk:${session.risk.level}` : null,
    session.confidence ? `conf:${session.confidence}` : null,
    relativeTime(session.startedAt)
  ].filter(Boolean);
  return parts.join(' • ');
}

function markdownTooltipForSession(session) {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendMarkdown(`**${escapeMd(titleForSession(session))}**\n\n`);
  if (session.summary) md.appendMarkdown(`$(note) ${escapeMd(session.summary)}\n\n`);
  md.appendMarkdown(`- ID: \`${session.id}\`\n`);
  md.appendMarkdown(`- Status: **${escapeMd(session.status || 'unknown')}**\n`);
  if (session.flowId) md.appendMarkdown(`- Flow: \`${escapeMd(session.flowId)}\`\n`);
  if (session.parentSessionId) md.appendMarkdown(`- Parent: \`${escapeMd(session.parentSessionId)}\`\n`);
  if (session.branchName) md.appendMarkdown(`- Branch: ${escapeMd(session.branchName)}\n`);
  if (session.continuationMode) md.appendMarkdown(`- Continuation: ${escapeMd(session.continuationMode)}\n`);
  md.appendMarkdown(`- Agent: ${escapeMd(session.agentName || 'agent')}${session.modelName ? ` / ${escapeMd(session.modelName)}` : ''}\n`);
  md.appendMarkdown(`- Started: ${escapeMd(session.startedAt || 'n/a')}\n`);
  if (session.endedAt) md.appendMarkdown(`- Ended: ${escapeMd(session.endedAt)}\n`);
  md.appendMarkdown(`- Changed files: ${session.changedFileCount || 0}\n`);
  if (session.tags?.length) md.appendMarkdown(`- Tags: ${escapeMd(session.tags.join(', '))}\n`);
  if (session.risk) md.appendMarkdown(`- Risk: **${escapeMd(session.risk.level)}** (${session.risk.score})\n`);
  if (session.confidence) md.appendMarkdown(`- Confidence: **${escapeMd(session.confidence)}**\n`);
  return md;
}

function groupFileChanges(files) {
  const grouped = {
    created: [],
    modified: [],
    deleted: []
  };
  for (const file of files) {
    const key = grouped[file.changeType] ? file.changeType : 'modified';
    grouped[key].push(file);
  }
  return [
    { type: 'created', label: 'Added', files: grouped.created },
    { type: 'modified', label: 'Updated', files: grouped.modified },
    { type: 'deleted', label: 'Removed', files: grouped.deleted }
  ].filter(group => group.files.length > 0);
}

function relativeTime(iso) {
  if (!iso) return 'time n/a';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return 'time n/a';
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ${diffMs >= 0 ? 'ago' : 'from now'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ${diffMs >= 0 ? 'ago' : 'from now'}`;
  const days = Math.round(hours / 24);
  return `${days}d ${diffMs >= 0 ? 'ago' : 'from now'}`;
}

function clamp(value, max) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function escapeMd(value) {
  return String(value).replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

module.exports = {
  TimelineProvider
};
