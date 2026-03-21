const { spawn } = require('child_process');

const sessions = new Map();
const OUTPUT_LIMIT = 12000;

function trimOutput(text) {
  if (!text) return '';
  if (text.length <= OUTPUT_LIMIT) return text;
  return text.slice(text.length - OUTPUT_LIMIT);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSession(chatId) {
  return sessions.get(chatId) || null;
}

function hasActiveSession(chatId) {
  const session = getSession(chatId);
  return !!(session && session.active);
}

function appendOutput(session, chunk) {
  session.buffer += chunk.toString();
  session.buffer = trimOutput(session.buffer);
  session.lastActivityAt = Date.now();
}

function drainOutput(session) {
  const output = session.buffer || '';
  session.buffer = '';
  return output;
}

async function startSession({ chatId, command, cwd }) {
  if (!chatId) {
    return {
      ok: false,
      error: 'chatId is required for interactive terminal sessions'
    };
  }

  if (!command || !String(command).trim()) {
    return {
      ok: false,
      error: 'No command provided'
    };
  }

  const existing = getSession(chatId);
  if (existing && existing.active) {
    return {
      ok: false,
      error: `A terminal session is already active for this chat`,
      active: true,
      command: existing.command,
      cwd: existing.cwd
    };
  }

  const proc = spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const session = {
    chatId,
    process: proc,
    pid: proc.pid,
    command,
    cwd,
    active: true,
    exitCode: null,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    buffer: ''
  };

  proc.stdout.on('data', chunk => appendOutput(session, chunk));
  proc.stderr.on('data', chunk => appendOutput(session, chunk));

  proc.on('close', code => {
    session.active = false;
    session.exitCode = code;
    session.lastActivityAt = Date.now();
  });

  proc.on('error', err => {
    appendOutput(session, `\n[process error] ${err.message}\n`);
    session.active = false;
    session.exitCode = -1;
    session.lastActivityAt = Date.now();
  });

  sessions.set(chatId, session);

  await wait(700);

  return {
    ok: true,
    active: session.active,
    pid: session.pid,
    command: session.command,
    cwd: session.cwd,
    output: drainOutput(session),
    exitCode: session.exitCode
  };
}

async function sendInput(chatId, input) {
  const session = getSession(chatId);

  if (!session || !session.active) {
    return {
      ok: false,
      error: 'No active terminal session for this chat'
    };
  }

  session.process.stdin.write(`${String(input)}\n`);
  session.lastActivityAt = Date.now();

  await wait(700);

  return {
    ok: true,
    active: session.active,
    pid: session.pid,
    command: session.command,
    cwd: session.cwd,
    output: drainOutput(session),
    exitCode: session.exitCode
  };
}

function getStatus(chatId) {
  const session = getSession(chatId);

  if (!session) {
    return {
      ok: false,
      error: 'No terminal session found for this chat'
    };
  }

  return {
    ok: true,
    active: session.active,
    pid: session.pid,
    command: session.command,
    cwd: session.cwd,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    exitCode: session.exitCode,
    bufferedOutput: session.buffer || ''
  };
}

async function terminateSession(chatId) {
  const session = getSession(chatId);

  if (!session) {
    return {
      ok: false,
      error: 'No terminal session found for this chat'
    };
  }

  if (session.active) {
    session.process.kill('SIGTERM');
    await wait(300);
  }

  const output = drainOutput(session);
  session.active = false;

  return {
    ok: true,
    active: false,
    pid: session.pid,
    command: session.command,
    cwd: session.cwd,
    exitCode: session.exitCode,
    output
  };
}

module.exports = {
  hasActiveSession,
  startSession,
  sendInput,
  getStatus,
  terminateSession
};