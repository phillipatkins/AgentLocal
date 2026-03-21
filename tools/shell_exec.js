const { resolvePath, getWorkspace } = require('../utils/workspace');
const terminalSessions = require('../utils/terminal_sessions');

module.exports = async function shellExec(args = {}) {
  try {
    const command = String(args.command || '').trim();

    if (!command) {
      return {
        ok: false,
        error: 'No command provided'
      };
    }

    const cwd = args.cwd
      ? resolvePath(String(args.cwd))
      : getWorkspace();

    return await terminalSessions.startSession({
      chatId: args.chatId,
      command,
      cwd
    });
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error)
    };
  }
};