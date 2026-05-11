#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
  exportMarkdown,
  normalizeRepo,
  verifyLedger,
  compareSessions,
  buildPrDraft,
  getTemplates,
  saveTemplate,
  buildContextPack
} = require('./core/agentgit.js');

const TOOL_DEFS = [
  { name: 'agentgit_init', title: 'Initialize AgentGit in a repository', description: 'Create local .agentgit cache for a repository.' },
  { name: 'agentgit_start_task', title: 'Start tracking an agent task', description: 'Capture before snapshot and task metadata.' },
  { name: 'agentgit_stop_task', title: 'Stop tracking an agent task', description: 'Capture after snapshot and persist change set.' },
  { name: 'agentgit_status', title: 'Show AgentGit status', description: 'Show active session and recent history.' },
  { name: 'agentgit_list_tasks', title: 'List recent AgentGit tasks', description: 'List recent sessions in reverse chronological order.' },
  { name: 'agentgit_search_history', title: 'Search AgentGit history', description: 'Search prompts, summaries, metadata, and file paths.' },
  { name: 'agentgit_show_task', title: 'Show one AgentGit task', description: 'Return metadata and file changes for one session.' },
  { name: 'agentgit_show_diff', title: 'Show AgentGit task diff', description: 'Return unified diff captured for one session.' },
  { name: 'agentgit_revert_preview', title: 'Preview reverting an AgentGit task', description: 'Return clean/unsafe checks and reverse patch preview.' },
  { name: 'agentgit_revert_apply', title: 'Apply reverting an AgentGit task', description: 'Apply revert guarded by preview token.' },
  { name: 'agentgit_compare_tasks', title: 'Compare two AgentGit tasks', description: 'Compare file-level change signatures.' },
  { name: 'agentgit_generate_pr_draft', title: 'Generate PR draft from AgentGit task', description: 'Return generated PR title/body for a session.' },
  { name: 'agentgit_verify_integrity', title: 'Verify AgentGit ledger integrity', description: 'Verify signature chain integrity.' },
  { name: 'agentgit_list_templates', title: 'List task templates', description: 'List built-in and custom templates.' },
  { name: 'agentgit_save_template', title: 'Save task template', description: 'Create/update named template with optional tags.' },
  { name: 'agentgit_build_context_pack', title: 'Build compact AI context pack', description: 'Build low-token context pack for bugfix/build/revert.' },
  { name: 'agentgit_export_changelog', title: 'Export AgentGit changelog', description: 'Generate markdown changelog from sessions.' }
];

const TOOL_SCHEMAS = {
  agentgit_init: {
    type: 'object',
    properties: { repoPath: { type: 'string' } }
  },
  agentgit_start_task: {
    type: 'object',
    properties: {
      repoPath: { type: 'string' },
      prompt: { type: 'string' },
      agentName: { type: 'string' },
      modelName: { type: 'string' },
      reuseActive: { type: 'boolean' },
      continueFromSessionId: { type: 'string' },
      flowId: { type: 'string' },
      branchName: { type: 'string' },
      autoLink: { type: 'boolean' }
    }
  },
  agentgit_stop_task: {
    type: 'object',
    properties: {
      repoPath: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      validation: { type: 'object' }
    }
  },
  agentgit_status: { type: 'object', properties: { repoPath: { type: 'string' }, limit: { type: 'number' } } },
  agentgit_list_tasks: { type: 'object', properties: { repoPath: { type: 'string' }, limit: { type: 'number' } } },
  agentgit_search_history: { type: 'object', properties: { repoPath: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } } },
  agentgit_show_task: { type: 'object', required: ['sessionId'], properties: { repoPath: { type: 'string' }, sessionId: { type: 'string' } } },
  agentgit_show_diff: { type: 'object', required: ['sessionId'], properties: { repoPath: { type: 'string' }, sessionId: { type: 'string' }, maxChars: { type: 'number' } } },
  agentgit_revert_preview: { type: 'object', required: ['sessionId'], properties: { repoPath: { type: 'string' }, sessionId: { type: 'string' }, maxChars: { type: 'number' } } },
  agentgit_revert_apply: {
    type: 'object',
    required: ['sessionId', 'previewToken'],
    properties: { repoPath: { type: 'string' }, sessionId: { type: 'string' }, force: { type: 'boolean' }, previewToken: { type: 'string' } }
  },
  agentgit_compare_tasks: {
    type: 'object',
    required: ['leftSessionId', 'rightSessionId'],
    properties: { repoPath: { type: 'string' }, leftSessionId: { type: 'string' }, rightSessionId: { type: 'string' } }
  },
  agentgit_generate_pr_draft: { type: 'object', required: ['sessionId'], properties: { repoPath: { type: 'string' }, sessionId: { type: 'string' }, titlePrefix: { type: 'string' } } },
  agentgit_verify_integrity: { type: 'object', properties: { repoPath: { type: 'string' } } },
  agentgit_list_templates: { type: 'object', properties: { repoPath: { type: 'string' } } },
  agentgit_save_template: {
    type: 'object',
    required: ['name', 'prompt'],
    properties: { repoPath: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }
  },
  agentgit_build_context_pack: {
    type: 'object',
    properties: {
      repoPath: { type: 'string' },
      query: { type: 'string' },
      sessionId: { type: 'string' },
      objective: { type: 'string' },
      limitSessions: { type: 'number' },
      maxFiles: { type: 'number' },
      maxChars: { type: 'number' }
    }
  },
  agentgit_export_changelog: { type: 'object', properties: { repoPath: { type: 'string' }, since: { type: 'string' }, tag: { type: 'string' }, mode: { type: 'string' } } }
};

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    agentName: session.agentName,
    modelName: session.modelName,
    prompt: session.prompt,
    summary: session.summary,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    flowId: session.flowId || null,
    parentSessionId: session.parentSessionId || null,
    branchName: session.branchName || null,
    continuationMode: session.continuationMode || null,
    duplicateOf: session.duplicateOf || null,
    changeFingerprint: session.changeFingerprint || null,
    baseGitSha: session.baseGitSha,
    changedFileCount: session.changedFileCount || 0,
    tags: session.tags || [],
    impactMap: session.impactMap || {},
    risk: session.risk || null,
    confidence: session.confidence || null,
    smartSummary: session.smartSummary || '',
    nextSteps: session.nextSteps || [],
    sensitiveFindings: session.sensitiveFindings || { secrets: [], pii: [] },
    validation: session.validation || {},
    files: session.files || [],
    initialGitStatus: session.initialGitStatus || '',
    finalGitStatus: session.finalGitStatus || ''
  };
}

