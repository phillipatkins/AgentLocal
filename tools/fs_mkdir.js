const fs = require('fs');
const { resolvePath, getWorkspace } = require('../utils/workspace');

module.exports = function fsMkdir(args = {}) {
  try {
    const targetPath = resolvePath(args.path);

    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);

      if (stat.isDirectory()) {
        return {
          ok: true,
          created: false,
          path: targetPath,
          workspace: getWorkspace(),
          message: 'Directory already exists'
        };
      }

      return {
        ok: false,
        error: `File exists at that path`
      };
    }

    fs.mkdirSync(targetPath, { recursive: true });

    return {
      ok: true,
      created: true,
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