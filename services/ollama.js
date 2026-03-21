const fs = require('fs');
const memoryText = fs.existsSync('memory.txt')
  ? fs.readFileSync('memory.txt', 'utf8')
  : '';
const path = require('path');
const ollama = require('ollama').default;
const config = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const workspaceManager = require('../utils/workspace');
const sessionState = require('../utils/session_state');

function loadOptionalModule(candidates) {
  for (const mod of candidates) {
    try { return require(mod); } catch (_) {}
  }
  return null;
}

const memoryStore = loadOptionalModule([
  '../services/memory_store'
]);

const { detectSearchIntent, braveSearch, formatSearchResults } = require('./web_search');
const { detectTaskIntent, handleTaskIntent } = require('./tasks');

const MEMORY_FILE = path.join(process.cwd(), 'memory.txt');
function truncate(text, max = 200) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function readPermanentMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      return '';
    }
    return fs.readFileSync(MEMORY_FILE, 'utf8').trim();
  } catch (error) {
    logger.line('ERR', 'readPermanentMemory failed', error.message || String(error));
    return '';
  }
}

function buildMemoryBlock(structuredMemories) {
  const legacyMemory = readPermanentMemory();

  let structuredBlock = '';
  if (structuredMemories && structuredMemories.length) {
    const formatted = structuredMemories
      .map(m => `- [${m.category || 'general'}] ${m.content}`)
      .join('\n');
    structuredBlock = `Structured memories:\n${formatted}`;
  }

  return [
    'Permanent user memory:',
    legacyMemory || '(none)',
    structuredBlock ? `\n${structuredBlock}` : '',
    '',
    'Memory rules:',
    '- Only reference memories explicitly listed above.',
    '- Never invent memories or past events.',
    '- If the user asks what you remember, check the permanent memory first.',
    '- If nothing relevant is listed, say you do not recall any recorded memory about that topic.'
  ].filter(s => s !== undefined).join('\n');
}

function buildAugmentedSystemPrompt(systemPrompt, structuredMemories, chatId) {
  const parts = [systemPrompt || '', '', buildMemoryBlock(structuredMemories)];

  // Inject location context if available
  if (chatId) {
    try {
      const loc = storage.getLastLocation(chatId);
      if (loc && loc.latitude) {
        parts.push('', `User's last known location: lat=${loc.latitude.toFixed(4)}, lon=${loc.longitude.toFixed(4)}${loc.description ? ` (${loc.description})` : ''}. Use this if asked about local weather, places, or directions.`);
      }
    } catch {}
  }

  return parts.filter(Boolean).join('\n');
}

function buildFallbackPrompt(systemPrompt, history, userPrompt) {
  const recent = (history || [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-6);

  const historyText = recent
  .map(msg => `${msg.role.toUpperCase()}: ${msg.content || ''}`)
  .join('\n');

  return [
    buildAugmentedSystemPrompt(systemPrompt),
    '',
    'Important instructions:',
    '- Reply to the latest user message directly.',
    '- Do not assume the user is asking about files, workspace, code, or tools unless the latest message clearly asks for that.',
    '- Do not repeat stale context from earlier turns unless it is directly relevant.',
    '- Use permanent memory when relevant, but never invent memories.',
    '',
    historyText ? 'Recent conversation:' : '',
    historyText,
    '',
    `LATEST USER MESSAGE: ${userPrompt}`,
    'ASSISTANT:'
  ].filter(Boolean).join('\n');
}

function resolveContextualPrompt(history, prompt) {
  const lower = prompt.toLowerCase();

  if (/(this|that|it)\b/.test(lower)) {
    const lastAssistant = [...history]
      .reverse()
      .find(m => m.role === 'assistant' && m.content);

    if (lastAssistant) {
      return `${prompt}\n\nContext from previous message:\n${lastAssistant.content}`;
    }
  }

  return prompt;
}

function buildDirectChatMessages(systemPrompt, history, userPrompt, conversationSummary) {
  const augmentedSystemPrompt = buildAugmentedSystemPrompt(systemPrompt);

  const recent = (history || [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-6);

  const systemContent = [
    augmentedSystemPrompt,
    '',
    'Conversation rules:',
    '- Maintain natural conversation.',
    '- Use recent messages when the user refers to "this", "that", or "it".',
    '- Only reference memories listed in the permanent memory section.',
    '- Never invent past events or medical issues.',
    '- If no memory exists, say you do not remember.',
    '',
    'Opinion rules:',
    '- You have genuine opinions and preferences. Express them naturally.',
    '- If the user says something you disagree with or that is clearly wrong, push back calmly but directly.',
    "- Don't always agree — if something is a bad idea, say so.",
    '- If asked for your opinion, give a real one. Avoid wishy-washy non-answers unless it genuinely is unclear.',
    '- You can find things boring, interesting, stupid, or impressive. Say so when relevant.',
    '- Very occasionally (not every message) volunteer an opinion unprompted if you have something real to say.',
    conversationSummary
      ? `\nConversation history summary (older messages):\n${conversationSummary}`
      : ''
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: systemContent },
    ...recent,
    { role: 'user', content: userPrompt }
  ];
}

async function chatHistoryWithFallback(systemPrompt, history, userPrompt, conversationSummary) {
  let replyText = '';

  try {
    const response = await ollama.chat({
      model: config.DEFAULT_MODEL,
      messages: buildDirectChatMessages(
        buildAugmentedSystemPrompt(systemPrompt),
        history,
        userPrompt,
        conversationSummary
      )
    });

    logger.line(
      'SYS',
      'ollama.chat response',
      truncate(JSON.stringify(response), 180)
    );

    if (
      response &&
      response.message &&
      typeof response.message.content === 'string' &&
      response.message.content.trim()
    ) {
      replyText = response.message.content.trim();
    }
  } catch (error) {
    logger.line('ERR', 'ollama.chat failed', error.message || String(error));
  }

  if (!replyText) {
    try {
      const fallbackPrompt = buildFallbackPrompt(systemPrompt, history, userPrompt);

      const generateResponse = await ollama.generate({
        model: config.DEFAULT_MODEL,
        prompt: fallbackPrompt
      });

      logger.line(
        'SYS',
        'ollama.generate response',
        truncate(JSON.stringify(generateResponse), 180)
      );

      if (
        generateResponse &&
        typeof generateResponse.response === 'string' &&
        generateResponse.response.trim()
      ) {
        replyText = generateResponse.response.trim();
      }
    } catch (error) {
      logger.line('ERR', 'ollama.generate failed', error.message || String(error));
    }
  }

  return replyText.trim();
}

async function promptModel(systemPrompt, promptText) {
  let replyText = '';
  const augmentedSystemPrompt = buildAugmentedSystemPrompt(systemPrompt);

  try {
    const response = await ollama.chat({
      model: config.DEFAULT_MODEL,
      messages: [
        { role: 'system', content: augmentedSystemPrompt },
        { role: 'user', content: promptText }
      ]
    });

    if (
      response &&
      response.message &&
      typeof response.message.content === 'string' &&
      response.message.content.trim()
    ) {
      replyText = response.message.content.trim();
    }
  } catch (error) {
    logger.line('ERR', 'ollama.chat prompt failed', error.message || String(error));
  }

  if (!replyText) {
    try {
      const generateResponse = await ollama.generate({
        model: config.DEFAULT_MODEL,
        prompt: `${augmentedSystemPrompt}\n\n${promptText}`
      });

      if (
        generateResponse &&
        typeof generateResponse.response === 'string' &&
        generateResponse.response.trim()
      ) {
        replyText = generateResponse.response.trim();
      }
    } catch (error) {
      logger.line('ERR', 'ollama.generate prompt failed', error.message || String(error));
    }
  }

  return replyText.trim();
}

function normalizePathFromPrompt(prompt, fallback = '') {
  let text = String(prompt || '').trim();

  text = text
    .replace(/^read\s+/i, '')
    .replace(/^show\s+/i, '')
    .replace(/^open\s+/i, '')
    .replace(/^analyse\s+/i, '')
    .replace(/^analyze\s+/i, '')
    .replace(/^inspect\s+/i, '')
    .replace(/^study\s+/i, '')
    .replace(/^list\s+/i, '')
    .replace(/^delete\s+/i, '')
    .replace(/^remove\s+/i, '')
    .replace(/^make\s+(a\s+)?folder\s+/i, '')
    .replace(/^create\s+(a\s+)?folder\s+/i, '')
    .replace(/^create\s+(a\s+)?directory\s+/i, '')
    .replace(/^make\s+(a\s+)?directory\s+/i, '')
    .replace(/^write\s+/i, '')
    .replace(/^append\s+/i, '')
    .trim();

  text = text
    .replace(/^files?\s+in\s+(the\s+)?workspace$/i, '')
    .replace(/^files?\s+in\s+/i, '')
    .replace(/^in\s+(the\s+)?workspace$/i, '')
    .replace(/^workspace$/i, '')
    .replace(/^the\s+workspace$/i, '')
    .replace(/^current\s+workspace$/i, '')
    .replace(/\s+code and analy[sz]e it and tell me what it does$/i, '')
    .replace(/\s+and analy[sz]e it and tell me what it does$/i, '')
    .trim();

  return text || fallback;
}

function extractPathCandidate(text) {
  const str = String(text || '');
  const match = str.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9_]+)/);
  return match ? match[1].trim() : '';
}

