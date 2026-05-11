const vscode = require('vscode');
const path = require('path');
const {
  initRepo,
  startSession,
  stopSession,
  searchSessions,
  readPatch,
  previewRevert,
  applyRevert,
  listSessions,
  normalizeRepo
} = require('./core/agentgit');
const { TimelineProvider } = require('./views/timelineProvider');
const { FlowGraphProvider } = require('./views/flowGraphProvider');

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function requireWorkspaceRoot() {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a workspace folder before using AgentGit.');
  return normalizeRepo(root);
}

async function showDiffDocument(sessionOrId) {
  const repoRoot = requireWorkspaceRoot();
  const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id;
  const patch = readPatch({ cwd: repoRoot, id });
  const title = `AgentGit Diff ${id}.diff`;
  const document = await vscode.workspace.openTextDocument({
    content: patch || '# No diff captured for this AgentGit session.\n',
    language: 'diff'
  });
  await vscode.window.showTextDocument(document, { preview: true });
  vscode.window.setStatusBarMessage(title, 3000);
}

async function activate(context) {
  const workspaceRoot = getWorkspaceRoot();
  const timelineProvider = new TimelineProvider(workspaceRoot);
  const flowGraphProvider = new FlowGraphProvider(workspaceRoot);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('agentgit.timeline', timelineProvider));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('agentgit.flowGraph', flowGraphProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.init', async () => {
      try {
        const repoRoot = requireWorkspaceRoot();
        const result = initRepo(repoRoot);
        timelineProvider.refresh();
        vscode.window.showInformationMessage(`AgentGit initialized at ${result.agentgitDir}`);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.startTracking', async () => {
      try {
        const repoRoot = requireWorkspaceRoot();
        const prompt = await vscode.window.showInputBox({
          title: 'AgentGit: Start Tracking Agent Task',
          prompt: 'What are you asking the agent to do?',
          placeHolder: 'Fix login redirect after token refresh',
          ignoreFocusOut: true
        });
        if (prompt === undefined) return;

        const agentName = await vscode.window.showQuickPick([
          'claude',
          'codex',
          'continue',
          'aider',
          'cursor',
          'windsurf',
          'manual-agent',
          'other'
        ], {
          title: 'Which agent/tool is doing the work?',
          placeHolder: 'Select agent name'
        });
        if (!agentName) return;

        const modelName = await vscode.window.showInputBox({
          title: 'AgentGit: Model Name (optional)',
          prompt: 'Enter model name (for example gpt-5.5, sonnet). Leave blank to auto-detect.',
          placeHolder: 'gpt-5.5',
          ignoreFocusOut: true
        });
        if (modelName === undefined) return;

        const continueChoice = await vscode.window.showQuickPick([
          { label: 'No continuation', value: '' },
          { label: 'Choose parent session...', value: 'pick-parent' }
        ], {
          title: 'Continue from an existing session?',
          placeHolder: 'Choose how to link this task in flow graph'
        });
        if (!continueChoice) return;

        let continueFromId = '';
        if (continueChoice.value === 'pick-parent') {
          const recent = listSessions({ cwd: repoRoot, limit: 50 });
          if (recent.length > 0) {
            const selectedParent = await vscode.window.showQuickPick(recent.map((session) => ({
              label: session.summary || session.prompt || session.id,
              description: `${session.id} • ${session.agentName || 'agent'}`,
              detail: session.flowId ? `flow: ${session.flowId}` : undefined,
              session
            })), {
              title: 'Select Parent Session',
              placeHolder: 'Used to build branching graph lineage'
            });
            if (selectedParent) continueFromId = selectedParent.session.id;
          }
        }

        const branchName = await vscode.window.showInputBox({
          title: 'AgentGit: Branch Name (optional)',
          prompt: 'Set branch label shown in flow graph (for example hotfix-auth)',
          placeHolder: 'hotfix-auth',
          ignoreFocusOut: true
        });
        if (branchName === undefined) return;

        const session = startSession({
          cwd: repoRoot,
          prompt,
          agentName,
          modelName,
          continueFromId,
          branchName: String(branchName || '').trim(),
          reuseActive: true
        });
        timelineProvider.refresh();
        flowGraphProvider.refresh();
        vscode.window.showInformationMessage(`AgentGit tracking started: ${session.id} (${session.agentName}/${session.modelName})`);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.stopTracking', async () => {
      try {
        const repoRoot = requireWorkspaceRoot();
        const summary = await vscode.window.showInputBox({
          title: 'AgentGit: Stop Tracking Agent Task',
          prompt: 'Optional summary of what the agent changed',
          placeHolder: 'Updated auth guard and session DTOs',
          ignoreFocusOut: true
        });
        if (summary === undefined) return;

        const session = stopSession({ cwd: repoRoot, summary });
        timelineProvider.refresh();
        flowGraphProvider.refresh();
        vscode.window.showInformationMessage(`AgentGit saved ${session.changedFileCount} changed files for ${session.id}`);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.showTimeline', async () => {
      timelineProvider.refresh();
      vscode.window.showInformationMessage('AgentGit timeline refreshed.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.showFlowGraph', async () => {
      flowGraphProvider.refresh();
      vscode.window.showInformationMessage('AgentGit flow graph refreshed.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.search', async () => {
      try {
        const repoRoot = requireWorkspaceRoot();
        const query = await vscode.window.showInputBox({
          title: 'AgentGit: Search Agent History',
          prompt: 'Search prompts, summaries, agent names, dates, or file paths',
          placeHolder: 'auth redirect yesterday claude',
          ignoreFocusOut: true
        });
        if (query === undefined) return;

        const matches = searchSessions({ cwd: repoRoot, query });
        if (matches.length === 0) {
          vscode.window.showInformationMessage('No AgentGit sessions matched your search.');
          return;
        }

        const selected = await vscode.window.showQuickPick(matches.map(session => ({
          label: session.summary || session.prompt || session.id,
          description: `${session.agentName || 'agent'} / ${session.modelName || 'unknown-model'} • ${session.changedFileCount || 0} files`,
          detail: `${session.id} • ${session.startedAt}`,
          session
        })), {
          title: 'AgentGit Search Results',
          placeHolder: 'Select a session to open its diff'
        });
        if (selected) await showDiffDocument(selected.session);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.showDiff', async (session) => {
      try {
        if (!session) {
          const repoRoot = requireWorkspaceRoot();
          const query = await vscode.window.showInputBox({
            title: 'AgentGit: Show Diff',
            prompt: 'Enter a session ID or prefix',
            ignoreFocusOut: true
          });
          if (!query) return;
          return showDiffDocument(query);
        }
        await showDiffDocument(session);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.previewRevert', async (session) => {
      try {
        const repoRoot = requireWorkspaceRoot();
        let id = session && session.id;
        if (!id) {
          id = await vscode.window.showInputBox({
            title: 'AgentGit: Preview Revert',
            prompt: 'Enter a session ID or prefix',
            ignoreFocusOut: true
          });
        }
        if (!id) return;

        const preview = previewRevert({ cwd: repoRoot, id });
        const header = [
          `# AgentGit revert preview: ${preview.session.id}`,
          `# Clean revert: ${preview.safe ? 'yes' : 'no'}`,
          `# Preview token: ${preview.previewToken}`,
          ...preview.checks.map(check => `# ${check.safe ? 'OK' : 'WARN'} ${check.relPath} - ${check.reason}`),
          ''
        ].join('\n');
        const document = await vscode.workspace.openTextDocument({
          content: `${header}${preview.patch}`,
          language: 'diff'
        });
        await vscode.window.showTextDocument(document, { preview: true });
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentgit.applyRevert', async (session) => {
      try {
        const repoRoot = requireWorkspaceRoot();
        let id = session && session.id;
        if (!id) {
          id = await vscode.window.showInputBox({
            title: 'AgentGit: Apply Revert',
            prompt: 'Enter a session ID or prefix',
            ignoreFocusOut: true
          });
        }
        if (!id) return;

        const preview = previewRevert({ cwd: repoRoot, id });
        const confirm = await vscode.window.showWarningMessage(
          `Apply revert for ${preview.session.id}? Clean revert: ${preview.safe ? 'yes' : 'no'}.`,
          { modal: true },
          'Apply Revert'
        );
        if (confirm !== 'Apply Revert') return;

        const result = applyRevert({ cwd: repoRoot, id, force: false, previewToken: preview.previewToken });
        timelineProvider.refresh();
        flowGraphProvider.refresh();
        vscode.window.showInformationMessage(`AgentGit reverted ${result.applied.length} files.`);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
