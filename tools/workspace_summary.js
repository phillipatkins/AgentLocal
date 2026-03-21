const fs = require('fs');
const path = require('path');
const { getWorkspace } = require('../utils/workspace');

module.exports = async function workspace_summary() {

  try {

    const root = getWorkspace();

    const files = fs.readdirSync(root);

    const summary = {
      root,
      languages: new Set(),
      entryPoints: [],
      packageManagers: []
    };

    files.forEach(f => {

      const ext = path.extname(f);

      if(ext === '.py') summary.languages.add('python');
      if(ext === '.js') summary.languages.add('javascript');
      if(ext === '.ts') summary.languages.add('typescript');

      if(f === 'package.json') summary.packageManagers.push('npm');
      if(f === 'requirements.txt') summary.packageManagers.push('pip');

      if(f === 'app.py' || f === 'main.py') summary.entryPoints.push(f);
      if(f === 'index.js' || f === 'server.js') summary.entryPoints.push(f);

    });

    return {
      ok:true,
      workspace:root,
      files,
      languages:Array.from(summary.languages),
      entryPoints:summary.entryPoints,
      packageManagers:summary.packageManagers
    };

  } catch(err) {

    return {
      ok:false,
      error:err.message
    };

  }

};