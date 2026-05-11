#!/usr/bin/env node
const { stopSession } = require('./core/agentgit');

function parseFlags(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (inline !== undefined) flags[key] = inline;
      else if (i + 1 < args.length && !args[i + 1].startsWith('--')) flags[key] = args[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

try {
  const { flags, positional } = parseFlags(process.argv);
  const tags = String(flags.tags || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const validation = {
    testsRun: Boolean(flags['tests-run']),
    testsPassed: Boolean(flags['tests-passed']),
    lintRun: Boolean(flags['lint-run']),
    lintPassed: Boolean(flags['lint-passed']),
    typecheckRun: Boolean(flags['typecheck-run']),
    typecheckPassed: Boolean(flags['typecheck-passed'])
  };
  const summary = String(flags.summary || positional.join(' ') || '');
  const session = stopSession({ cwd: process.cwd(), summary, tags, validation });
  console.log(`Stopped AgentGit session: ${session.id}`);
  console.log(`Changed files: ${session.changedFileCount}`);
} catch (error) {
  console.error(`AgentGit error: ${error.message}`);
  process.exitCode = 1;
}
