#!/usr/bin/env node
const { startSession } = require('./core/agentgit');

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
  const prompt = positional.join(' ').trim() || String(flags.prompt || '').trim();
  const session = startSession({
    cwd: process.cwd(),
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
} catch (error) {
  console.error(`AgentGit error: ${error.message}`);
  process.exitCode = 1;
}
