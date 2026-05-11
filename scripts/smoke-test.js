#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'src', 'cli.js');
const mcp = path.join(root, 'src', 'mcp-server.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgit-smoke-'));

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.stdio || 'pipe', ...opts });
}

function makeRepo(name) {
  const repo = path.join(tempRoot, name);
  fs.mkdirSync(repo, { recursive: true });
  run('git', ['init', '-q'], { cwd: repo });
  run('git', ['config', 'user.email', 'agentgit@example.local'], { cwd: repo });
  run('git', ['config', 'user.name', 'AgentGit Smoke Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nworld\n');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'index.js'), 'export const value = 1;\n');
  run('git', ['add', '.'], { cwd: repo });
  run('git', ['commit', '-m', 'initial', '-q'], { cwd: repo });
  return repo;
}

function latestSessionId(repo) {
  const ledger = JSON.parse(fs.readFileSync(path.join(repo, '.agentgit', 'ledger.json'), 'utf8'));
  return ledger.sessions[0].id;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractPreviewToken(text) {
  const match = text.match(/Preview token:\s*([a-f0-9]+)/i);
  if (!match) throw new Error('Could not parse preview token from output');
  return match[1];
}

async function testCli() {
  const repo = makeRepo('cli-repo');
  run(process.execPath, [cli, 'init'], { cwd: repo });
  run(process.execPath, [cli, 'start', 'Smoke test edit', '--agent', 'codex', '--model', 'test-model'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nagent\nworld\n');
  fs.writeFileSync(path.join(repo, 'config.json'), '{"enabled":true}\n');
  fs.rmSync(path.join(repo, 'src', 'index.js'));
  run(process.execPath, [cli, 'stop', '--summary', 'Modified app, added config, deleted index'], { cwd: repo });

  const id = latestSessionId(repo);
  const log = run(process.execPath, [cli, 'log'], { cwd: repo });
  assert(log.includes(id), 'CLI log did not include created session');
  const verify = run(process.execPath, [cli, 'verify'], { cwd: repo });
  assert(verify.includes('Ledger integrity: OK'), 'CLI verify integrity failed');
  const templates = run(process.execPath, [cli, 'templates'], { cwd: repo });
  assert(templates.includes('bugfix'), 'CLI templates did not return defaults');
  const search = run(process.execPath, [cli, 'search', 'config', 'codex'], { cwd: repo });
  assert(search.includes(id), 'CLI search did not find created session');
  const draft = run(process.execPath, [cli, 'pr-draft', id], { cwd: repo });
  assert(draft.includes('## Summary'), 'CLI PR draft did not render');
  const preview = run(process.execPath, [cli, 'revert', id, '--preview'], { cwd: repo });
  assert(preview.includes('Clean revert: yes'), 'CLI revert preview was not clean');
  const previewToken = extractPreviewToken(preview);
  run(process.execPath, [cli, 'revert', id, '--apply', '--preview-token', previewToken], { cwd: repo });
  assert(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8') === 'hello\nworld\n', 'CLI revert did not restore modified file');
  assert(!fs.existsSync(path.join(repo, 'config.json')), 'CLI revert did not remove created file');
  assert(fs.existsSync(path.join(repo, 'src', 'index.js')), 'CLI revert did not restore deleted file');
  return { repo, id };
}

async function testConflictProtection() {
  const repo = makeRepo('conflict-repo');
  run(process.execPath, [cli, 'init'], { cwd: repo });
  run(process.execPath, [cli, 'start', 'Conflict edit', '--agent', 'claude'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nagent version\nworld\n');
  run(process.execPath, [cli, 'stop', '--summary', 'Agent changed app text'], { cwd: repo });
  const id = latestSessionId(repo);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nuser version\nworld\n');
  const preview = run(process.execPath, [cli, 'revert', id, '--preview'], { cwd: repo });
  assert(preview.includes('Clean revert: no'), 'Conflict preview should not be clean');
  let refused = false;
  try {
    run(process.execPath, [cli, 'revert', id, '--apply'], { cwd: repo });
  } catch (_) {
    refused = true;
  }
  assert(refused, 'Conflict apply should be refused without --force');
  assert(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8') === 'hello\nuser version\nworld\n', 'Conflict apply changed the user file unexpectedly');
  return { repo, id };
}

async function testCompare() {
  const repo = makeRepo('compare-repo');
  run(process.execPath, [cli, 'init'], { cwd: repo });
  run(process.execPath, [cli, 'start', 'First edit', '--agent', 'codex'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nfirst\nworld\n');
  run(process.execPath, [cli, 'stop', '--summary', 'first'], { cwd: repo });
  const first = latestSessionId(repo);
  run(process.execPath, [cli, 'start', 'Second edit', '--agent', 'codex'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nsecond\nworld\n');
  run(process.execPath, [cli, 'stop', '--summary', 'second'], { cwd: repo });
  const second = latestSessionId(repo);
  const cmp = run(process.execPath, [cli, 'compare', first, second], { cwd: repo });
  assert(cmp.includes('"overlapCount"'), 'CLI compare output missing overlapCount');
  return { repo, first, second };
}

async function rpcClient(cwd) {
  const proc = spawn(process.execPath, [mcp], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let buffer = '';
  const pending = new Map();
  const stderr = [];
  proc.stderr.on('data', data => stderr.push(data.toString()));
  proc.stdout.on('data', data => {
    buffer += data.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. Stderr: ${stderr.join('')}`));
      }, 8000);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params = {}) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  return { proc, request, notify, stderr };
}

async function testMcp() {
  const repo = makeRepo('mcp-repo');
  console.log(`  MCP repo: ${repo}`);
  const client = await rpcClient(repo);
  try {
    console.log('  MCP initialize');
    await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'agentgit-smoke-test', version: '0.0.1' }
    });
    client.notify('notifications/initialized');
    console.log('  MCP tools/list');
    const tools = await client.request('tools/list');
    const names = tools.tools.map(tool => tool.name);
    for (const expected of ['agentgit_start_task', 'agentgit_stop_task', 'agentgit_search_history', 'agentgit_revert_preview', 'agentgit_revert_apply', 'agentgit_compare_tasks', 'agentgit_generate_pr_draft', 'agentgit_verify_integrity']) {
      assert(names.includes(expected), `MCP tool missing: ${expected}`);
    }

    console.log('  MCP agentgit_init');
    await client.request('tools/call', { name: 'agentgit_init', arguments: { repoPath: repo } });
    console.log('  MCP agentgit_start_task');
    await client.request('tools/call', { name: 'agentgit_start_task', arguments: { repoPath: repo, prompt: 'MCP smoke edit', agentName: 'claude' } });
    fs.writeFileSync(path.join(repo, 'app.txt'), 'hello\nfrom mcp\nworld\n');
    fs.writeFileSync(path.join(repo, 'mcp-created.txt'), 'created\n');
    console.log('  MCP agentgit_stop_task');
    const stop = await client.request('tools/call', { name: 'agentgit_stop_task', arguments: { repoPath: repo, summary: 'MCP changed two files' } });
    assert(stop.content[0].text.includes('"changedFileCount": 2'), 'MCP stop did not capture two changed files');
    console.log('  MCP agentgit_search_history');
    const search = await client.request('tools/call', { name: 'agentgit_search_history', arguments: { repoPath: repo, query: 'MCP changed', limit: 5 } });
    const searchData = JSON.parse(search.content[0].text);
    assert(searchData.sessions.length === 1, 'MCP search did not find created session');
    const sessionId = searchData.sessions[0].id;
    console.log('  MCP agentgit_generate_pr_draft');
    const pr = await client.request('tools/call', { name: 'agentgit_generate_pr_draft', arguments: { repoPath: repo, sessionId } });
    assert(pr.content[0].text.includes('"title"'), 'MCP PR draft missing title');
    console.log('  MCP agentgit_verify_integrity');
    const integrity = await client.request('tools/call', { name: 'agentgit_verify_integrity', arguments: { repoPath: repo } });
    assert(integrity.content[0].text.includes('"ok": true'), 'MCP integrity verify failed');
    console.log('  MCP agentgit_revert_preview');
    const preview = await client.request('tools/call', { name: 'agentgit_revert_preview', arguments: { repoPath: repo, sessionId } });
    const previewData = JSON.parse(preview.content[0].text);
    assert(previewData.clean === true, 'MCP revert preview was not clean');
    assert(typeof previewData.previewToken === 'string' && previewData.previewToken.length > 4, 'MCP preview token missing');
    console.log('  MCP agentgit_revert_apply');
    await client.request('tools/call', { name: 'agentgit_revert_apply', arguments: { repoPath: repo, sessionId, previewToken: previewData.previewToken } });
    assert(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8') === 'hello\nworld\n', 'MCP revert did not restore modified file');
    assert(!fs.existsSync(path.join(repo, 'mcp-created.txt')), 'MCP revert did not remove created file');
    return { repo, sessionId };
  } finally {
    client.proc.kill();
  }
}

(async () => {
  try {
    console.log('Running CLI smoke workflow...');
    const cliResult = await testCli();
    console.log(`✓ CLI workflow passed: ${cliResult.id}`);
    const conflictResult = await testConflictProtection();
    console.log(`✓ Conflict protection passed: ${conflictResult.id}`);
    const compareResult = await testCompare();
    console.log(`✓ Compare workflow passed: ${compareResult.first} vs ${compareResult.second}`);
    console.log('Running MCP smoke workflow...');
    const mcpResult = await testMcp();
    console.log(`✓ MCP workflow passed: ${mcpResult.sessionId}`);
    console.log('✓ AgentGit smoke test completed successfully');
  } catch (error) {
    console.error(`✗ AgentGit smoke test failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    if (process.env.AGENTGIT_KEEP_SMOKE_REPOS !== '1') {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`Smoke test repos kept at ${tempRoot}`);
    }
  }
})();