function withErrorBoundary(fn) {
  return async (args = {}) => {
    try {
      return await fn(args);
    } catch (error) {
      return textResult({ ok: false, error: error.message });
    }
  };
}

const handlers = {
  agentgit_init: withErrorBoundary(async ({ repoPath }) => {
    const result = initRepo(repoPath || process.cwd());
    return textResult({ ok: true, repoRoot: result.repoRoot, agentgitDir: result.agentgitDir });
  }),
  agentgit_start_task: withErrorBoundary(async ({ repoPath, prompt = '', agentName = 'mcp-agent', modelName = '', reuseActive = true, continueFromSessionId = '', flowId = '', branchName = '', autoLink = true }) => {
    const session = startSession({
      cwd: repoPath || process.cwd(),
      prompt,
      agentName,
      modelName,
      reuseActive: Boolean(reuseActive),
      continueFromId: continueFromSessionId || '',
      flowId: flowId || '',
      branchName: branchName || '',
      autoLink: Boolean(autoLink)
    });
    return textResult({ ok: true, session: publicSession(session) });
  }),
  agentgit_stop_task: withErrorBoundary(async ({ repoPath, summary = '', tags = [], validation = {} }) => {
    const session = stopSession({ cwd: repoPath || process.cwd(), summary, tags, validation });
    return textResult({ ok: true, session: publicSession(session) });
  }),
  agentgit_status: withErrorBoundary(async ({ repoPath, limit = 5 }) => {
    const repoRoot = normalizeRepo(repoPath || process.cwd());
    initRepo(repoRoot);
    const active = getActiveSession(repoRoot);
    const recent = listSessions({ cwd: repoRoot, limit: Number(limit) || 5 }).map(publicSession);
    return textResult({ ok: true, repoRoot, active: publicSession(active), recent });
  }),
  agentgit_list_tasks: withErrorBoundary(async ({ repoPath, limit = 20 }) => {
    const sessions = listSessions({ cwd: repoPath || process.cwd(), limit: Number(limit) || 20 }).map(publicSession);
    return textResult({ ok: true, sessions });
  }),
  agentgit_search_history: withErrorBoundary(async ({ repoPath, query = '', limit = 20 }) => {
    const sessions = searchSessions({ cwd: repoPath || process.cwd(), query: String(query || '') }).slice(0, Number(limit) || 20).map(publicSession);
    return textResult({ ok: true, query, sessions });
  }),
  agentgit_show_task: withErrorBoundary(async ({ repoPath, sessionId }) => {
    const repoRoot = normalizeRepo(repoPath || process.cwd());
    const { session } = findSession(repoRoot, String(sessionId || ''));
    return textResult({ ok: true, session: publicSession(session) });
  }),
  agentgit_show_diff: withErrorBoundary(async ({ repoPath, sessionId, maxChars = 50000 }) => {
    const patch = readPatch({ cwd: repoPath || process.cwd(), id: String(sessionId || '') });
    const max = Number(maxChars) || 50000;
    const truncated = patch.length > max;
    return textResult({
      ok: true,
      sessionId,
      truncated,
      diff: truncated ? `${patch.slice(0, max)}\n\n[AgentGit diff truncated at ${max} characters]` : patch
    });
  }),
  agentgit_revert_preview: withErrorBoundary(async ({ repoPath, sessionId, maxChars = 50000 }) => {
    const preview = previewRevert({ cwd: repoPath || process.cwd(), id: String(sessionId || '') });
    const patch = preview.patch || '';
    const max = Number(maxChars) || 50000;
    const truncated = patch.length > max;
    return textResult({
      ok: true,
      session: publicSession(preview.session),
      clean: preview.safe,
      previewToken: preview.previewToken,
      checks: preview.checks,
      truncated,
      reversePatch: truncated ? `${patch.slice(0, max)}\n\n[AgentGit reverse patch truncated at ${max} characters]` : patch
    });
  }),
  agentgit_revert_apply: withErrorBoundary(async ({ repoPath, sessionId, force = false, previewToken = '' }) => {
    const result = applyRevert({
      cwd: repoPath || process.cwd(),
      id: String(sessionId || ''),
      force: Boolean(force),
      previewToken: String(previewToken || '')
    });
    return textResult({ ok: true, session: publicSession(result.session), applied: result.applied });
  }),
  agentgit_compare_tasks: withErrorBoundary(async ({ repoPath, leftSessionId, rightSessionId }) => {
    const comparison = compareSessions({
      cwd: repoPath || process.cwd(),
      leftId: String(leftSessionId || ''),
      rightId: String(rightSessionId || '')
    });
    return textResult({ ok: true, comparison });
  }),
  agentgit_generate_pr_draft: withErrorBoundary(async ({ repoPath, sessionId, titlePrefix = '' }) => {
    const draft = buildPrDraft({ cwd: repoPath || process.cwd(), id: String(sessionId || ''), titlePrefix: String(titlePrefix || '') });
    return textResult({ ok: true, title: draft.title, body: draft.body, sessionId: draft.sessionId, draft });
  }),
  agentgit_verify_integrity: withErrorBoundary(async ({ repoPath }) => {
    const result = verifyLedger({ cwd: repoPath || process.cwd() });
    return textResult({ ok: true, ...result });
  }),
  agentgit_list_templates: withErrorBoundary(async ({ repoPath }) => {
    const templates = getTemplates({ cwd: repoPath || process.cwd() });
    return textResult({ ok: true, templates });
  }),
  agentgit_save_template: withErrorBoundary(async ({ repoPath, name, prompt, tags = [] }) => {
    const template = saveTemplate({ cwd: repoPath || process.cwd(), name: String(name || ''), prompt: String(prompt || ''), tags: Array.isArray(tags) ? tags : [] });
    return textResult({ ok: true, template });
  }),
  agentgit_build_context_pack: withErrorBoundary(async ({ repoPath, query = '', sessionId = '', objective = 'bugfix', limitSessions = 6, maxFiles = 20, maxChars = 6000 }) => {
    const pack = buildContextPack({
      cwd: repoPath || process.cwd(),
      query: String(query || ''),
      sessionId: String(sessionId || ''),
      objective: String(objective || 'bugfix'),
      limitSessions: Number(limitSessions) || 6,
      maxFiles: Number(maxFiles) || 20,
      maxChars: Number(maxChars) || 6000
    });
    return textResult({ ok: true, pack });
  }),
  agentgit_export_changelog: withErrorBoundary(async ({ repoPath, since = null, tag = '', mode = 'date' }) => {
    const markdown = exportMarkdown({ cwd: repoPath || process.cwd(), since: since || null, tag: String(tag || ''), mode: String(mode || 'date') });
    return textResult({ ok: true, markdown });
  })
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: params.protocolVersion || '2025-06-18',
      serverInfo: { name: 'agentgit', version: '0.2.7' },
      capabilities: { tools: {}, prompts: {} }
    });
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOL_DEFS.map((tool) => ({ ...tool, inputSchema: TOOL_SCHEMAS[tool.name] || { type: 'object', properties: {} } })) });
  }

  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments || {};
    const handler = handlers[name];
    if (!handler) return rpcError(id, -32602, `Unknown tool: ${name}`);
    const result = await handler(args);
    return rpcResult(id, result);
  }

  if (method === 'prompts/list') {
    return rpcResult(id, {
      prompts: [{ name: 'agentgit_track_this_task', title: 'Track this coding task with AgentGit', description: 'Prompt that instructs agents to call start/stop tracking tools.' }]
    });
  }

  if (method === 'prompts/get') {
    const task = params.arguments?.task || 'Implement requested task';
    const agentName = params.arguments?.agentName || 'mcp-agent';
    return rpcResult(id, {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Use AgentGit to track this coding task: ${task}`,
              '',
              'Before editing files, call agentgit_start_task with the task as the prompt.',
              `Use agentName: ${agentName}.`,
              'After finishing edits and checks, call agentgit_stop_task with a short summary.',
              'If revert is requested, call agentgit_search_history, agentgit_revert_preview, then agentgit_revert_apply only when clean or explicitly approved.'
            ].join('\n')
          }
        }
      ]
    });
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      continue;
    }

    if (!message.method) continue;
    try {
      await handleRequest(message);
    } catch (error) {
      if (message.id !== undefined) {
        rpcError(message.id, -32000, error.message || 'Internal error');
      }
    }
  }
});