function basenameOf(filePath) {
  return filePath ? path.basename(filePath) : '';
}

function detectCasualChatIntent(prompt) {
  const lower = String(prompt || '').toLowerCase().trim();

  const casualPatterns = [
    /^hi$/,
    /^hello$/,
    /^hey$/,
    /^hello mate$/,
    /^lol\b/,
    /^what you up to\??$/,
    /^how are you\??$/,
    /^do you know any interesting facts\??$/,
    /^tell me some facts about .+/,
    /^what can you do\??$/,
    /^thanks\b/,
    /^ok thanks\b/,
    /^nice\b/
  ];

  return casualPatterns.some(pattern => pattern.test(lower));
}

function detectWorkspaceNavIntent(prompt) {
  const raw = String(prompt || '').trim().toLowerCase();

  if (
    raw === 'where are we now' ||
    raw === 'where are we' ||
    raw === 'what folder are we in' ||
    raw === 'what directory are we in'
  ) {
    return { type: 'where' };
  }

  if (
    raw === '..' ||
    raw === '../' ||
    raw.includes('go up one folder') ||
    raw.includes('go up a folder') ||
    raw.includes('go to parent folder') ||
    raw === 'go up' ||
    raw.startsWith('go up again')
  ) {
    return { type: 'up', levels: 1 };
  }

  const match = raw.match(/^go up (\d+) folders?$/);
  if (match) {
    return {
      type: 'up',
      levels: Math.max(1, parseInt(match[1], 10) || 1)
    };
  }

  return null;
}

function detectFsIntent(prompt) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase().trim();

  if (
    lower === 'list' ||
    lower === 'list files' ||
    lower === 'list all files' ||
    lower === 'list the files' ||
    lower === 'list files in workspace' ||
    lower === 'list files in the workspace' ||
    lower === 'list all the files in the workspace' ||
    lower === 'show files in workspace' ||
    lower === 'show files in the workspace' ||
    lower === 'show me the files in workspace' ||
    lower === 'show me the files in the workspace'
  ) {
    return {
      tool: 'fs_list',
      args: { path: '' }
    };
  }

  if (
    lower.startsWith('list files in ') ||
    lower.startsWith('show files in ') ||
    lower.startsWith('show me the files in ')
  ) {
    const target = normalizePathFromPrompt(raw, '');
    return {
      tool: 'fs_list',
      args: { path: target }
    };
  }

  if (
    lower.startsWith('make a folder ') ||
    lower.startsWith('create a folder ') ||
    lower.startsWith('create a directory ') ||
    lower.startsWith('make a directory ')
  ) {
    return {
      tool: 'fs_mkdir',
      args: { path: normalizePathFromPrompt(raw) }
    };
  }

  if (
    lower.startsWith('delete ') ||
    lower.startsWith('remove ')
  ) {
    return {
      tool: 'fs_delete',
      args: { path: normalizePathFromPrompt(raw) }
    };
  }

  const writeMatch = raw.match(
    /^write\s+(?:a\s+file\s+called\s+)?(.+?)\s+containing\s+([\s\S]+)$/i
  );

  if (writeMatch) {
    return {
      tool: 'fs_write',
      args: {
        path: writeMatch[1].trim(),
        content: writeMatch[2].trim(),
        overwrite: true
      }
    };
  }

  return null;
}

function detectFsExistsIntent(prompt) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase().trim();

  let match = lower.match(/^is there (?:a |an )?(.+?) in (?:the )?workspace\??$/i);
  if (match) {
    return {
      file: match[1].trim(),
      path: ''
    };
  }

  match = lower.match(/^does (.+?) exist in (?:the )?workspace\??$/i);
  if (match) {
    return {
      file: match[1].trim(),
      path: ''
    };
  }

  match = lower.match(/^is there (?:a |an )?(.+?)\??$/i);
  if (match && /\.[a-z0-9]+$/i.test(match[1].trim())) {
    return {
      file: match[1].trim(),
      path: ''
    };
  }

  return null;
}

