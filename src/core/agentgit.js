const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  DEFAULT_MAX_FILE_BYTES,
  ensureDir,
  pathExists,
  readJson,
  writeJson,
  sha256,
  isProbablyBinary,
  safeRelative,
  walkFiles,
  copyFilePreserveRoot,
  removeEmptyParents,
  readTextIfSafe
} = require('./fs-utils');
const { findRepoRoot, currentSha, statusShort } = require('./git');
const { createUnifiedDiff, createReversePreview } = require('./diff');

const AGENTGIT_DIR = '.agentgit';
const LEDGER_FILE = 'ledger.json';
const ACTIVE_FILE = 'active-session.json';
const TEMPLATES_FILE = 'templates.json';
const SIGNATURE_SALT_FILE = 'signature.salt';
const DANGEROUS_COMMAND_PATTERNS = [
  /git\s+reset\s+--hard/i,
  /git\s+checkout\s+--/i,
  /\brm\s+-rf\b/i,
  /del\s+\/s\s+\/q/i,
  /git\s+push\s+--force/i
];
const SECRET_PATTERNS = [
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'openai_key', pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: 'generic_token', pattern: /(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/gi }
];
const IGNORED_FILE_PATTERNS = [
  /\.log$/i,
  /\.tsbuildinfo$/i,
  /\.tmp$/i,
  /\.temp$/i,
  /(^|\/)tmp_/i,
  /(^|\/)\.DS_Store$/i
];
const AGENTGITIGNORE_FILE = '.agentgitignore';
const DUPLICATE_LOOKBACK = 20;
const PII_PATTERNS = [
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { name: 'phone', pattern: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g },
  { name: 'ssn_like', pattern: /\b\d{3}-\d{2}-\d{4}\b/g }
];

