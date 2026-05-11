const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git',
  '.agentgit',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  'out',
  'target',
  'vendor',
  '.venv',
  '__pycache__'
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function readJson(filePath, fallback) {
  if (!pathExists(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse JSON at ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isProbablyBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function safeRelative(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/');
}

function shouldIgnoreDir(name) {
  return IGNORED_DIRS.has(name);
}

function walkFiles(rootDir) {
  const results = [];
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.vscode') {
        if (shouldIgnoreDir(entry.name)) continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return results;
}

function copyFilePreserveRoot(sourceFile, targetRoot, relativePath) {
  const targetFile = path.join(targetRoot, relativePath);
  ensureDir(path.dirname(targetFile));
  fs.copyFileSync(sourceFile, targetFile);
}

function removeEmptyParents(startDir, stopDir) {
  let current = startDir;
  const stop = path.resolve(stopDir);
  while (path.resolve(current).startsWith(stop) && path.resolve(current) !== stop) {
    try {
      fs.rmdirSync(current);
    } catch (_) {
      break;
    }
    current = path.dirname(current);
  }
}

function readTextIfSafe(filePath, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  if (!pathExists(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > maxBytes) return null;
  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) return null;
  return buffer.toString('utf8');
}

module.exports = {
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
};