function detectWorkspaceSummaryIntent(prompt) {
  const lower = String(prompt || '').toLowerCase().trim();

  return (
    lower.includes('scan workspace') ||
    lower.includes('project summary') ||
    lower.includes('what is this project') ||
    lower.includes('summarise the workspace') ||
    lower.includes('summarize the workspace') ||
    lower.includes('how do i run this project') ||
    lower.includes('where is the main file')
  );
}

function detectShellIntent(prompt) {
  const rawOriginal = String(prompt || '').trim();
  const raw = rawOriginal.toLowerCase();

  let match = rawOriginal.match(/^run\s+python\s+script\s+(.+)$/i);
  if (match) {
    return {
      tool: 'shell_exec',
      args: {
        command: `python3 ${match[1].trim()}`
      }
    };
  }

  match = rawOriginal.match(/^run\s+(.+\.py)$/i);
  if (match) {
    return {
      tool: 'shell_exec',
      args: {
        command: `python3 ${match[1].trim()}`
      }
    };
  }

  match = rawOriginal.match(/^run\s+(.+\.js)$/i);
  if (match) {
    return {
      tool: 'shell_exec',
      args: {
        command: `node ${match[1].trim()}`
      }
    };
  }

  match = rawOriginal.match(/^run\s+(.+\.sh)$/i);
  if (match) {
    return {
      tool: 'shell_exec',
      args: {
        command: `bash ${match[1].trim()}`
      }
    };
  }

  if (raw.includes('npm install')) {
    return {
      tool: 'shell_exec',
      args: { command: 'npm install' }
    };
  }

  if (raw.startsWith('pip install')) {
    return {
      tool: 'shell_exec',
      args: { command: rawOriginal.trim() }
    };
  }

  if (raw.includes('run pytest') || raw === 'pytest') {
    return {
      tool: 'shell_exec',
      args: { command: 'pytest' }
    };
  }

  if (raw.includes('start the server')) {
    return {
      tool: 'shell_exec',
      args: { command: 'npm start' }
    };
  }

  match = rawOriginal.match(/^(run|execute|shell)\s+(.+)$/i);
  if (match) {
    return {
      tool: 'shell_exec',
      args: {
        command: match[2].trim()
      }
    };
  }

  return null;
}

