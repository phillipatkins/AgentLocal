
const path = require('path');

function cleanJsonString(str) {
  return String(str || '')
    .replace(/\r/g, '')
    .replace(/\\\s*\n\s*/g, '')
    .trim();
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.tool) return parsed;
  } catch (_) {}
  return null;
}

function unescapeJsonString(value) {
  try {
    return JSON.parse(`"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch (_) {
    return String(value || '')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
}

function decodeCapturedString(value) {
  const cleaned = cleanJsonString(String(value || ''));
  try {
    return JSON.parse(`"${cleaned}"`);
  } catch (_) {
    return cleaned
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
}

function extractBalancedJsonObjects(raw) {
  const results = [];
  const text = String(raw || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function parseToolCallLoosely(candidate) {
  const text = cleanJsonString(candidate);

  const toolMatch = text.match(/"tool"\s*:\s*"([^"]+)"/s);
  if (!toolMatch) return null;

  const tool = toolMatch[1];
  const args = {};

  const pathMatch = text.match(/"path"\s*:\s*"((?:\\.|[^"])*)"/s);
  if (pathMatch) args.path = decodeCapturedString(pathMatch[1]);

  const commandMatch = text.match(/"command"\s*:\s*"((?:\\.|[^"])*)"/s);
  if (commandMatch) args.command = decodeCapturedString(commandMatch[1]);

  const contentMatch = text.match(/"content"\s*:\s*"([\s\S]*)"\s*}\s*}\s*$/s);
  if (contentMatch) args.content = decodeCapturedString(contentMatch[1]);

  if (!tool) return null;
  return { tool, args };
}

function scoreToolCall(call) {
  if (!call || typeof call !== 'object' || !call.tool) return -1;
  const args = call.args || {};
  let score = 10;

  if (typeof args.path === 'string') {
    if (args.path.trim()) score += 10;
    const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');
    if (args.path.startsWith(projectRoot)) score += 15;
    if (args.path.includes('example.txt')) score -= 100;
    if (args.path === '...') score -= 100;
  }

  if (typeof args.content === 'string') {
    if (args.content.trim()) score += 10;
    score += Math.min(args.content.length / 100, 25);
    if (args.content === '...') score -= 100;
    if (args.content.includes('real content here')) score -= 100;
    if (args.content.toLowerCase().includes('<!doctype html') || args.content.toLowerCase().includes('<html')) score += 20;
  }

  if (typeof args.command === 'string') {
    if (args.command.trim()) score += 5;
    if (args.command === '...') score -= 50;
  }

  return score;
}

function extractToolCall(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const direct = tryParseJson(cleanJsonString(raw));
  if (direct) return direct;

  const candidates = extractBalancedJsonObjects(raw)
    .map((candidate) => tryParseJson(cleanJsonString(candidate)) || parseToolCallLoosely(candidate))
    .filter(Boolean);

  if (!candidates.length) {
    const loose = parseToolCallLoosely(raw);
    return loose || null;
  }

  candidates.sort((a, b) => scoreToolCall(a) - scoreToolCall(b));
  return candidates[candidates.length - 1];
}

module.exports = {
  extractToolCall,
  cleanJsonString
};
