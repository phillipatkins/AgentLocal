const fs = require('fs');
const { resolvePath, getWorkspace } = require('../utils/workspace');

module.exports = async function fsPatch(args = {}) {
  try {
    const targetPath = resolvePath(args.path);
    const mode = String(args.mode || 'replace').toLowerCase();
    const find = args.find == null ? '' : String(args.find);
    const replace = args.replace == null ? '' : String(args.replace);
    const content = args.content == null ? '' : String(args.content);

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

    let original = fs.readFileSync(targetPath, 'utf8');
    let updated = original;

    if (mode === 'replace') {
      if (!find) {
        return {
          ok: false,
          error: 'Missing "find" text for replace mode.'
        };
      }

      if (!original.includes(find)) {
        return {
          ok: false,
          error: 'Search text was not found in the file.'
        };
      }

      updated = original.replace(find, replace);
    } else if (mode === 'append') {
      updated = original + content;
    } else if (mode === 'prepend') {
      updated = content + original;
    } else if (mode === 'overwrite') {
      updated = content;
    } else {
      return {
        ok: false,
        error: `Unsupported patch mode: ${mode}`
      };
    }

    fs.writeFileSync(targetPath, updated, 'utf8');

    return {
      ok: true,
      path: targetPath,
      workspace: getWorkspace(),
      mode,
      changed: updated !== original,
      originalBytes: Buffer.byteLength(original, 'utf8'),
      updatedBytes: Buffer.byteLength(updated, 'utf8'),
      preview: updated.slice(0, 500)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};