function detectSaveIntent(prompt) {
  const raw = String(prompt || '').trim();

  let match = raw.match(/^save it as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  match = raw.match(/^save this as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  match = raw.match(/^save that as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  match = raw.match(/^save (?:it|this|that)?\s*(?:in the workspace\s*)?as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  match = raw.match(/^can you create this .* and save it (?:in the workspace )?as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  match = raw.match(/^create this .* and save it (?:in the workspace )?as\s+(.+)$/i);
  if (match) return { path: match[1].trim() };

  if (
    /^save it$/i.test(raw) ||
    /^save this$/i.test(raw) ||
    /^save that$/i.test(raw) ||
    /^save the file$/i.test(raw) ||
    /^save file$/i.test(raw) ||
    /^save it now$/i.test(raw) ||
    /^save the file now$/i.test(raw)
  ) {
    return { path: '' };
  }

  return null;
}

function detectFileReadAnalyzeIntent(prompt, chatId) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase();
  const session = sessionState.getSession(chatId);
  const currentFile = session.currentFile;
  const currentBasename = basenameOf(currentFile?.path);

  const explicitPath = extractPathCandidate(raw);

  const readKeywords = /(read|open|show|inspect|study)/i.test(raw);
  const analyzeKeywords =
    /(analy[sz]e|explain|understand|what does .* do|tell me what it does)/i.test(lower);

  if (explicitPath && (readKeywords || analyzeKeywords)) {
    return {
      type: analyzeKeywords ? 'read_and_analyze' : 'read',
      path: explicitPath
    };
  }

  if (currentFile) {
    const refersToCurrent =
      /\bit\b/.test(lower) ||
      /\bthat file\b/.test(lower) ||
      /\bthis file\b/.test(lower) ||
      (currentBasename && lower.includes(currentBasename.toLowerCase()));

    if (refersToCurrent && analyzeKeywords) {
      return {
        type: 'analyze_current',
        path: currentFile.path
      };
    }

    if (refersToCurrent && /^(read|open|show)\b/i.test(raw)) {
      return {
        type: 'read_current',
        path: currentFile.path
      };
    }
  }

  return null;
}

function detectEditIntent(prompt, chatId) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase().trim();
  const session = sessionState.getSession(chatId);
  const currentFile = session.currentFile;
  const currentBasename = basenameOf(currentFile?.path);

  let match = lower.match(/^overwrite\s+(.+?)\s+with\s+that$/i);
  if (match) {
    return { type: 'overwrite_with_cached', file: match[1].trim() };
  }

  match = raw.match(/^append\s+([\s\S]+?)\s+to\s+(.+)$/i);
  if (match) {
    return { type: 'append_literal', content: match[1].trim(), file: match[2].trim() };
  }

  match = raw.match(/^replace\s+["'`](.+?)["'`]\s+with\s+["'`]([\s\S]+?)["'`]\s+in\s+(.+)$/i);
  if (match) {
    return {
      type: 'exact_replace',
      find: match[1],
      replace: match[2],
      file: match[3].trim()
    };
  }

  match = raw.match(/^edit\s+(.+?)\s+so\s+it\s+(.+)$/i);
  if (match) {
    return { type: 'rewrite_with_model', file: match[1].trim(), instruction: `Edit this file so it ${match[2].trim()}.` };
  }

  match = raw.match(/^fix the bug in\s+(.+?)\s+and save it$/i);
  if (match) {
    return { type: 'rewrite_with_model', file: match[1].trim(), instruction: 'Fix the bug in this file and save the corrected full file.' };
  }

  if (currentFile) {
    const refersToCurrent =
      /\bit\b/.test(lower) ||
      /\bthat\b/.test(lower) ||
      /\bthis file\b/.test(lower) ||
      (currentBasename && lower.includes(currentBasename.toLowerCase()));

    if (refersToCurrent && /^(fix|repair)\s+it\b/i.test(raw)) {
      return {
        type: 'rewrite_with_model',
        file: currentFile.path,
        instruction: raw
      };
    }

    match = raw.match(/^add(?: this)? snippet\s+([\s\S]+?)\s+to\s+it$/i);
    if (match) {
      return {
        type: 'append_literal',
        content: match[1].trim(),
        file: currentFile.path
      };
    }

    match = raw.match(/^append\s+([\s\S]+?)\s+to\s+it$/i);
    if (match) {
      return {
        type: 'append_literal',
        content: match[1].trim(),
        file: currentFile.path
      };
    }

    match = raw.match(/^replace\s+["'`](.+?)["'`]\s+with\s+["'`]([\s\S]+?)["'`] in it$/i);
    if (match) {
      return {
        type: 'exact_replace',
        find: match[1],
        replace: match[2],
        file: currentFile.path
      };
    }

    if (refersToCurrent && /^(fix|repair|edit|update|change|add|replace)\b/i.test(raw)) {
      return {
        type: 'rewrite_with_model',
        file: currentFile.path,
        instruction: raw
      };
    }
  }

  return null;
}

function inferFilenameFromCodeRequest(prompt) {
  const raw = String(prompt || '').trim();

  let match = raw.match(/\b(?:save it as|save this as|save that as|save as)\s+([^\s]+)$/i);
  if (match) return match[1].trim();

  match = raw.match(/\b([A-Za-z0-9._/-]+\.(py|js|sh|txt|md|json|html|css))\b/i);
  if (match) return match[1].trim();

  return '';
}

function extractCodeBlocks(text) {
  const str = String(text || '');
  const blocks = [];

  const fencedRegex = /```(?:[a-zA-Z0-9_+-]*)?\n([\s\S]*?)```/g;
  let match;
  while ((match = fencedRegex.exec(str)) !== null) {
    const content = match[1].trim();
    if (content) {
      blocks.push(content);
    }
  }

  if (blocks.length) {
    return blocks;
  }

  const lines = str.split('\n');
  const langIndex = lines.findIndex(line =>
    /^(python|py|javascript|js|bash|sh|shell)$/i.test(line.trim())
  );

  if (langIndex !== -1) {
    const codeLines = [];

    for (let i = langIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        codeLines.length > 0 &&
        trimmed &&
        !looksLikeCodeLine(line) &&
        !line.startsWith(' ') &&
        !line.startsWith('\t')
      ) {
        break;
      }

      if (!trimmed && codeLines.length === 0) {
        continue;
      }

      codeLines.push(line);
    }

    const content = codeLines.join('\n').trim();
    if (content) {
      return [content];
    }
  }

  return [];
}

function looksLikeCodeLine(line) {
  const str = String(line || '');

  return (
    /^\s*(def|class|import|from|if|elif|else|for|while|try|except|with|return|print)\b/.test(str) ||
    /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(str) ||
    /^\s*#/.test(str) ||
    /:\s*$/.test(str) ||
    /\binput\s*\(/.test(str) ||
    /\bprint\s*\(/.test(str) ||
    /\bconsole\.log\s*\(/.test(str) ||
    /\{\s*$/.test(str) ||
    /;\s*$/.test(str)
  );
}

function looksLikeCode(text) {
  const str = String(text || '').trim();
  if (!str) return false;

  const lines = str.split('\n');
  let codeyLines = 0;

  for (const line of lines) {
    if (looksLikeCodeLine(line)) {
      codeyLines++;
    }
  }

  return codeyLines >= 2;
}

function getLastAssistantCode(history) {
  const reversed = [...(history || [])].reverse();

  for (const msg of reversed) {
    const role = String(msg.role || '').toLowerCase();

    if (!['assistant', 'bot', 'model'].includes(role)) {
      continue;
    }

    const content = String(msg.content || '').trim();
    if (!content) {
      continue;
    }

    const blocks = extractCodeBlocks(content);
    if (blocks.length) {
      return blocks[0];
    }

    if (looksLikeCode(content)) {
      return content;
    }
  }

  return '';
}

function maybeCacheGeneratedCode(chatId, prompt, replyText) {
  const promptText = String(prompt || '').toLowerCase();
  const reply = String(replyText || '');

  const blocks = extractCodeBlocks(reply);
  if (blocks.length) {
    const suggestedPath = inferFilenameFromCodeRequest(prompt);
    sessionState.setLastGeneratedCode(chatId, {
      code: blocks[0],
      suggestedPath,
      savedAt: Date.now()
    });
    return;
  }

  if (
    looksLikeCode(reply) ||
    promptText.includes('script') ||
    promptText.includes('python') ||
    promptText.includes('code')
  ) {
    const blocksOrRaw = extractCodeBlocks(reply);
    const code = blocksOrRaw[0] || reply.trim();

    if (looksLikeCode(code)) {
      const suggestedPath = inferFilenameFromCodeRequest(prompt);
      sessionState.setLastGeneratedCode(chatId, {
        code,
        suggestedPath,
        savedAt: Date.now()
      });
    }
  }
}

async function runTool(toolName, args) {
  const toolFunc = require(`../tools/${toolName}`);
  return await toolFunc(args || {});
}

function formatShellResult(result) {
  if (!result || result.ok === false) {
    return `Sorry — ${result?.error || 'the terminal command failed.'}`;
  }

  const output = (result.output || '').trim();
  const status = result.active
    ? 'running'
    : `exited${typeof result.exitCode === 'number' ? ` (${result.exitCode})` : ''}`;

  const sections = [
    `💻 *Terminal session started*`,
    `cwd: ${result.cwd}`,
    `$ ${result.command}`,
    `status: ${status}`
  ];

  if (output) {
    sections.push(`\n${output}`);
  } else {
    sections.push(`\n(no output yet)`);
  }

  sections.push(
    `\nSend any *non-command* message to reply to the terminal stdin.`,
    `Use /termstatus to inspect the session or /termkill to stop it.`
  );

  return sections.join('\n');
}

function summarizeWorkspace(result, prompt) {
  if (!result || result.ok === false) {
    return `Sorry — ${result?.error || 'I could not summarise the workspace.'}`;
  }

  const lower = String(prompt || '').toLowerCase();
  const files = result.files || [];
  const languages = result.languages || [];
  const entryPoints = result.entryPoints || [];
  const packageManagers = result.packageManagers || [];

  if (lower.includes('where is the main file')) {
    if (entryPoints.length) {
      return `The most likely main file(s) are: ${entryPoints.join(', ')}.`;
    }
    return `I could not identify a clear main file. Top-level files include: ${files.slice(0, 20).join(', ')}.`;
  }

  if (lower.includes('how do i run this project')) {
    if (packageManagers.includes('npm')) {
      return `This looks like a Node project. Try checking package.json scripts, and usually run it with npm start or npm run <script>. Likely entry points: ${entryPoints.join(', ') || 'none detected'}.`;
    }
    if (packageManagers.includes('pip') || languages.includes('python')) {
      return `This looks like a Python project. Try running a likely entry file such as ${entryPoints.join(', ') || 'main.py/app.py if present'}, or inspect requirements.txt first.`;
    }
    return `I could not determine a standard run command. Languages detected: ${languages.join(', ') || 'none'}. Entry points: ${entryPoints.join(', ') || 'none'}.`;
  }

  return [
    `Workspace: ${result.workspace || result.root || 'unknown'}`,
    `Top-level items: ${files.length}`,
    `Languages: ${languages.join(', ') || 'none detected'}`,
    `Package managers: ${packageManagers.join(', ') || 'none detected'}`,
    `Likely entry points: ${entryPoints.join(', ') || 'none detected'}`,
    files.length ? `Files: ${files.slice(0, 25).join(', ')}` : ''
  ].filter(Boolean).join('\n');
}

function formatToolResult(toolName, result, prompt = '') {
  if (toolName === 'shell_exec') {
    return formatShellResult(result);
  }

  if (!result || result.ok === false) {
    return `Sorry — ${result?.error || 'the tool failed.'}`;
  }

  if (toolName === 'fs_list') {
    if (!result.items?.length) {
      return `The directory ${result.path} is empty.`;
    }

    const lines = result.items.map(item => {
      if (item.type === 'dir') {
        return `- [dir] ${item.name}`;
      }
      return `- [file] ${item.name} (${item.size ?? 0} bytes)`;
    });

    return `Files in ${result.path}:\n${lines.join('\n')}`;
  }

  if (toolName === 'fs_read') {
    return `Contents of ${result.path}:\n\n${result.content}`;
  }

  if (toolName === 'fs_write') {
    return `Wrote file successfully: ${result.path}`;
  }

  if (toolName === 'fs_append') {
    return `Appended successfully to: ${result.path}`;
  }

  if (toolName === 'fs_patch') {
    return `Patched file successfully: ${result.path}`;
  }

  if (toolName === 'fs_mkdir') {
    return result.created
      ? `Created directory: ${result.path}`
      : `Directory already exists: ${result.path}`;
  }

  if (toolName === 'fs_delete') {
    return `Deleted ${result.deletedType}: ${result.path}`;
  }

  if (toolName === 'workspace_summary') {
    return summarizeWorkspace(result, prompt);
  }

  return JSON.stringify(result);
}

async function handleSaveFromHistory(history, requestedPath, chatId) {
  let cached = sessionState.getLastGeneratedCode(chatId);
  let code = cached?.code || '';

  if (!code) {
    code = getLastAssistantCode(history);
  }

  if (!code) {
    return {
      ok: false,
      error: 'I could not find a recent code snippet in our conversation to save.'
    };
  }

  let finalPath = String(requestedPath || '').trim();

  if (!finalPath) {
    finalPath = cached?.suggestedPath || 'generated_code.txt';
  }

  const fsWrite = require('../tools/fs_write');
  const result = await fsWrite({
    path: finalPath,
    content: code,
    overwrite: true,
    chatId
  });

  if (result.ok) {
    sessionState.setLastGeneratedCode(chatId, {
      code,
      suggestedPath: finalPath,
      savedAt: Date.now()
    });
  }

  return result;
}

async function analyzeFile(pathValue, content, prompt) {
  const systemPrompt = storage.getSystemPrompt();
  const limitedContent = String(content || '').slice(0, 30000);

  const analysisPrompt = [
    `You are analysing a code file for the user.`,
    `File path: ${pathValue}`,
    `User request: ${prompt}`,
    '',
    'Explain clearly what this file does, its main responsibilities, important functions, and anything suspicious or broken you notice.',
    'Be specific to the actual file contents below.',
    '',
    limitedContent
  ].join('\n');

  let analysis = await promptModel(systemPrompt, analysisPrompt);

  if (!analysis) {
    const lines = limitedContent.split('\n').length;
    analysis = `I read ${pathValue}. It has about ${lines} lines. It appears to be a ${path.extname(pathValue) || 'plain text'} file. I could not generate a richer analysis, but I do have the file content loaded for follow-up actions.`;
  }

  return analysis;
}

async function rewriteFileWithInstruction(filePath, originalContent, instruction) {
  const systemPrompt = [
    storage.getSystemPrompt(),
    '',
    'Long term memory about the user:',
    readPermanentMemory() || '(none)',
    '',
    'Rules:',
    '- Only reference information that appears in memory or chat history.',
    '- If the user asks about past topics and none exist, say you do not remember.',
    '- Never invent past conversations.'
  ].join('\n');

  const promptText = [
    `Rewrite the file at: ${filePath}`,
    '',
    'User instruction:',
    instruction,
    '',
    'Current file contents:',
    originalContent
  ].join('\n');

  let rewritten = await promptModel(systemPrompt, promptText);
  if (!rewritten) {
    return {
      ok: false,
      error: 'The model returned an empty edit result.'
    };
  }

  const blocks = extractCodeBlocks(rewritten);
  const finalContent = (blocks[0] || rewritten).trim();

  if (!finalContent) {
    return {
      ok: false,
      error: 'The model did not return valid updated file content.'
    };
  }

  const fsWrite = require('../tools/fs_write');
  return await fsWrite({
    path: filePath,
    content: finalContent,
    overwrite: true
  });
}

async function handleEditIntent(editIntent, history, chatId) {
  if (!editIntent) {
    return {
      ok: false,
      error: 'No edit intent found.'
    };
  }

  if (editIntent.type === 'overwrite_with_cached') {
    const cached = sessionState.getLastGeneratedCode(chatId);
    const code = cached?.code || getLastAssistantCode(history);

    if (!code) {
      return {
        ok: false,
        error: 'No recent code snippet found to overwrite the file with.'
      };
    }

    const fsWrite = require('../tools/fs_write');
    return await fsWrite({
      path: editIntent.file,
      content: code,
      overwrite: true
    });
  }

  if (editIntent.type === 'append_literal') {
    const fsAppend = require('../tools/fs_append');
    return await fsAppend({
      path: editIntent.file,
      content: `${editIntent.content}\n`
    });
  }

  if (editIntent.type === 'exact_replace') {
    const fsPatch = require('../tools/fs_patch');
    return await fsPatch({
      path: editIntent.file,
      mode: 'replace',
      find: editIntent.find,
      replace: editIntent.replace
    });
  }

  if (editIntent.type === 'rewrite_with_model') {
    const fsRead = require('../tools/fs_read');
    const readResult = await fsRead({ path: editIntent.file });

    if (!readResult.ok) {
      return readResult;
    }

    return await rewriteFileWithInstruction(
      readResult.path,
      readResult.content,
      editIntent.instruction
    );
  }

  return {
    ok: false,
    error: 'Unknown edit intent type.'
  };
}

async function handleExistsIntent(existsIntent) {
  const fsList = require('../tools/fs_list');
  const result = await fsList({ path: existsIntent.path || '' });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error
    };
  }

  const target = existsIntent.file.toLowerCase();
  const found = result.items.some(item => item.name.toLowerCase() === target);

  return {
    ok: true,
    found,
    target: existsIntent.file,
    path: result.path
  };
}

async function handleWorkspaceNavigation(navIntent, chatId) {
  if (navIntent.type === 'where') {
    const currentWorkspace = workspaceManager.getWorkspace();
    const currentFile = sessionState.getCurrentFile(chatId);

    return {
      ok: true,
      reply: currentFile
        ? `Current workspace: ${currentWorkspace}\nCurrent file context: ${currentFile.path}`
        : `Current workspace: ${currentWorkspace}`
    };
  }

  if (navIntent.type === 'up') {
    let nextPath = workspaceManager.getWorkspace();

    for (let i = 0; i < navIntent.levels; i++) {
      nextPath = path.dirname(nextPath);
    }

    const updated = workspaceManager.setWorkspace(nextPath);
    sessionState.setLastWorkspace(chatId, updated);

    const fsList = require('../tools/fs_list');
    const listing = await fsList({ path: '' });

    if (listing.ok) {
      sessionState.setLastListing(chatId, {
        path: listing.path,
        items: listing.items
      });

      const preview = listing.items.slice(0, 15).map(item => item.name).join(', ');
      return {
        ok: true,
        reply: `Workspace moved to ${updated}\nContents: ${preview || '(empty)'}`
      };
    }

    return {
      ok: true,
      reply: `Workspace moved to ${updated}`
    };
  }

  return {
    ok: false,
    error: 'Unsupported workspace navigation intent.'
  };
}

async function handleFileReadAnalyzeIntent(intent, prompt, chatId) {
  const fsRead = require('../tools/fs_read');
  const readResult = await fsRead({ path: intent.path });

  if (!readResult.ok) {
    return {
      ok: false,
      error: readResult.error
    };
  }

  sessionState.setCurrentFile(chatId, {
    path: readResult.path,
    name: path.basename(readResult.path),
    content: readResult.content,
    modified: readResult.modified,
    size: readResult.size
  });

  sessionState.setLastToolResult(chatId, {
    tool: 'fs_read',
    result: readResult
  });

  if (intent.type === 'read' || intent.type === 'read_current') {
    return {
      ok: true,
      reply: `Contents of ${readResult.path}:\n\n${readResult.content}`
    };
  }

  const analysis = await analyzeFile(readResult.path, readResult.content, prompt);
  return {
    ok: true,
    reply: analysis
  };
}



function isMemoryRecallQuestion(prompt) {
  const lower = String(prompt || '').trim().toLowerCase();
  return /^(can you remember|do you remember|what do you remember|what else do you remember|have we talked about|did we talk about|do you remember talking about|remember anything about|what is in memory\.txt|show memory|show memories|read memory|what's in memory\.txt|whats in memory\.txt|what car do i own)/i.test(lower);
}

function isMemoryContentsQuestion(prompt) {
  const lower = String(prompt || '').trim().toLowerCase();
  return /^(what is in memory\.txt|what's in memory\.txt|whats in memory\.txt|show memory|show memories|read memory)$/i.test(lower);
}

function cleanMemoryLines(memory) {
  return String(memory || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^[-*]\s*/, ''));
}

async function answerMemoryRecallDeterministically(chatId, prompt) {
  const lower = String(prompt || '').trim().toLowerCase();
  const fileLines = cleanMemoryLines(readPermanentMemory());
  let semantic = [];

  try {
    if (memoryStore && typeof memoryStore.searchMemory === 'function') {
      semantic = await memoryStore.searchMemory(chatId, prompt);
      if (!Array.isArray(semantic)) semantic = [];
    }
  } catch (_) {}

  const semanticLines = semantic
    .map(item => item?.content || item?.text || '')
    .filter(Boolean);

  const lines = [...new Set([...fileLines, ...semanticLines])];

  if (!lines.length) {
    return 'I don’t have anything saved in memory yet.';
  }

  if (isMemoryContentsQuestion(prompt)) {
    return `Here’s what I currently have saved:\n- ${lines.join('\n- ')}`;
  }

  let topic = '';
  const topicPatterns = [
    /medical issues? (?:i(?:'| )?ve|i have)? talked about\??$/i,
    /remember talking about (.+)$/i,
    /have we talked about (.+)$/i,
    /did we talk about (.+)$/i,
    /do you remember (?:anything )?about (.+)$/i,
    /what do you remember about (.+)$/i,
    /what car do i own/i
  ];

  for (const re of topicPatterns) {
    const m = String(prompt || '').match(re);
    if (m) {
      topic = m[1] ? m[1].trim().replace(/[?.!]+$/, '') : 'car';
      break;
    }
  }

  if (/medical issues?/i.test(lower)) topic = 'medical';
  if (/what car do i own/i.test(lower)) topic = 'car';

  let filtered = lines;
  if (topic) {
    const topicLower = topic.toLowerCase();
    const words = topicLower.split(/\s+/).filter(Boolean);
    filtered = lines.filter(line => {
      const hay = line.toLowerCase();
      if (topicLower === 'medical') return /(medical|stomach|belly|pain|toilet|sick|ill|ibs|doctor|health)/i.test(line);
      if (topicLower === 'car') return /(bmw|car|e46|vehicle)/i.test(line);
      return words.some(w => w.length > 2 && hay.includes(w));
    });
  }

  if (!filtered.length) {
    return topic ? `I don’t have anything saved about ${topic}.` : 'I don’t have anything relevant saved for that.';
  }

  if (filtered.length === 1) {
    return `Yeah — I remember ${filtered[0]}`;
  }

  return `Yeah — here’s what I remember:\n- ${filtered.join('\n- ')}`;
}

function setActiveTopic(chatId, type, subject, extra = {}) {
  const session = sessionState.getSession(chatId);
  session.activeTopic = {
    type,
    subject,
    updatedAt: Date.now(),
    ...extra
  };
}

function getActiveTopic(chatId) {
  const session = sessionState.getSession(chatId);
  return session.activeTopic || null;
}

function resolvePromptWithActiveTopic(chatId, history, prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (!/\b(this|that|it|they|them)\b/.test(lower)) return prompt;

  const activeTopic = getActiveTopic(chatId);
  if (activeTopic && activeTopic.subject) {
    return `${prompt}\n\nCurrent conversation topic: ${activeTopic.subject}`;
  }

  return resolveContextualPrompt(history, prompt);
}

function maybeUpdateTopicFromTurn(chatId, prompt, replyText) {
  const combined = `${String(prompt || '')}\n${String(replyText || '')}`.toLowerCase();

  if (/(stomach|belly|toilet|sick|ibs|medical|doctor|pain)/i.test(combined)) {
    setActiveTopic(chatId, 'medical', 'your stomach issue / possible cause');
    return;
  }

  if (/\b(bmw|e46)\b/i.test(combined)) {
    setActiveTopic(chatId, 'general', 'your BMW E46');
    return;
  }

  if (/(file|workspace|script|code|folder|txt|js|py)/i.test(combined) && sessionState.getCurrentFile(chatId)) {
    const currentFile = sessionState.getCurrentFile(chatId);
    setActiveTopic(chatId, 'file', currentFile.path || currentFile.name || 'current file');
  }
}

function detectMemorySaveIntent(prompt) {
  const raw = String(prompt || '').trim();
  const match = raw.match(
    /^(?:remember(?:\s+that)?|note(?:\s+that)?|save\s+to\s+memory|add\s+to\s+memory|memory:)[:\s]+(.+)$/i
  );
  if (match) return { content: match[1].trim() };
  return null;
}

function detectHabitIntent(prompt) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase();

  // Log a habit
  let match = raw.match(/^(?:logged?|did|tracked?|completed?|finished?)\s+(?:my\s+)?(.+)$/i);
  if (match) {
    const habit = match[1].trim();
    // Avoid triggering on task completions (those are caught by task intent first)
    if (!/(task|todo|list)/.test(habit)) return { action: 'log', habit };
  }

  // Habit stats
  if (/(habit\s+streak|my\s+streaks?|habit\s+stats|how\s+(?:many\s+days|long\s+have\s+i))/i.test(lower)) {
    return { action: 'stats' };
  }

  // Mood logging
  match = raw.match(/^(?:feeling|mood:?|i(?:'m| am)\s+feeling)\s+(.+)$/i);
  if (match) return { action: 'mood', value: match[1].trim() };

  return null;
}

// Compress old messages into a rolling summary to preserve long-term context
async function maybeSummariseHistory(chatId, db) {
  try {
    const count = await db.getMessageCount(chatId);
    if (count < 45) return; // Only compress when there's enough history

    const oldest = await db.getOldestMessages(chatId, 30);
    if (oldest.length < 10) return;

    const transcript = oldest
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const summaryPrompt = [
      'Summarise the following conversation excerpt into a compact paragraph (max 5 sentences).',
      'Capture: key topics discussed, decisions made, facts mentioned, and any ongoing context.',
      'Be specific and factual. Do not invent anything.',
      '',
      transcript
    ].join('\n');

    const ollama = require('ollama').default;
    const res = await ollama.generate({
      model: config.DEFAULT_MODEL,
      prompt: summaryPrompt
    });

    const summary = res?.response?.trim();
    if (!summary) return;

    // Prepend existing summary if there is one
    const existingSummary = await db.getSummary(chatId);
    const finalSummary = existingSummary
      ? `${existingSummary}\n\nLater: ${summary}`
      : summary;

    // Save and prune the compressed messages
    const rowIds = oldest.map(m => m.rowid).filter(Boolean);
    await db.saveSummary(chatId, finalSummary, count);
    await db.deleteMessagesByRowIds(rowIds);

    logger.line('SYS', 'History summarised', `compressed ${oldest.length} messages`);
  } catch (err) {
    logger.line('WARN', 'maybeSummariseHistory failed', err.message || String(err));
  }
}

async function processOllama(chat, chatId, prompt, db, senderName = 'Unknown User') {
  const historyBefore = await db.getHistory(chatId, 100);

  await db.addMessage(chatId, 'user', prompt);
  sessionState.setLastWorkspace(chatId, workspaceManager.getWorkspace());

  let replyText = '';

  const history = await db.getHistory(chatId, 100);
  logger.line('DEBUG', 'history length', String(history.length));

  // Fetch conversation summary for context injection
  const conversationSummary = await db.getSummary(chatId).catch(() => null);

  // Migrate legacy memory.txt on first use
  if (memoryStore && typeof memoryStore.migrateFromLegacy === 'function') {
    try { memoryStore.migrateFromLegacy(chatId); } catch (_) {}
  }

  const resolvedPrompt = resolvePromptWithActiveTopic(chatId, history, prompt);

  const memorySaveIntent = detectMemorySaveIntent(resolvedPrompt);
  const memoryRecall = isMemoryRecallQuestion(resolvedPrompt);
  const navIntent = detectWorkspaceNavIntent(resolvedPrompt);
  const casualChat = detectCasualChatIntent(resolvedPrompt);
  const saveIntent = detectSaveIntent(resolvedPrompt);
  const editIntent = detectEditIntent(resolvedPrompt, chatId);
  const existsIntent = detectFsExistsIntent(resolvedPrompt);
  const fileIntent = (memoryRecall || memorySaveIntent) ? null : detectFileReadAnalyzeIntent(resolvedPrompt, chatId);
  const shellIntent = detectShellIntent(resolvedPrompt);
  const fsIntent = detectFsIntent(resolvedPrompt);
  const wantsWorkspaceSummary = detectWorkspaceSummaryIntent(resolvedPrompt);
  const searchIntent = detectSearchIntent(resolvedPrompt);
  const taskIntent = detectTaskIntent(resolvedPrompt);
  const habitIntent = detectHabitIntent(resolvedPrompt);

  if (memorySaveIntent) {
    if (memoryStore && typeof memoryStore.addMemory === 'function') {
      try {
        const result = await memoryStore.addMemory(chatId, memorySaveIntent.content);
        replyText = result.duplicate
          ? `Already have that saved.`
          : `Got it — saved to memory [${result.category}]: "${result.content}"`;
      } catch (err) {
        replyText = `Sorry — couldn't save that to memory: ${err.message}`;
      }
    } else {
      // Fallback: append to memory.txt
      const MEMORY_FILE = path.join(process.cwd(), 'memory.txt');
      const line = `\n- ${memorySaveIntent.content}`;
      fs.appendFileSync(MEMORY_FILE, line, 'utf8');
      replyText = `Got it — saved to memory: "${memorySaveIntent.content}"`;
    }
  } else if (memoryRecall) {
    replyText = await answerMemoryRecallDeterministically(chatId, resolvedPrompt);
  } else if (navIntent) {
    const navResult = await handleWorkspaceNavigation(navIntent, chatId);
    replyText = navResult.ok ? navResult.reply : `Sorry — ${navResult.error}`;
  } else if (wantsWorkspaceSummary) {
    logger.line('TOOL', 'workspace_summary', '{}');

    let result;
    try {
      result = await runTool('workspace_summary', {});
      sessionState.setLastWorkspaceSummary(chatId, result);
      sessionState.setLastToolResult(chatId, {
        tool: 'workspace_summary',
        result
      });
    } catch (error) {
      result = {
        ok: false,
        error: error.message || String(error)
      };
    }

    replyText = formatToolResult('workspace_summary', result, prompt);
  } else if (existsIntent) {
    logger.line('TOOL', 'fs_exists_check', JSON.stringify(existsIntent));

    let result;
    try {
      result = await handleExistsIntent(existsIntent);
      sessionState.setLastToolResult(chatId, {
        tool: 'fs_exists_check',
        result
      });
    } catch (error) {
      result = {
        ok: false,
        error: error.message || String(error)
      };
    }

    if (result.ok) {
      replyText = result.found
        ? `Yes — ${result.target} exists in ${result.path}.`
        : `No — ${result.target} was not found in ${result.path}.`;
    } else {
      replyText = `Sorry — ${result.error || 'I could not check that file.'}`;
    }
  } else if (saveIntent) {
    logger.line('TOOL', 'fs_write_from_history', JSON.stringify(saveIntent));

    let result;
    try {
      result = await handleSaveFromHistory(history, saveIntent.path, chatId);
      sessionState.setLastToolResult(chatId, {
        tool: 'fs_write_from_history',
        result
      });
    } catch (error) {
      result = {
        ok: false,
        error: error.message || String(error)
      };
    }

    if (result.ok) {
      replyText = `Saved the latest code snippet to ${result.path}`;
    } else {
      replyText = `Sorry — ${result.error || 'I could not save the file.'}`;
    }
  } else if (editIntent) {
    logger.line('TOOL', 'edit_intent', JSON.stringify(editIntent));

    let result;
    try {
      result = await handleEditIntent(editIntent, history, chatId);
      sessionState.setLastToolResult(chatId, {
        tool: 'edit_intent',
        result
      });

      if (result.ok && editIntent.file) {
        const fsRead = require('../tools/fs_read');
        const refresh = await fsRead({ path: editIntent.file });
        if (refresh.ok) {
          sessionState.setCurrentFile(chatId, {
            path: refresh.path,
            name: path.basename(refresh.path),
            content: refresh.content,
            modified: refresh.modified,
            size: refresh.size
          });
        }
      }
    } catch (error) {
      result = {
        ok: false,
        error: error.message || String(error)
      };
    }

    if (result.ok) {
      replyText = result.message || `Updated file successfully: ${result.path}`;
    } else {
      replyText = `Sorry — ${result.error || 'I could not update the file.'}`;
    }
  } else if (fileIntent) {
    logger.line('TOOL', 'file_context', JSON.stringify(fileIntent));

    let result;
    try {
      result = await handleFileReadAnalyzeIntent(fileIntent, prompt, chatId);
    } catch (error) {
      result = {
        ok: false,
        error: error.message || String(error)
      };
    }

    replyText = result.ok ? result.reply : `Sorry — ${result.error}`;
  } else {
    const toolIntent = shellIntent || fsIntent;

    if (toolIntent) {
      const toolArgs = {
        ...toolIntent.args,
        chatId
      };

      logger.line('TOOL', toolIntent.tool, JSON.stringify(toolArgs));

      let result;
      try {
        result = await runTool(toolIntent.tool, toolArgs);
        sessionState.setLastToolResult(chatId, {
          tool: toolIntent.tool,
          result
        });

        if (toolIntent.tool === 'fs_list' && result.ok) {
          sessionState.setLastListing(chatId, {
            path: result.path,
            items: result.items
          });
        }

        if (toolIntent.tool === 'fs_read' && result.ok) {
          sessionState.setCurrentFile(chatId, {
            path: result.path,
            name: path.basename(result.path),
            content: result.content,
            modified: result.modified,
            size: result.size
          });
        }
      } catch (error) {
        result = {
          ok: false,
          error: error.message || String(error)
        };
      }

      replyText = formatToolResult(toolIntent.tool, result, prompt);
    } else if (taskIntent) {
      logger.line('TOOL', 'task_intent', JSON.stringify(taskIntent));
      replyText = handleTaskIntent(taskIntent) || 'Could not handle that task action.';
    } else if (searchIntent) {
      logger.line('TOOL', 'web_search', searchIntent.query);
      try {
        const results = await braveSearch(searchIntent.query);
        replyText = formatSearchResults(searchIntent.query, results);
      } catch (err) {
        replyText = `Search failed: ${err.message || 'unknown error'}`;
      }
    } else if (habitIntent) {
      logger.line('TOOL', 'habit_intent', JSON.stringify(habitIntent));
      if (habitIntent.action === 'log') {
        const logged = storage.logHabit(chatId, habitIntent.habit);
        const streak = storage.getHabitStreak(chatId, habitIntent.habit);
        replyText = streak > 1
          ? `Logged "${habitIntent.habit}" — ${streak} day streak 🔥`
          : `Logged "${habitIntent.habit}" ✅`;
      } else if (habitIntent.action === 'stats') {
        const stats = storage.getHabitStats(chatId);
        const lines = Object.entries(stats).map(([h, s]) =>
          `• ${h}: ${s.streak} day streak${s.loggedToday ? ' ✅' : ' (not yet today)'}`
        );
        replyText = lines.length
          ? `Your habit streaks:\n${lines.join('\n')}`
          : 'No habits tracked yet. Say "logged workout" to start.';
      } else if (habitIntent.action === 'mood') {
        storage.logMood(chatId, habitIntent.value);
        replyText = `Mood logged: "${habitIntent.value}"`;
      }
    } else {
      // Load structured memories for context injection
      let structuredMemories = [];
      if (memoryStore && typeof memoryStore.listMemories === 'function') {
        try { structuredMemories = await memoryStore.listMemories(chatId); } catch (_) {}
      }

      const systemPrompt = storage.getSystemPrompt(structuredMemories);
      const augmented = buildAugmentedSystemPrompt(systemPrompt, structuredMemories, chatId);

      replyText = await chatHistoryWithFallback(augmented, history, resolvedPrompt, conversationSummary);

      if (!replyText) {
        const currentFile = sessionState.getCurrentFile(chatId);
        if (
          currentFile &&
          /do you remember opening|do you remember reading/i.test(prompt)
        ) {
          replyText = `Yes — the current file context is ${currentFile.path}.`;
        }
      }

      maybeCacheGeneratedCode(chatId, prompt, replyText);
    }
  }

  if (!replyText || !String(replyText).trim()) {
    replyText = casualChat
      ? `I’m here, Phillip. What are you in the mood for talking about?`
      : 'Sorry — I generated an empty response.';
  }

  maybeUpdateTopicFromTurn(chatId, resolvedPrompt, replyText);

  await db.addMessage(chatId, 'assistant', replyText);

  // Async summarisation — runs after reply is sent, doesn't block the user
  maybeSummariseHistory(chatId, db).catch(() => {});

  const historyAfter = await db.getHistory(chatId, 100);

  return {
    reply: replyText,
    memBefore: historyBefore.length,
    memAfter: historyAfter.length
  };
}

module.exports = { processOllama, promptModel };
