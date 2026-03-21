// whatsapp/core/security.js
// Guards for risky actions (file ops, shell, etc.)

const SAFE_COMMANDS = [/^ls/, /^cat /, /^echo /, /^pwd/, /^whoami/, /^uptime/];

function isSafeCommand(cmd) {
  return SAFE_COMMANDS.some(re => re.test(cmd.trim()));
}

function needsConfirmation(cmd, chatId, userId) {
  if (isSafeCommand(cmd)) return false;
  // Place for more granular logic: whitelist, roles, etc.
  return true;
}

module.exports = { isSafeCommand, needsConfirmation };
