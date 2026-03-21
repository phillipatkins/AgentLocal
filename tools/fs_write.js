const fs = require('fs');
const path = require('path');
const { resolvePath, getWorkspace } = require('../utils/workspace');

module.exports = function fsWrite(args = {}) {
  try {
    const targetPath = resolvePath(args.path);
    const content = args.content == null ? '' : String(args.content);
    const overwrite = args.overwrite !== false;

    const parent = path.dirname(targetPath);

    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    if (fs.existsSync(targetPath) && !overwrite) {
      return {
        ok: false,
        error: `File exists and overwrite=false`
      };
    }

    fs.writeFileSync(targetPath, content, 'utf8');

    const stat = fs.statSync(targetPath);

    return {
      ok: true,
      path: targetPath,
      workspace: getWorkspace(),
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      size: stat.size,
      modified: stat.mtime.toISOString()
    };

  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};