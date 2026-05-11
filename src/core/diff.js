function splitLines(text) {
  if (text === null || text === undefined) return [];
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.length === 0) return [];
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'context', value: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', value: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'add', value: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'remove', value: oldLines[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', value: newLines[j] });
    j++;
  }
  return ops;
}

function createUnifiedDiff(filePath, beforeText, afterText, options = {}) {
  const changeType = options.changeType || 'modified';
  const isBinary = Boolean(options.isBinary);
  const safePath = filePath.replace(/\\/g, '/');

  if (isBinary) {
    return [
      `diff --agentgit a/${safePath} b/${safePath}`,
      `Binary file ${safePath} changed`,
      ''
    ].join('\n');
  }

  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const ops = lcsDiff(beforeLines, afterLines);
  const oldCount = beforeLines.length;
  const newCount = afterLines.length;
  const oldStart = oldCount > 0 ? 1 : 0;
  const newStart = newCount > 0 ? 1 : 0;

  const header = [
    `diff --agentgit a/${safePath} b/${safePath}`,
    changeType === 'created' ? 'new file mode 100644' : null,
    changeType === 'deleted' ? 'deleted file mode 100644' : null,
    `--- ${changeType === 'created' ? '/dev/null' : `a/${safePath}`}`,
    `+++ ${changeType === 'deleted' ? '/dev/null' : `b/${safePath}`}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
  ].filter(Boolean);

  const body = ops.map(op => {
    if (op.type === 'add') return `+${op.value}`;
    if (op.type === 'remove') return `-${op.value}`;
    return ` ${op.value}`;
  });

  return [...header, ...body, ''].join('\n');
}

function createReversePreview(filePath, beforeText, afterText, options = {}) {
  return createUnifiedDiff(filePath, afterText, beforeText, {
    ...options,
    changeType: options.changeType === 'created'
      ? 'deleted'
      : options.changeType === 'deleted'
        ? 'created'
        : 'modified'
  });
}

module.exports = {
  splitLines,
  createUnifiedDiff,
  createReversePreview
};
