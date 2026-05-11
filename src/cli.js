#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  initRepo,
  startSession,
  stopSession,
  getActiveSession,
  listSessions,
  searchSessions,
  findSession,
  readPatch,
  previewRevert,
  applyRevert,
  formatSession,
  exportMarkdown,
  normalizeRepo,
  verifyLedger,
  compareSessions,
  buildPrDraft,
  getTemplates,
  saveTemplate,
  buildContextPack,
  listFlows,
  showFlow,
  flowGraph
} = require('./core/agentgit');

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.shift() || 'help';
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=');
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

function help() {
  console.log(`AgentGit MVP - local agent work ledger

Usage:
  agentgit init
  agentgit start "Fix auth redirect" --agent claude --model sonnet
    --continue <session-id-prefix> --branch feature-a --reuse-active
  agentgit stop --summary "Fixed auth redirect and updated tests"
    --tags auth,hotfix --tests-run --tests-passed --lint-run --lint-passed
  agentgit run "Fix auth redirect" --agent codex -- codex
  agentgit status
  agentgit log
  agentgit show <session-id-prefix>
  agentgit diff <session-id-prefix>
  agentgit search "auth yesterday claude"
  agentgit revert <session-id-prefix> --preview
  agentgit revert <session-id-prefix> --apply --preview-token <token>
  agentgit revert <session-id-prefix> --apply --force
  agentgit export --out AGENT_CHANGELOG.md
  agentgit compare <left-session> <right-session>
  agentgit context [--query "auth bug"] [--session <id>] [--objective revert|bugfix|build] [--limit 6] [--max-files 20] [--max-chars 6000]
  agentgit pr-draft <session-id-prefix>
  agentgit verify
  agentgit templates
  agentgit template-add <name> --prompt "..." --tags auth,hotfix
  agentgit flow list [--limit 20]
  agentgit flow show <flow-id-prefix>
  agentgit flow graph <flow-id-prefix>

Notes:
  - AgentGit stores data locally in .agentgit/.
  - Optional .agentgitignore at repo root can exclude extra files from snapshots.
  - It does not replace Git.
  - Clean reverts are only applied when current files still match the tracked agent output.
  - Revert apply requires a fresh preview token from the preview command.
`);
}

function printSessions(sessions) {
  if (sessions.length === 0) {
    console.log('No AgentGit sessions found.');
    return;
  }
  for (const session of sessions) {
    console.log(formatSession(session));
    console.log('');
  }
}


