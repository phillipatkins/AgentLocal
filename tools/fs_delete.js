const fs = require('fs');
const { resolvePath, getWorkspace } = require('../utils/workspace');

module.exports = function fsDelete(args = {}) {
  try {
    const targetPath = resolvePath(args.path);

    if (!fs.existsSync(targetPath)) {
      return {
        ok: false,
        error: `Path does not exist`
      };
    }

    const stat = fs.statSync(targetPath);

    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });

      return {
        ok: true,
        deletedType: 'directory',
        path: targetPath,
        workspace: getWorkspace()
      };
    }

    fs.unlinkSync(targetPath);

    return {
      ok: true,
      deletedType: 'file',
      path: targetPath,
      workspace: getWorkspace()
    };

  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};