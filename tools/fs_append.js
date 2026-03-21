const fs = require('fs');
const path = require('path');
const { getWorkspace } = require('../utils/workspace');

module.exports = async function fs_append(args = {}) {
  try {
    let target = args.path || '';
    let content = args.content || '';

    if (!target) {
      return { ok: false, error: 'No file path provided.' };
    }

    const workspace = getWorkspace();

    const resolved = path.isAbsolute(target)
      ? target
      : path.join(workspace, target);

    fs.appendFileSync(resolved, content + '\n');

    return {
      ok: true,
      path: resolved,
      appended: true
    };

  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
};