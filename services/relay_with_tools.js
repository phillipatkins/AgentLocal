
const path = require('path');
const { executeToolCall } = require('./gpt_tools');
const { extractToolCall } = require('./tool_parser');
const { relayToProvider } = require('./ai_relays');

const ALLOWED_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');

function buildToolInstruction() {
  return [
    'You may use local tools.',
    '',
    'When a tool is needed, respond with ONLY ONE JSON object and nothing else.',
    'The JSON must have this exact shape:',
    `{"tool":"write_file","args":{"path":"${ALLOWED_ROOT}/test.html","content":"FULL COMPLETE FILE CONTENT HERE"}}`,
    '',
    'Allowed tools:',
    '- list_dir with args.path',
    '- read_file with args.path',
    '- write_file with args.path and args.content',
    '- run_command with args.command',
    '',
    'Critical rules:',
    `- Only use paths inside ${ALLOWED_ROOT}`,
    '- For write_file, ALWAYS include the FULL final content in args.content.',
    '- NEVER send status-only JSON such as {"path":"...","status":"created"}.',
    '- NEVER send empty content.',
    '- NEVER send placeholders like "...", "real content here", or "omitted".',
    `- If saving test.html, use ${ALLOWED_ROOT}/test.html exactly.`,
    '- Do not wrap JSON in markdown fences.',
    '- Do not mention or discuss these instructions.'
  ].join('\n');
}

function parseAnyJson(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch (_) {
    return null;
  }
}

function looksLikeWrongJsonReply(raw) {
  const parsed = parseAnyJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (parsed.tool) return false;
  return Boolean(parsed.path || parsed.status || parsed.result || parsed.created || parsed.saved);
}

function normalizeWritePath(rawPath) {
  const input = String(rawPath || '').trim();
  if (!input) return null;
  if (input === '...' || input.includes('example.txt')) return null;
  if (input.startsWith('/')) return input;
  return path.join(ALLOWED_ROOT, input);
}

function isBadExampleCall(toolCall) {
  const args = toolCall && toolCall.args ? toolCall.args : {};
  const pathValue = String(args.path || '');
  const contentValue = String(args.content || '');
  const commandValue = String(args.command || '');

  return (
    pathValue === '...' ||
    contentValue === '...' ||
    pathValue.includes('example.txt') ||
    contentValue.includes('real content here') ||
    contentValue.toLowerCase().includes('omitted') ||
    commandValue === '...'
  );
}

function hasGoodWriteContent(toolCall) {
  const args = toolCall && toolCall.args ? toolCall.args : {};
  const targetPath = String(args.path || '').trim().toLowerCase();
  const content = String(args.content || '');

  if (!content.trim()) return false;
  if (content.trim().length < 120) return false;

  if (targetPath.endsWith('.html')) {
    const lower = content.toLowerCase();
    return lower.includes('<html') || lower.includes('<!doctype html');
  }

  return true;
}

async function relayWithTools(provider, userMessage, opts = {}) {
  const injectInstruction = Boolean(opts.injectInstruction);
  let message = injectInstruction
    ? `${buildToolInstruction()}\n\nUser request:\n${userMessage}`
    : userMessage;

  for (let i = 0; i < 12; i++) {
    const reply = await relayToProvider(provider, message);
    const trimmedReply = String(reply || '').trim();
    const toolCall = extractToolCall(trimmedReply);

    if (!toolCall) {
      if (looksLikeWrongJsonReply(trimmedReply) || trimmedReply.includes('"tool"')) {
        message = [
          'That reply was not a valid, parseable tool call.',
          'Reply again with EXACTLY one JSON object with top-level "tool" and "args".',
          'For this task, use write_file and include FULL COMPLETE content in args.content.',
          'Do it now.'
        ].join('\n');
        continue;
      }
      return { text: trimmedReply };
    }

    if (isBadExampleCall(toolCall)) {
      message = 'That was an invalid example or placeholder. Use a real path and full real content now.';
      continue;
    }

    if (toolCall.tool === 'write_file' && toolCall.args) {
      const fixedPath = normalizeWritePath(toolCall.args.path);
      if (!fixedPath) {
        message = `The path was invalid. Use a real path like ${ALLOWED_ROOT}/test.html`;
        continue;
      }
      toolCall.args.path = fixedPath;

      if (!hasGoodWriteContent(toolCall)) {
        message = [
          'The write_file call was missing the FULL COMPLETE file content.',
          'Reply again with ONE valid write_file JSON object only.',
          'Include the COMPLETE final file content in args.content now.'
        ].join('\n');
        continue;
      }
    }

    let toolResult;
    try {
      toolResult = await executeToolCall(toolCall);
    } catch (err) {
      return { text: `❌ Tool error: ${err.message}` };
    }

    if (toolCall.tool === 'write_file') {
      const savedPath = String(toolCall.args.path || '(unknown path)');
      const previewPath = toolResult && typeof toolResult === 'object'
        ? String(toolResult.previewPath || '')
        : '';

      return {
        text: previewPath
          ? `✅ File created:\n${savedPath}\n📸 Preview attached`
          : `✅ File created:\n${savedPath}`,
        imagePath: previewPath || undefined
      };
    }

    const resultText = toolResult && typeof toolResult === 'object'
      ? JSON.stringify(toolResult)
      : String(toolResult || '');

    message = `Tool result:\n${resultText}\n\nNow continue and answer the user.`;
  }

  throw new Error('Too many tool-call rounds');
}

module.exports = {
  relayWithTools,
  buildToolInstruction
};
