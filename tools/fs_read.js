const fs = require('fs');
const { resolvePath, getWorkspace } = require('../utils/workspace');

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

function isBinary(buffer) {
  const sample = buffer.slice(0, 512);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

module.exports = function fsRead(args = {}) {
  try {
    const targetPath = resolvePath(args.path);

    if (!fs.existsSync(targetPath)) {
      return {
        ok: false,
        error: `File does not exist: ${targetPath}`
      };
    }

    const stat = fs.statSync(targetPath);

    if (!stat.isFile()) {
      return {
        ok: false,
        error: `Path is not a file: ${targetPath}`
      };
    }

    if (stat.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        error: `File too large (${stat.size} bytes)`
      };
    }

    const buffer = fs.readFileSync(targetPath);

    if (isBinary(buffer)) {
      return {
        ok: false,
        error: `File appears to be binary`
      };
    }

    return {
      ok: true,
      path: targetPath,
      workspace: getWorkspace(),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      content: buffer.toString('utf8')
    };

  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};