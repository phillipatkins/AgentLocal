const fs = require('fs');
const path = require('path');
const { resolvePath, getWorkspace } = require('../utils/workspace');

const MAX_ITEMS = 200;

module.exports = function fsList(args = {}) {
  try {
    const targetPath = resolvePath(args.path);

    if (!fs.existsSync(targetPath)) {
      return {
        ok: false,
        error: `Path does not exist: ${targetPath}`
      };
    }

    const stat = fs.statSync(targetPath);

    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: `Path is not a directory: ${targetPath}`
      };
    }

    const names = fs.readdirSync(targetPath);

    const items = names
      .map(name => {
        const fullPath = path.join(targetPath, name);

        try {
          const itemStat = fs.statSync(fullPath);

          return {
            name,
            path: fullPath,
            type: itemStat.isDirectory() ? 'dir' : 'file',
            size: itemStat.isDirectory() ? null : itemStat.size,
            modified: itemStat.mtime.toISOString()
          };

        } catch {
          return {
            name,
            path: fullPath,
            type: 'unknown',
            size: null,
            modified: null
          };
        }
      })
      .sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });

    const limited = items.slice(0, MAX_ITEMS);

    return {
      ok: true,
      path: targetPath,
      workspace: getWorkspace(),
      total: items.length,
      truncated: items.length > MAX_ITEMS,
      items: limited
    };

  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};