// whatsapp/core/errorHandler.js
const logFile = 'bot-errors.log';
const fs = require('fs');

function logError(error, context = '') {
  const ts = new Date().toISOString();
  const message = `[${ts}] ${context}: ${error && error.stack ? error.stack : error}\n`;
  fs.appendFileSync(logFile, message, 'utf8');
  if (process.env.NODE_ENV !== 'production') {
    console.error(message);
  }
}

function handle(err, userFeedback = 'An error occurred.') {
  logError(err);
  return userFeedback;
}

module.exports = { logError, handle };
