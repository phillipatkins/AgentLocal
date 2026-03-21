const fs = require('fs');
const path = require('path');

let workspace = path.resolve(process.cwd(), 'workspace');

function ensureWorkspace() {
  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }
}

function getWorkspace() {
  ensureWorkspace();
  return workspace;
}

function setWorkspace(newPath) {
  const resolved = path.resolve(newPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  workspace = resolved;

  return workspace;
}

function resolvePath(input = '') {
  if (!input || !input.trim()) {
    return getWorkspace();
  }

  const raw = input.trim();

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  return path.resolve(getWorkspace(), raw);
}

module.exports = {
  getWorkspace,
  setWorkspace,
  resolvePath
};