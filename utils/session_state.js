
const sessions = new Map();

function createSession(chatId) {
  return {
    chatId,
    currentFile: null,
    lastGeneratedCode: null,
    lastToolResult: null,
    lastListing: null,
    lastWorkspace: null,
    lastWorkspaceSummary: null,
    activeTopic: null,
    awaitingDailyDigestReply: false,
    digestPromptedForDate: null,
    awaitingCheckinReply: false,
    checkinSentAt: null,
    updatedAt: Date.now()
  };
}

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, createSession(chatId));
  }
  return sessions.get(chatId);
}

function updateSession(chatId, patch = {}) {
  const session = getSession(chatId);
  Object.assign(session, patch, { updatedAt: Date.now() });
  return session;
}

function setCurrentFile(chatId, file) {
  return updateSession(chatId, { currentFile: file || null });
}

function getCurrentFile(chatId) {
  return getSession(chatId).currentFile || null;
}

function clearCurrentFile(chatId) {
  return updateSession(chatId, { currentFile: null });
}

function setLastGeneratedCode(chatId, value) {
  return updateSession(chatId, { lastGeneratedCode: value || null });
}

function getLastGeneratedCode(chatId) {
  return getSession(chatId).lastGeneratedCode || null;
}

function setLastToolResult(chatId, value) {
  return updateSession(chatId, { lastToolResult: value || null });
}

function getLastToolResult(chatId) {
  return getSession(chatId).lastToolResult || null;
}

function setLastListing(chatId, value) {
  return updateSession(chatId, { lastListing: value || null });
}

function getLastListing(chatId) {
  return getSession(chatId).lastListing || null;
}

function setLastWorkspace(chatId, value) {
  return updateSession(chatId, { lastWorkspace: value || null });
}

function getLastWorkspace(chatId) {
  return getSession(chatId).lastWorkspace || null;
}

function setLastWorkspaceSummary(chatId, value) {
  return updateSession(chatId, { lastWorkspaceSummary: value || null });
}

function getLastWorkspaceSummary(chatId) {
  return getSession(chatId).lastWorkspaceSummary || null;
}

function setActiveTopic(chatId, topic) {
  return updateSession(chatId, { activeTopic: topic || null });
}

function getActiveTopic(chatId) {
  return getSession(chatId).activeTopic || null;
}

function setAwaitingDailyDigestReply(chatId, value, dateKey = null) {
  return updateSession(chatId, {
    awaitingDailyDigestReply: Boolean(value),
    digestPromptedForDate: value ? dateKey || getSession(chatId).digestPromptedForDate : null
  });
}

function isAwaitingDailyDigestReply(chatId) {
  return Boolean(getSession(chatId).awaitingDailyDigestReply);
}

function setAwaitingCheckinReply(chatId, value) {
  return updateSession(chatId, {
    awaitingCheckinReply: Boolean(value),
    checkinSentAt: value ? Date.now() : null
  });
}

function isAwaitingCheckinReply(chatId) {
  return Boolean(getSession(chatId).awaitingCheckinReply);
}

module.exports = {
  getSession,
  updateSession,
  setCurrentFile,
  getCurrentFile,
  clearCurrentFile,
  setLastGeneratedCode,
  getLastGeneratedCode,
  setLastToolResult,
  getLastToolResult,
  setLastListing,
  getLastListing,
  setLastWorkspace,
  getLastWorkspace,
  setLastWorkspaceSummary,
  getLastWorkspaceSummary,
  setActiveTopic,
  getActiveTopic,
  setAwaitingDailyDigestReply,
  isAwaitingDailyDigestReply,
  setAwaitingCheckinReply,
  isAwaitingCheckinReply
};
