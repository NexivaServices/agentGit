const { execFileSync } = require('child_process');
const path = require('path');

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    return '';
  }
}

function findRepoRoot(cwd) {
  const output = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (output) return path.resolve(output);
  return path.resolve(cwd);
}

function currentSha(cwd) {
  return runGit(['rev-parse', '--short', 'HEAD'], cwd) || null;
}

function statusShort(cwd) {
  return runGit(['status', '--short', '--', '.', ':!.agentgit'], cwd) || '';
}

module.exports = {
  runGit,
  findRepoRoot,
  currentSha,
  statusShort
};