function runWrappedAgent(rawArgv) {
  const args = rawArgv.slice(3);
  const separatorIndex = args.indexOf('--');
  if (separatorIndex === -1) {
    throw new Error('Missing `--` separator. Example: agentgit run "Fix bug" --agent codex -- codex');
  }

  const beforeSeparator = args.slice(0, separatorIndex);
  const commandAndArgs = args.slice(separatorIndex + 1);
  if (commandAndArgs.length === 0) {
    throw new Error('Missing command after `--`.');
  }

  let agentName = 'wrapped-agent';
  let modelName = '';
  const promptParts = [];

  for (let i = 0; i < beforeSeparator.length; i++) {
    const value = beforeSeparator[i];
    if (value === '--agent' && beforeSeparator[i + 1]) {
      agentName = beforeSeparator[++i];
    } else if (value.startsWith('--agent=')) {
      agentName = value.split('=').slice(1).join('=');
    } else if (value === '--model' && beforeSeparator[i + 1]) {
      modelName = beforeSeparator[++i];
    } else if (value.startsWith('--model=')) {
      modelName = value.split('=').slice(1).join('=');
    } else if (value === '--prompt' && beforeSeparator[i + 1]) {
      promptParts.push(beforeSeparator[++i]);
    } else if (value.startsWith('--prompt=')) {
      promptParts.push(value.split('=').slice(1).join('='));
    } else {
      promptParts.push(value);
    }
  }

  const prompt = promptParts.join(' ').trim();
  const session = startSession({ cwd: process.cwd(), prompt, agentName, modelName });
  console.log(`Started AgentGit session: ${session.id}`);
  console.log(`Running: ${commandAndArgs.join(' ')}`);

  const result = spawnSync(commandAndArgs[0], commandAndArgs.slice(1), {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  const summary = result.status === 0
    ? `Wrapped agent command completed successfully: ${commandAndArgs.join(' ')}`
    : `Wrapped agent command exited with status ${result.status}: ${commandAndArgs.join(' ')}`;

  const completed = stopSession({ cwd: process.cwd(), summary });
  console.log(`Stopped AgentGit session: ${completed.id}`);
  console.log(`Changed files: ${completed.changedFileCount}`);
  if (result.status && result.status !== 0) process.exitCode = result.status;
}

function main() {
  if (process.argv[2] === 'run') {
    try {
      runWrappedAgent(process.argv);
    } catch (error) {
      console.error(`AgentGit error: ${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const { command, flags, positional } = parseArgs(process.argv);
  const cwd = process.cwd();

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        help();
        break;

      case 'init': {
        const result = initRepo(cwd);
        console.log(`AgentGit initialized at ${result.agentgitDir}`);
        break;
      }

      case 'start': {
        const prompt = positional.join(' ').trim() || String(flags.prompt || '').trim();
        const session = startSession({
          cwd,
          prompt,
          agentName: String(flags.agent || 'manual-agent'),
          modelName: String(flags.model || ''),
          reuseActive: Boolean(flags['reuse-active']),
          continueFromId: String(flags.continue || ''),
          flowId: String(flags.flow || ''),
          branchName: String(flags.branch || ''),
          autoLink: !Boolean(flags['no-autolink'])
        });
        console.log(`Started AgentGit session: ${session.id}`);
        if (session.initialGitStatus) {
          console.log('Warning: repository had existing uncommitted changes when tracking started. Revert safety checks will still protect current files.');
        }
        break;
      }
      case 'start-task': {
        const prompt = positional.join(' ').trim() || String(flags.prompt || '').trim();
        const session = startSession({
          cwd,
          prompt,
          agentName: String(flags.agent || flags.agentName || 'manual-agent'),
          modelName: String(flags.model || flags.modelName || ''),
          reuseActive: Boolean(flags['reuse-active'] || flags.reuseActive),
          continueFromId: String(flags.continue || flags.continueFromSessionId || ''),
          flowId: String(flags.flow || ''),
          branchName: String(flags.branch || flags.branchName || ''),
          autoLink: !(Boolean(flags['no-autolink']) || flags.autoLink === 'false')
        });
        console.log(`Started AgentGit session: ${session.id}`);
        break;
      }

      case 'stop': {
        const tags = String(flags.tags || '').split(',').map(s => s.trim()).filter(Boolean);
        const validation = {
          testsRun: Boolean(flags['tests-run']),
          testsPassed: Boolean(flags['tests-passed']),
          lintRun: Boolean(flags['lint-run']),
          lintPassed: Boolean(flags['lint-passed']),
          typecheckRun: Boolean(flags['typecheck-run']),
          typecheckPassed: Boolean(flags['typecheck-passed'])
        };
        const session = stopSession({ cwd, summary: String(flags.summary || positional.join(' ') || ''), tags, validation });
        console.log(`Stopped AgentGit session: ${session.id}`);
        console.log(`Changed files: ${session.changedFileCount}`);
        if (session.patchPath) console.log(`Patch: ${session.patchPath}`);
        break;
      }
      case 'stop-task': {
        const tags = String(flags.tags || '').split(',').map(s => s.trim()).filter(Boolean);
        const validation = {
          testsRun: Boolean(flags['tests-run']),
          testsPassed: Boolean(flags['tests-passed']),
          lintRun: Boolean(flags['lint-run']),
          lintPassed: Boolean(flags['lint-passed']),
          typecheckRun: Boolean(flags['typecheck-run']),
          typecheckPassed: Boolean(flags['typecheck-passed'])
        };
        const session = stopSession({ cwd, summary: String(flags.summary || positional.join(' ') || ''), tags, validation });
        console.log(`Stopped AgentGit session: ${session.id}`);
        console.log(`Changed files: ${session.changedFileCount}`);
        if (session.patchPath) console.log(`Patch: ${session.patchPath}`);
        break;
      }

      case 'status': {
        const repoRoot = normalizeRepo(cwd);
        initRepo(repoRoot);
        const active = getActiveSession(repoRoot);
        if (!active) {
          console.log('No active AgentGit session.');
        } else {
          console.log('Active AgentGit session:');
          console.log(formatSession(active));
        }
        break;
      }

      case 'log': {
        const limit = Number(flags.limit || 20);
        printSessions(listSessions({ cwd, limit }));
        break;
      }

      case 'show': {
        const id = positional[0];
        if (!id) throw new Error('Missing session id.');
        const repoRoot = normalizeRepo(cwd);
        const { session } = findSession(repoRoot, id);
        console.log(formatSession(session));
        console.log('\nFiles:');
        for (const file of session.files || []) {
          console.log(`  ${file.changeType.padEnd(8)} ${file.relPath}`);
        }
        break;
      }

      case 'diff': {
        const id = positional[0];
        if (!id) throw new Error('Missing session id.');
        console.log(readPatch({ cwd, id }));
        break;
      }

      case 'search': {
        const query = positional.join(' ').trim();
        printSessions(searchSessions({ cwd, query }));
        break;
      }

      case 'revert': {
        const id = positional[0];
        if (!id) throw new Error('Missing session id.');
        if (flags.preview || !flags.apply) {
          const preview = previewRevert({ cwd, id });
          console.log(`Revert preview for ${preview.session.id}`);
          console.log(`Clean revert: ${preview.safe ? 'yes' : 'no'}`);
          console.log(`Preview token: ${preview.previewToken}`);
          for (const check of preview.checks) {
            console.log(`${check.safe ? 'OK ' : 'WARN'} ${check.relPath} - ${check.reason}`);
          }
          console.log('\n--- reverse patch preview ---\n');
          console.log(preview.patch);
          break;
        }
        const result = applyRevert({ cwd, id, force: Boolean(flags.force), previewToken: String(flags['preview-token'] || '') });
        console.log(`Applied revert for ${result.session.id}`);
        for (const item of result.applied) {
          console.log(`  ${item.action}: ${item.relPath}`);
        }
        break;
      }

      case 'export': {
        const markdown = exportMarkdown({ cwd, since: flags.since || null, tag: String(flags.tag || ''), mode: String(flags.mode || 'date') });
        if (flags.out) {
          const outPath = path.resolve(cwd, String(flags.out));
          fs.writeFileSync(outPath, markdown, 'utf8');
          console.log(`Exported changelog to ${outPath}`);
        } else {
          console.log(markdown);
        }
        break;
      }

      case 'compare': {
        const leftId = positional[0];
        const rightId = positional[1];
        if (!leftId || !rightId) throw new Error('Usage: agentgit compare <left-session> <right-session>');
        const result = compareSessions({ cwd, leftId, rightId });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'context': {
        const pack = buildContextPack({
          cwd,
          query: String(flags.query || positional.join(' ') || ''),
          sessionId: String(flags.session || ''),
          objective: String(flags.objective || 'bugfix'),
          limitSessions: Number(flags.limit || 6),
          maxFiles: Number(flags['max-files'] || 20),
          maxChars: Number(flags['max-chars'] || 6000)
        });
        if (flags.json) {
          console.log(JSON.stringify(pack, null, 2));
        } else {
          console.log(pack.compactText);
        }
        break;
      }

      case 'pr-draft': {
        const id = positional[0];
        if (!id) throw new Error('Missing session id.');
        const draft = buildPrDraft({ cwd, id, titlePrefix: String(flags.prefix || '') });
        console.log(`# ${draft.title}\n\n${draft.body}`);
        break;
      }

      case 'verify': {
        const result = verifyLedger({ cwd });
        console.log(`Ledger integrity: ${result.ok ? 'OK' : 'FAILED'}`);
        console.log(`Checked sessions: ${result.checked}`);
        if (!result.ok) {
          for (const issue of result.issues) {
            console.log(`  ${issue.id}: ${issue.issue}`);
          }
        }
        break;
      }

      case 'templates': {
        console.log(JSON.stringify(getTemplates({ cwd }), null, 2));
        break;
      }

      case 'template-add': {
        const name = positional[0];
        const prompt = String(flags.prompt || '');
        if (!name || !prompt) throw new Error('Usage: agentgit template-add <name> --prompt "..." [--tags a,b]');
        const tags = String(flags.tags || '').split(',').map(s => s.trim()).filter(Boolean);
        const saved = saveTemplate({ cwd, name, prompt, tags });
        console.log(`Saved template: ${saved.name}`);
        break;
      }

      case 'flow': {
        const sub = positional[0] || 'list';
        if (sub === 'list') {
          const limit = Number(flags.limit || 20);
          const flows = listFlows({ cwd, limit });
          if (flows.length === 0) {
            console.log('No AgentGit flows found.');
            break;
          }
          for (const flow of flows) {
            console.log(`${flow.flowId}`);
            console.log(`  sessions: ${flow.sessionCount}`);
            console.log(`  started: ${flow.startedAt || 'n/a'}`);
            console.log(`  latest: ${flow.latestAt || 'n/a'}`);
            console.log(`  latest summary: ${flow.latestSummary || ''}`);
            console.log('');
          }
          break;
        }
        if (sub === 'show') {
          const id = positional[1];
          if (!id) throw new Error('Usage: agentgit flow show <flow-id-prefix>');
          const sessions = showFlow({ cwd, flowId: id });
          for (const session of sessions) {
            console.log(formatSession(session));
            console.log('');
          }
          break;
        }
        if (sub === 'graph') {
          const id = positional[1];
          if (!id) throw new Error('Usage: agentgit flow graph <flow-id-prefix>');
          const graph = flowGraph({ cwd, flowId: id });
          console.log(`Flow: ${graph.flowId}`);
          console.log(`Sessions: ${graph.sessionCount}`);
          console.log(`Roots: ${graph.roots.join(', ')}`);
          console.log('');
          for (const line of graph.lines) console.log(line);
          break;
        }
        throw new Error('Usage: agentgit flow <list|show|graph> [args]');
      }

      default:
        console.error(`Unknown command: ${command}`);
        help();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`AgentGit error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