function nowIso() {
  return new Date().toISOString();
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function resolveAgentName(agentName = '') {
  return firstNonEmpty([
    agentName,
    process.env.AGENT_NAME,
    process.env.CODEX_AGENT,
    process.env.CLAUDE_AGENT,
    'manual-agent'
  ]);
}

function resolveModelName(modelName = '') {
  return firstNonEmpty([
    modelName,
    process.env.CODEX_MODEL,
    process.env.OPENAI_MODEL,
    process.env.MODEL_NAME,
    process.env.MODEL,
    'unknown-model'
  ]);
}

function randomId(prefix = 'ag') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${stamp}_${rand}`;
}

function normalizePrompt(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => token.length > 2);
}

function promptSimilarity(a = '', b = '') {
  const ta = new Set(normalizePrompt(a));
  const tb = new Set(normalizePrompt(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }
  return overlap / Math.max(ta.size, tb.size);
}

function findContinuationParent({ sessions = [], prompt = '', agentName = '', modelName = '' } = {}) {
  const now = Date.now();
  for (const session of sessions) {
    const startedAt = new Date(session.startedAt || 0).getTime();
    const ageMs = Number.isFinite(startedAt) ? now - startedAt : Number.MAX_SAFE_INTEGER;
    if (ageMs > 1000 * 60 * 60 * 24) continue;
    if (agentName && session.agentName && session.agentName !== agentName) continue;
    if (modelName && session.modelName && session.modelName !== modelName) continue;
    const sim = promptSimilarity(prompt, session.prompt || session.summary || '');
    if (sim >= 0.22) {
      return { parent: session, similarity: sim };
    }
  }
  return { parent: null, similarity: 0 };
}

function agentgitPath(repoRoot, ...parts) {
  return path.join(repoRoot, AGENTGIT_DIR, ...parts);
}

function normalizeRepo(cwd) {
  return findRepoRoot(cwd || process.cwd());
}

function initRepo(cwd = process.cwd()) {
  const repoRoot = normalizeRepo(cwd);
  ensureDir(agentgitPath(repoRoot));
  ensureDir(agentgitPath(repoRoot, 'snapshots'));
  ensureDir(agentgitPath(repoRoot, 'patches'));
  const ledgerPath = agentgitPath(repoRoot, LEDGER_FILE);
  if (!pathExists(ledgerPath)) {
    writeJson(ledgerPath, {
      version: 1,
      repoRoot,
      createdAt: nowIso(),
      sessions: []
    });
  }
  return { repoRoot, agentgitDir: agentgitPath(repoRoot), ledgerPath };
}

function getLedger(repoRoot) {
  initRepo(repoRoot);
  return readJson(agentgitPath(repoRoot, LEDGER_FILE), {
    version: 1,
    repoRoot,
    sessions: []
  });
}

function readOrCreateSignatureSalt(repoRoot) {
  const saltPath = agentgitPath(repoRoot, SIGNATURE_SALT_FILE);
  if (pathExists(saltPath)) return fs.readFileSync(saltPath, 'utf8').trim();
  const salt = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(saltPath, `${salt}\n`, 'utf8');
  return salt;
}

function defaultTemplates() {
  return [
    { name: 'bugfix', prompt: 'Fix bug in <area>. Reproduce, patch, and verify with tests.', tags: ['hotfix'] },
    { name: 'refactor', prompt: 'Refactor <module> for readability while preserving behavior.', tags: ['refactor'] },
    { name: 'release-prep', prompt: 'Prepare release: finalize changelog, verify CI, and check migrations.', tags: ['release'] },
    { name: 'performance', prompt: 'Optimize <path> for latency and memory impact with measurements.', tags: ['perf'] }
  ];
}

function getTemplates({ cwd = process.cwd() } = {}) {
  const repoRoot = normalizeRepo(cwd);
  initRepo(repoRoot);
  const templatePath = agentgitPath(repoRoot, TEMPLATES_FILE);
  if (!pathExists(templatePath)) {
    writeJson(templatePath, { templates: defaultTemplates() });
  }
  const data = readJson(templatePath, { templates: defaultTemplates() });
  return data.templates || [];
}

function saveTemplate({ cwd = process.cwd(), name, prompt, tags = [] } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const templates = getTemplates({ cwd: repoRoot }).filter(t => t.name !== name);
  templates.push({ name, prompt, tags });
  writeJson(agentgitPath(repoRoot, TEMPLATES_FILE), { templates });
  return { name, prompt, tags };
}

function saveLedger(repoRoot, ledger) {
  ledger.repoRoot = repoRoot;
  writeJson(agentgitPath(repoRoot, LEDGER_FILE), ledger);
}

function getActiveSession(repoRoot) {
  return readJson(agentgitPath(repoRoot, ACTIVE_FILE), null);
}

function globToRegex(glob = '') {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function loadRepoIgnorePatterns(repoRoot) {
  const ignorePath = path.join(repoRoot, AGENTGITIGNORE_FILE);
  if (!pathExists(ignorePath)) return [];
  const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/);
  const patterns = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      patterns.push(globToRegex(line));
    } catch (_) {
      // ignore malformed pattern lines
    }
  }
  return patterns;
}

function getSnapshotFile(snapshotRoot, relativePath) {
  return path.join(snapshotRoot, relativePath);
}

function takeSnapshot(repoRoot, snapshotRoot, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_FILE_BYTES;
  const repoIgnorePatterns = loadRepoIgnorePatterns(repoRoot);
  if (pathExists(snapshotRoot)) fs.rmSync(snapshotRoot, { recursive: true, force: true });
  ensureDir(snapshotRoot);

  const manifest = {
    createdAt: nowIso(),
    maxBytes,
    files: {},
    skipped: []
  };

  const files = walkFiles(repoRoot);
  for (const fullPath of files) {
    const relPath = safeRelative(repoRoot, fullPath);
    if (!relPath || relPath.startsWith(`${AGENTGIT_DIR}/`)) continue;
    if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(relPath))) {
      manifest.skipped.push({ relPath, reason: 'ignored_pattern' });
      continue;
    }
    if (repoIgnorePatterns.some((pattern) => pattern.test(relPath))) {
      manifest.skipped.push({ relPath, reason: 'repo_ignore' });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (_) {
      continue;
    }

    if (!stat.isFile()) continue;
    if (stat.size > maxBytes) {
      manifest.skipped.push({ relPath, reason: 'too_large', size: stat.size });
      continue;
    }

    const buffer = fs.readFileSync(fullPath);
    const isBinary = isProbablyBinary(buffer);
    const hash = sha256(buffer);
    copyFilePreserveRoot(fullPath, snapshotRoot, relPath);
    manifest.files[relPath] = {
      relPath,
      hash,
      size: stat.size,
      isBinary,
      mtimeMs: stat.mtimeMs
    };
  }

  writeJson(path.join(snapshotRoot, 'manifest.json'), manifest);
  return manifest;
}

function loadSnapshotManifest(snapshotRoot) {
  return readJson(path.join(snapshotRoot, 'manifest.json'), {
    createdAt: null,
    files: {},
    skipped: []
  });
}

function compareSnapshots(beforeManifest, afterManifest) {
  const allPaths = new Set([
    ...Object.keys(beforeManifest.files || {}),
    ...Object.keys(afterManifest.files || {})
  ]);

  const changes = [];
  for (const relPath of Array.from(allPaths).sort()) {
    const before = beforeManifest.files[relPath] || null;
    const after = afterManifest.files[relPath] || null;

    if (!before && after) {
      changes.push({ relPath, changeType: 'created', before: null, after });
    } else if (before && !after) {
      changes.push({ relPath, changeType: 'deleted', before, after: null });
    } else if (before && after && before.hash !== after.hash) {
      changes.push({ relPath, changeType: 'modified', before, after });
    }
  }
  return changes;
}

function tagsFromText(prompt = '', summary = '') {
  const haystack = `${prompt} ${summary}`.toLowerCase();
  const tags = new Set();
  if (/\bauth|login|session|oauth|token\b/.test(haystack)) tags.add('auth');
  if (/\bperf|optimi[sz]e|latency|fast\b/.test(haystack)) tags.add('perf');
  if (/\brefactor|cleanup|rename\b/.test(haystack)) tags.add('refactor');
  if (/\bfix|bug|hotfix|incident\b/.test(haystack)) tags.add('hotfix');
  if (/\btest|spec|jest|vitest\b/.test(haystack)) tags.add('tests');
  if (/\bdoc|readme|changelog\b/.test(haystack)) tags.add('docs');
  return Array.from(tags).sort();
}

function makeImpactMap(files = []) {
  const map = { app: 0, components: 0, lib: 0, tests: 0, docs: 0, config: 0, infra: 0, other: 0 };
  for (const file of files) {
    const p = file.relPath.toLowerCase();
    if (p.startsWith('app/')) map.app += 1;
    else if (p.startsWith('components/')) map.components += 1;
    else if (p.startsWith('lib/')) map.lib += 1;
    else if (/(\.|\/)(test|spec)\./.test(p)) map.tests += 1;
    else if (p.endsWith('.md')) map.docs += 1;
    else if (/package\.json|tsconfig|eslint|prettier|next\.config|dockerfile|\.yml|\.yaml/.test(p)) map.config += 1;
    else if (/terraform|k8s|infra|firestore\.rules/.test(p)) map.infra += 1;
    else map.other += 1;
  }
  return map;
}

function calculateRisk(files = [], prompt = '', summary = '') {
  let score = 0;
  const reasons = [];
  const text = `${prompt}\n${summary}`;
  for (const file of files) {
    const p = file.relPath.toLowerCase();
    if (/auth|login|session|token/.test(p)) {
      score += 3;
      reasons.push(`auth-sensitive path: ${file.relPath}`);
    }
    if (/migration|schema|firestore\.rules|billing|payment/.test(p)) {
      score += 4;
      reasons.push(`high-impact path: ${file.relPath}`);
    }
    if (/package-lock\.json|pnpm-lock|yarn\.lock/.test(p)) {
      score += 1;
      reasons.push(`dependency lockfile changed: ${file.relPath}`);
    }
    if (file.changeType === 'deleted') {
      score += 1;
      reasons.push(`file deleted: ${file.relPath}`);
    }
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(text)) {
      score += 3;
      reasons.push(`destructive command mention: ${pattern}`);
    }
  }
  const level = score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low';
  return { score, level, reasons: Array.from(new Set(reasons)).slice(0, 20) };
}

function scanSensitive(snapshotRoot, files = []) {
  const findings = { secrets: [], pii: [] };
  for (const file of files) {
    if (file.isBinary || !file.afterHash) continue;
    const text = readSnapshotContent(snapshotRoot, file.relPath, false);
    if (!text) continue;
    for (const entry of SECRET_PATTERNS) {
      if (entry.pattern.test(text)) findings.secrets.push({ relPath: file.relPath, type: entry.name });
    }
    for (const entry of PII_PATTERNS) {
      if (entry.pattern.test(text)) findings.pii.push({ relPath: file.relPath, type: entry.name });
    }
  }
  return {
    secrets: findings.secrets.slice(0, 30),
    pii: findings.pii.slice(0, 30)
  };
}

function deriveConfidence(files = [], validation = {}) {
  const total = files.length || 1;
  const codeFiles = files.filter(f => /\.(js|jsx|ts|tsx|py|go|java|rb|rs)$/.test(f.relPath)).length;
  const docFiles = files.filter(f => f.relPath.endsWith('.md')).length;
  let score = 0.3;
  score += Math.min(codeFiles / total, 1) * 0.2;
  score += Math.min(docFiles / total, 0.2);
  if (validation.testsPassed) score += 0.3;
  if (validation.typecheckPassed) score += 0.1;
  if (validation.lintPassed) score += 0.1;
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function nextStepSuggestions(session) {
  const steps = [];
  if ((session.sensitiveFindings?.secrets || []).length > 0) steps.push('Rotate exposed secrets and purge from history.');
  if ((session.sensitiveFindings?.pii || []).length > 0) steps.push('Review and redact possible PII before sharing artifacts.');
  if (session.risk?.level === 'high') steps.push('Request peer review before merge.');
  if (!session.validation?.testsRun) steps.push('Run tests for changed modules.');
  if (!session.validation?.lintRun) steps.push('Run lint and type checks.');
  if (session.impactMap?.docs === 0 && (session.changedFileCount || 0) > 3) steps.push('Consider adding docs or changelog notes.');
  return steps.slice(0, 5);
}

function smartSummary(changes = [], prompt = '') {
  if (!changes.length) return 'No file changes recorded.';
  const created = changes.filter(c => c.changeType === 'created').length;
  const modified = changes.filter(c => c.changeType === 'modified').length;
  const deleted = changes.filter(c => c.changeType === 'deleted').length;
  const top = changes.slice(0, 3).map(c => c.relPath).join(', ');
  const prefix = prompt ? `Task: ${prompt}. ` : '';
  return `${prefix}Updated ${changes.length} files (${modified} modified, ${created} created, ${deleted} deleted). Key files: ${top}${changes.length > 3 ? ', ...' : ''}`;
}

function changeFingerprint(files = []) {
  const parts = (files || [])
    .map(file => `${file.changeType}:${file.relPath}:${file.beforeHash || ''}:${file.afterHash || ''}`)
    .sort();
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function readSnapshotContent(snapshotRoot, relPath, isBinary) {
  const filePath = getSnapshotFile(snapshotRoot, relPath);
  if (!pathExists(filePath)) return null;
  if (isBinary) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function createPatchForChanges(session, changes) {
  const beforeRoot = session.snapshotBefore;
  const afterRoot = session.snapshotAfter;
  const patchParts = [];

  for (const change of changes) {
    const isBinary = Boolean((change.before && change.before.isBinary) || (change.after && change.after.isBinary));
    const beforeText = change.before ? readSnapshotContent(beforeRoot, change.relPath, isBinary) : '';
    const afterText = change.after ? readSnapshotContent(afterRoot, change.relPath, isBinary) : '';
    patchParts.push(createUnifiedDiff(change.relPath, beforeText, afterText, {
      changeType: change.changeType,
      isBinary
    }));
  }

  return patchParts.join('\n');
}

function startSession({
  cwd = process.cwd(),
  prompt = '',
  agentName = 'manual-agent',
  modelName = '',
  continueFromId = '',
  flowId = '',
  branchName = '',
  autoLink = true,
  reuseActive = false
} = {}) {
  const { repoRoot } = initRepo(cwd);
  const resolvedAgentName = resolveAgentName(agentName);
  const resolvedModelName = resolveModelName(modelName);
  const existing = getActiveSession(repoRoot);
  if (existing) {
    if (reuseActive) return existing;
    throw new Error(`An AgentGit session is already active: ${existing.id}. Stop it first.`);
  }
  const ledger = getLedger(repoRoot);

  const id = randomId('ag');
  const snapshotBefore = agentgitPath(repoRoot, 'snapshots', id, 'before');
  const gitStatus = statusShort(repoRoot);
  let parentSession = null;
  let continuationMode = 'manual';
  if (continueFromId) {
    parentSession = ledger.sessions.find(s => s.id === continueFromId || s.id.startsWith(continueFromId)) || null;
    if (!parentSession) throw new Error(`No AgentGit session found for continuation: ${continueFromId}`);
  } else if (autoLink) {
    const found = findContinuationParent({ sessions: ledger.sessions, prompt, agentName: resolvedAgentName, modelName: resolvedModelName });
    parentSession = found.parent;
    if (parentSession) continuationMode = `auto(sim:${found.similarity.toFixed(2)})`;
  }
  const resolvedFlowId = String(flowId || parentSession?.flowId || parentSession?.id || id);
  const session = {
    id,
    repoRoot,
    agentName: resolvedAgentName,
    modelName: resolvedModelName,
    prompt,
    startedAt: nowIso(),
    endedAt: null,
    baseGitSha: currentSha(repoRoot),
    initialGitStatus: gitStatus,
    flowId: resolvedFlowId,
    parentSessionId: parentSession?.id || null,
    branchName: branchName || null,
    continuationMode,
    snapshotBefore,
    snapshotAfter: agentgitPath(repoRoot, 'snapshots', id, 'after'),
    patchPath: agentgitPath(repoRoot, 'patches', `${id}.patch`),
    status: 'active'
  };

  const manifest = takeSnapshot(repoRoot, snapshotBefore);
  session.beforeFileCount = Object.keys(manifest.files).length;
  session.beforeSkippedCount = manifest.skipped.length;
  writeJson(agentgitPath(repoRoot, ACTIVE_FILE), session);
  return session;
}

function stopSession({ cwd = process.cwd(), summary = '', tags = [], validation = {} } = {}) {
  const repoRoot = normalizeRepo(cwd);
  initRepo(repoRoot);
  const session = getActiveSession(repoRoot);
  if (!session) {
    throw new Error('No active AgentGit session found. Run `agentgit start` first.');
  }

  const afterManifest = takeSnapshot(repoRoot, session.snapshotAfter);
  const beforeManifest = loadSnapshotManifest(session.snapshotBefore);
  const rawChanges = compareSnapshots(beforeManifest, afterManifest);

  const changes = rawChanges.map((change, index) => ({
    id: `${session.id}_file_${index + 1}`,
    relPath: change.relPath,
    changeType: change.changeType,
    beforeHash: change.before ? change.before.hash : null,
    afterHash: change.after ? change.after.hash : null,
    beforeSize: change.before ? change.before.size : null,
    afterSize: change.after ? change.after.size : null,
    isBinary: Boolean((change.before && change.before.isBinary) || (change.after && change.after.isBinary))
  }));

  const patch = createPatchForChanges(session, rawChanges);
  ensureDir(path.dirname(session.patchPath));
  fs.writeFileSync(session.patchPath, patch || '', 'utf8');

  const generatedSummary = smartSummary(changes, session.prompt);
  const completedSession = {
    ...session,
    endedAt: nowIso(),
    status: rawChanges.length > 0 ? 'completed' : 'empty',
    summary: String(summary || '').trim() || generatedSummary,
    finalGitStatus: statusShort(repoRoot),
    afterFileCount: Object.keys(afterManifest.files).length,
    afterSkippedCount: afterManifest.skipped.length,
    changedFileCount: changes.length,
    files: changes,
    changeFingerprint: changeFingerprint(changes),
    patchRelPath: safeRelative(repoRoot, session.patchPath),
    tags: Array.from(new Set([...(Array.isArray(tags) ? tags : []), ...tagsFromText(session.prompt, String(summary || '').trim() || generatedSummary)])).sort(),
    impactMap: makeImpactMap(changes),
    risk: calculateRisk(changes, session.prompt, summary),
    smartSummary: generatedSummary,
    validation: {
      testsRun: Boolean(validation.testsRun),
      testsPassed: Boolean(validation.testsPassed),
      lintRun: Boolean(validation.lintRun),
      lintPassed: Boolean(validation.lintPassed),
      typecheckRun: Boolean(validation.typecheckRun),
      typecheckPassed: Boolean(validation.typecheckPassed)
    }
  };
  completedSession.sensitiveFindings = scanSensitive(session.snapshotAfter, changes);
  completedSession.confidence = deriveConfidence(changes, completedSession.validation);
  completedSession.nextSteps = nextStepSuggestions(completedSession);
  const ledger = getLedger(repoRoot);
  const recent = (ledger.sessions || []).slice(0, DUPLICATE_LOOKBACK);
  const duplicate = recent.find((candidate) => (
    candidate?.changeFingerprint &&
    candidate.changeFingerprint === completedSession.changeFingerprint
  ));
  if (duplicate) {
    completedSession.duplicateOf = duplicate.id;
    completedSession.tags = Array.from(new Set([...(completedSession.tags || []), 'duplicate'])).sort();
  }
  const prevSig = ledger.sessions[0]?.signature || '';
  const signSalt = readOrCreateSignatureSalt(repoRoot);
  const signPayload = JSON.stringify({
    id: completedSession.id,
    startedAt: completedSession.startedAt,
    endedAt: completedSession.endedAt,
    changedFileCount: completedSession.changedFileCount,
    patchRelPath: completedSession.patchRelPath,
    prevSig
  });
  completedSession.prevSignature = prevSig;
  completedSession.signature = crypto.createHash('sha256').update(`${signSalt}:${signPayload}`).digest('hex');
  completedSession.signatureVersion = 1;
  ledger.sessions.unshift(completedSession);
  saveLedger(repoRoot, ledger);
  fs.rmSync(agentgitPath(repoRoot, ACTIVE_FILE), { force: true });
  return completedSession;
}

function verifyLedger({ cwd = process.cwd() } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const ledger = getLedger(repoRoot);
  const signSalt = readOrCreateSignatureSalt(repoRoot);
  const issues = [];
  let expectedPrev = '';
  for (let i = ledger.sessions.length - 1; i >= 0; i--) {
    const s = ledger.sessions[i];
    const payload = JSON.stringify({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      changedFileCount: s.changedFileCount,
      patchRelPath: s.patchRelPath,
      prevSig: s.prevSignature || ''
    });
    const expected = crypto.createHash('sha256').update(`${signSalt}:${payload}`).digest('hex');
    if (s.signature && s.signature !== expected) issues.push({ id: s.id, issue: 'signature_mismatch' });
    if ((s.prevSignature || '') !== expectedPrev) issues.push({ id: s.id, issue: 'chain_link_mismatch' });
    expectedPrev = s.signature || expectedPrev;
  }
  return { ok: issues.length === 0, issues, checked: ledger.sessions.length };
}

function listSessions({ cwd = process.cwd(), limit = 50 } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const ledger = getLedger(repoRoot);
  return ledger.sessions.slice(0, limit);
}

function findSession(repoRoot, idOrPrefix) {
  const ledger = getLedger(repoRoot);
  const session = ledger.sessions.find(s => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!session) throw new Error(`No AgentGit session found for: ${idOrPrefix}`);
  return { ledger, session };
}

function readPatch({ cwd = process.cwd(), id }) {
  const repoRoot = normalizeRepo(cwd);
  const { session } = findSession(repoRoot, id);
  if (!pathExists(session.patchPath)) return '';
  return fs.readFileSync(session.patchPath, 'utf8');
}

function searchSessions({ cwd = process.cwd(), query = '' } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const needle = query.toLowerCase().trim();
  if (!needle) return listSessions({ cwd: repoRoot });
  const terms = needle.split(/\s+/).filter(Boolean);
  return listSessions({ cwd: repoRoot, limit: 1000 }).filter(session => {
    const haystack = [
      session.id,
      session.agentName,
      session.modelName,
      session.prompt,
      session.summary,
      session.startedAt,
      session.endedAt,
      session.flowId,
      session.parentSessionId,
      session.branchName,
      ...(session.tags || []),
      session.smartSummary,
      session.confidence,
      session.risk ? `${session.risk.level} ${session.risk.score}` : '',
      ...(session.files || []).map(file => `${file.relPath} ${file.changeType}`)
    ].filter(Boolean).join('\n').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

function sessionChangeSet(session) {
  return new Set((session.files || []).map(f => `${f.changeType}:${f.relPath}`));
}

function compareSessions({ cwd = process.cwd(), leftId, rightId } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const { session: left } = findSession(repoRoot, leftId);
  const { session: right } = findSession(repoRoot, rightId);
  const leftSet = sessionChangeSet(left);
  const rightSet = sessionChangeSet(right);
  const onlyLeft = Array.from(leftSet).filter(x => !rightSet.has(x));
  const onlyRight = Array.from(rightSet).filter(x => !leftSet.has(x));
  const overlap = Array.from(leftSet).filter(x => rightSet.has(x));
  return {
    left: { id: left.id, summary: left.summary || left.prompt || left.id, changedFileCount: left.changedFileCount || 0 },
    right: { id: right.id, summary: right.summary || right.prompt || right.id, changedFileCount: right.changedFileCount || 0 },
    overlapCount: overlap.length,
    onlyLeftCount: onlyLeft.length,
    onlyRightCount: onlyRight.length,
    overlap,
    onlyLeft,
    onlyRight
  };
}

function buildPrDraft({ cwd = process.cwd(), id, titlePrefix = '' } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const { session } = findSession(repoRoot, id);
  const titleBase = session.summary || session.smartSummary || session.prompt || session.id;
  const title = `${titlePrefix ? `${titlePrefix.trim()} ` : ''}${titleBase}`.trim();
  const lines = [];
  lines.push(`## Summary`);
  lines.push(session.smartSummary || session.summary || 'Updated tracked files.');
  lines.push('');
  lines.push('## What Changed');
  for (const file of session.files || []) {
    lines.push(`- ${file.changeType}: \`${file.relPath}\``);
  }
  lines.push('');
  lines.push('## Risk');
  lines.push(`- Level: ${session.risk?.level || 'unknown'} (${session.risk?.score ?? 'n/a'})`);
  if ((session.risk?.reasons || []).length) {
    for (const reason of session.risk.reasons.slice(0, 5)) lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Validation');
  lines.push(`- Tests: ${session.validation?.testsRun ? (session.validation.testsPassed ? 'run and passed' : 'run and failed/unknown') : 'not run'}`);
  lines.push(`- Lint: ${session.validation?.lintRun ? (session.validation.lintPassed ? 'run and passed' : 'run and failed/unknown') : 'not run'}`);
  lines.push(`- Typecheck: ${session.validation?.typecheckRun ? (session.validation.typecheckPassed ? 'run and passed' : 'run and failed/unknown') : 'not run'}`);
  lines.push('');
  lines.push('## Follow Ups');
  for (const step of session.nextSteps || []) lines.push(`- ${step}`);
  const body = lines.join('\n');
  return { sessionId: session.id, title, body };
}

function buildContextPack({
  cwd = process.cwd(),
  query = '',
  sessionId = '',
  objective = 'bugfix',
  limitSessions = 6,
  maxFiles = 20,
  maxChars = 6000
} = {}) {
  const mode = ['revert', 'bugfix', 'build'].includes(String(objective)) ? String(objective) : 'bugfix';
  const repoRoot = normalizeRepo(cwd);
  let sessions = [];
  if (sessionId) {
    const { session } = findSession(repoRoot, sessionId);
    sessions = [session];
    if (session.flowId) {
      const flowSessions = showFlow({ cwd: repoRoot, flowId: session.flowId }).slice(-Math.max(1, limitSessions));
      sessions = flowSessions;
    }
  } else if (query && String(query).trim()) {
    sessions = searchSessions({ cwd: repoRoot, query }).slice(0, Math.max(1, limitSessions));
  } else {
    sessions = listSessions({ cwd: repoRoot, limit: Math.max(1, limitSessions) });
  }

  const scoreSession = (session) => {
    const tags = session.tags || [];
    const files = session.files || [];
    const relPaths = files.map((f) => String(f.relPath || '').toLowerCase());
    const validation = session.validation || {};
    let score = 0;
    if (mode === 'revert') {
      if (session.status === 'completed') score += 4;
      if (session.status === 'reverted') score -= 2;
      if (session.duplicateOf) score += 2;
      score += Math.min(files.length, 6);
      score += relPaths.filter((p) => /firestore\.rules|auth|security|payment|migration|schema/.test(p)).length * 2;
    } else if (mode === 'build') {
      score += relPaths.filter((p) => /package\.json|lock|tsconfig|next\.config|postcss|eslint|\.ya?ml|docker/i.test(p)).length * 3;
      if (!validation.typecheckPassed) score += 2;
      if (!validation.lintPassed) score += 1;
      if (!validation.testsPassed) score += 1;
      score += Math.min(files.length, 4);
    } else {
      if (tags.includes('hotfix') || tags.includes('auth')) score += 3;
      if (!validation.testsPassed) score += 2;
      if (session.risk?.level === 'high') score += 2;
      if (session.risk?.level === 'medium') score += 1;
      score += Math.min(files.length, 5);
      score += relPaths.filter((p) => /app\/|components\/|lib\//.test(p)).length;
    }
    return score;
  };
  sessions = [...sessions].sort((a, b) => scoreSession(b) - scoreSession(a)).slice(0, Math.max(1, limitSessions));

  const fileFreq = new Map();
  for (const s of sessions) {
    for (const f of s.files || []) {
      fileFreq.set(f.relPath, (fileFreq.get(f.relPath) || 0) + 1);
    }
  }
  const scoreFile = (relPath, count) => {
    const p = String(relPath || '').toLowerCase();
    let score = count * 2;
    if (mode === 'revert') {
      if (/firestore\.rules|auth|security|payment|migration|schema/.test(p)) score += 8;
      if (/lock|tsbuildinfo|\.log$/.test(p)) score -= 4;
    } else if (mode === 'build') {
      if (/package\.json|lock|tsconfig|next\.config|postcss|eslint|\.ya?ml|docker/i.test(p)) score += 8;
      if (/node_modules|\.next/.test(p)) score -= 8;
    } else {
      if (/app\/|components\/|lib\//.test(p)) score += 4;
      if (/test|spec/.test(p)) score += 2;
      if (/readme|\.md$/.test(p)) score -= 1;
    }
    return score;
  };
  const hotFiles = Array.from(fileFreq.entries())
    .map(([relPath, count]) => ({ relPath, count, score: scoreFile(relPath, count) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxFiles))
    .map(({ relPath, count, score }) => ({ relPath, count, score }));

  const sessionCards = sessions.map((s) => ({
    id: s.id,
    parentSessionId: s.parentSessionId || null,
    flowId: s.flowId || null,
    branchName: s.branchName || null,
    agent: s.agentName || 'unknown-agent',
    model: s.modelName || 'unknown-model',
    status: s.status,
    summary: s.summary || s.smartSummary || s.prompt || '',
    changedFileCount: s.changedFileCount || 0,
    risk: s.risk ? { level: s.risk.level, score: s.risk.score } : null,
    duplicateOf: s.duplicateOf || null,
    topFiles: (s.files || []).slice(0, 5).map((f) => `${f.changeType}:${f.relPath}`),
    validation: s.validation || {}
  }));

  const compactLines = [];
  compactLines.push(`# AgentGit Context Pack`);
  compactLines.push(`objective=${mode} sessions=${sessionCards.length} hotFiles=${hotFiles.length}`);
  for (const s of sessionCards) {
    compactLines.push(
      `S ${s.id} | ${s.agent}/${s.model} | ${s.status} | risk:${s.risk ? `${s.risk.level}:${s.risk.score}` : 'n/a'} | files:${s.changedFileCount}${s.duplicateOf ? ` | dup:${s.duplicateOf}` : ''}`
    );
    if (s.summary) compactLines.push(`  ${String(s.summary).replace(/\s+/g, ' ').slice(0, 180)}`);
    if (s.topFiles.length) compactLines.push(`  files: ${s.topFiles.join(', ')}`);
  }
  if (hotFiles.length) {
    compactLines.push(`Hot files: ${hotFiles.map((x) => `${x.relPath}(${x.count}|s${x.score})`).join(', ')}`);
  }

  let compactText = compactLines.join('\n');
  if (compactText.length > maxChars) {
    compactText = `${compactText.slice(0, maxChars)}\n...[truncated context pack]`;
  }

  return {
    repoRoot,
    generatedAt: nowIso(),
    query: query || null,
    sessionId: sessionId || null,
    objective: mode,
    tokenEfficient: true,
    sessions: sessionCards,
    hotFiles,
    compactText
  };
}

function currentFileInfo(repoRoot, relPath) {
  const fullPath = path.join(repoRoot, relPath);
  if (!pathExists(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return null;
  const buffer = fs.readFileSync(fullPath);
  return {
    relPath,
    hash: sha256(buffer),
    size: stat.size,
    isBinary: isProbablyBinary(buffer)
  };
}

function getSessionRawChange(session, file) {
  const beforeFile = file.beforeHash ? path.join(session.snapshotBefore, file.relPath) : null;
  const afterFile = file.afterHash ? path.join(session.snapshotAfter, file.relPath) : null;
  const isBinary = Boolean(file.isBinary);
  const beforeText = beforeFile && pathExists(beforeFile) && !isBinary ? fs.readFileSync(beforeFile, 'utf8') : '';
  const afterText = afterFile && pathExists(afterFile) && !isBinary ? fs.readFileSync(afterFile, 'utf8') : '';
  return { beforeFile, afterFile, beforeText, afterText, isBinary };
}

function previewRevert({ cwd = process.cwd(), id } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const { session } = findSession(repoRoot, id);
  const parts = [];
  const checks = [];

  for (const file of session.files || []) {
    const current = currentFileInfo(repoRoot, file.relPath);
    let safe = false;
    let reason = '';

    if (file.changeType === 'created') {
      safe = current && current.hash === file.afterHash;
      reason = safe ? 'will delete created file' : 'current file differs from tracked created file';
    } else if (file.changeType === 'deleted') {
      safe = !current;
      reason = safe ? 'will restore deleted file' : 'file exists again; manual review needed';
    } else {
      safe = current && current.hash === file.afterHash;
      reason = safe ? 'will restore previous content' : 'current file has changed since tracked task';
    }

    checks.push({ relPath: file.relPath, changeType: file.changeType, safe, reason });

    const raw = getSessionRawChange(session, file);
    parts.push(createReversePreview(file.relPath, raw.beforeText, raw.afterText, {
      changeType: file.changeType,
      isBinary: raw.isBinary
    }));
  }

  const previewToken = crypto.createHash('sha256').update(`${session.id}:${checks.map(c => `${c.relPath}:${c.safe}`).join('|')}`).digest('hex').slice(0, 16);
  return {
    session,
    checks,
    safe: checks.every(check => check.safe),
    requiresForce: !checks.every(check => check.safe),
    previewToken,
    patch: parts.join('\n')
  };
}

function applyRevert({ cwd = process.cwd(), id, force = false, previewToken = '' } = {}) {
  const repoRoot = normalizeRepo(cwd);
  const { ledger, session } = findSession(repoRoot, id);
  const preview = previewRevert({ cwd: repoRoot, id: session.id });
  if (!previewToken || previewToken !== preview.previewToken) {
    throw new Error('Revert blocked: missing or stale preview token. Run revert preview and pass the returned preview token.');
  }
  const unsafe = preview.checks.filter(check => !check.safe);
  if (unsafe.length > 0 && !force) {
    const details = unsafe.map(check => `- ${check.relPath}: ${check.reason}`).join('\n');
    throw new Error(`Revert is not clean. Use --force only if you accept overwriting conflicts.\n${details}`);
  }

  const applied = [];
  for (const file of session.files || []) {
    const target = path.join(repoRoot, file.relPath);
    const raw = getSessionRawChange(session, file);

    if (file.changeType === 'created') {
      if (pathExists(target)) {
        fs.rmSync(target, { force: true });
        removeEmptyParents(path.dirname(target), repoRoot);
      }
      applied.push({ relPath: file.relPath, action: 'deleted_created_file' });
    } else if (file.changeType === 'deleted') {
      if (!raw.beforeFile || !pathExists(raw.beforeFile)) continue;
      ensureDir(path.dirname(target));
      fs.copyFileSync(raw.beforeFile, target);
      applied.push({ relPath: file.relPath, action: 'restored_deleted_file' });
    } else {
      if (!raw.beforeFile || !pathExists(raw.beforeFile)) continue;
      ensureDir(path.dirname(target));
      fs.copyFileSync(raw.beforeFile, target);
      applied.push({ relPath: file.relPath, action: 'restored_previous_content' });
    }
  }

  const targetSession = ledger.sessions.find(s => s.id === session.id);
  if (targetSession) {
    targetSession.status = 'reverted';
    targetSession.revertedAt = nowIso();
    targetSession.revertAppliedFiles = applied;
    saveLedger(repoRoot, ledger);
  }

  return { session: targetSession || session, applied };
}

function formatSession(session) {
  const title = session.summary || session.prompt || '(no prompt)';
  const risk = session.risk ? `${session.risk.level}(${session.risk.score})` : 'n/a';
  const confidence = session.confidence || 'n/a';
  const tags = (session.tags || []).join(', ') || 'none';
  const flow = session.flowId ? `\n  flow: ${session.flowId}${session.parentSessionId ? ` (parent ${session.parentSessionId})` : ''}${session.branchName ? ` [${session.branchName}]` : ''}` : '';
  const duplicate = session.duplicateOf ? `\n  duplicateOf: ${session.duplicateOf}` : '';
  return `${session.id}\n  ${title}\n  agent: ${(session.agentName || 'unknown-agent')} / ${(session.modelName || 'unknown-model')}\n  started: ${session.startedAt}\n  files: ${session.changedFileCount || 0}\n  status: ${session.status}${flow}${duplicate}\n  risk: ${risk}\n  confidence: ${confidence}\n  tags: ${tags}`;
}

function exportMarkdown({ cwd = process.cwd(), since = null, tag = '', mode = 'date' } = {}) {
  const sessions = listSessions({ cwd, limit: 1000 });
  let filtered = since ? sessions.filter(s => new Date(s.startedAt) >= new Date(since)) : sessions;
  if (tag) filtered = filtered.filter(s => (s.tags || []).includes(tag));
  const lines = ['# AgentGit Changelog', ''];
  lines.push(`_Mode: ${mode}_`);
  lines.push('');
  for (const session of filtered) {
    lines.push(`## ${session.summary || session.prompt || session.id}`);
    lines.push('');
    lines.push(`- ID: \`${session.id}\``);
    lines.push(`- Agent: ${session.agentName || 'unknown'}`);
    if (session.modelName) lines.push(`- Model: ${session.modelName}`);
    lines.push(`- Started: ${session.startedAt}`);
    lines.push(`- Status: ${session.status}`);
    lines.push(`- Base Git SHA: ${session.baseGitSha || 'n/a'}`);
    lines.push(`- Changed files: ${session.changedFileCount || 0}`);
    if (session.tags?.length) lines.push(`- Tags: ${session.tags.join(', ')}`);
    if (session.risk) lines.push(`- Risk: ${session.risk.level} (${session.risk.score})`);
    if (session.confidence) lines.push(`- Confidence: ${session.confidence}`);
    if (session.prompt) lines.push(`- Prompt: ${session.prompt}`);
    if (session.summary) lines.push(`- Summary: ${session.summary}`);
    if (session.smartSummary) lines.push(`- Smart Summary: ${session.smartSummary}`);
    if (session.nextSteps?.length) lines.push(`- Suggested Next Steps: ${session.nextSteps.join(' | ')}`);
    lines.push('');
    for (const file of session.files || []) {
      lines.push(`  - ${file.changeType}: \`${file.relPath}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function groupByFlow(sessions = []) {
  const map = new Map();
  for (const session of sessions) {
    const key = session.flowId || session.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(session);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
  }
  return map;
}

function listFlows({ cwd = process.cwd(), limit = 20 } = {}) {
  const sessions = listSessions({ cwd, limit: 5000 });
  const grouped = groupByFlow(sessions);
  const flows = [];
  for (const [flowId, items] of grouped.entries()) {
    const roots = items.filter(s => !s.parentSessionId || !items.some(x => x.id === s.parentSessionId));
    const latest = items[items.length - 1];
    flows.push({
      flowId,
      sessionCount: items.length,
      rootSessionIds: roots.map(s => s.id),
      startedAt: items[0]?.startedAt || null,
      latestAt: latest?.endedAt || latest?.startedAt || null,
      latestSummary: latest?.summary || latest?.prompt || latest?.id || flowId
    });
  }
  flows.sort((a, b) => new Date(b.latestAt || 0).getTime() - new Date(a.latestAt || 0).getTime());
  return flows.slice(0, limit);
}

function showFlow({ cwd = process.cwd(), flowId } = {}) {
  const sessions = listSessions({ cwd, limit: 5000 });
  const grouped = groupByFlow(sessions);
  if (grouped.has(flowId)) return grouped.get(flowId);
  const byPrefix = Array.from(grouped.entries()).find(([id]) => id === flowId || String(id).startsWith(flowId));
  if (!byPrefix) throw new Error(`No AgentGit flow found for: ${flowId}`);
  return byPrefix[1];
}

function flowGraph({ cwd = process.cwd(), flowId } = {}) {
  const flowSessions = showFlow({ cwd, flowId });
  const byId = new Map(flowSessions.map(s => [s.id, s]));
  const children = new Map();
  for (const session of flowSessions) {
    if (!children.has(session.id)) children.set(session.id, []);
  }
  for (const session of flowSessions) {
    if (session.parentSessionId && byId.has(session.parentSessionId)) {
      if (!children.has(session.parentSessionId)) children.set(session.parentSessionId, []);
      children.get(session.parentSessionId).push(session);
    }
  }
  for (const arr of children.values()) {
    arr.sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
  }
  const roots = flowSessions
    .filter(s => !s.parentSessionId || !byId.has(s.parentSessionId))
    .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
  const lines = [];
  const walk = (node, prefix = '', isLast = true) => {
    const marker = prefix ? (isLast ? '└─ ' : '├─ ') : '';
    const summary = (node.summary || node.prompt || '').replace(/\s+/g, ' ').slice(0, 70);
    const branch = node.branchName ? ` [${node.branchName}]` : '';
    lines.push(`${prefix}${marker}${node.id}${branch}${summary ? ` · ${summary}` : ''}`);
    const kids = children.get(node.id) || [];
    const nextPrefix = prefix + (prefix ? (isLast ? '   ' : '│  ') : '');
    kids.forEach((child, index) => walk(child, nextPrefix, index === kids.length - 1));
  };
  roots.forEach((root, index) => walk(root, '', index === roots.length - 1));
  return {
    flowId: flowSessions[0]?.flowId || flowId,
    sessionCount: flowSessions.length,
    roots: roots.map(r => r.id),
    lines
  };
}

module.exports = {
  AGENTGIT_DIR,
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
};
