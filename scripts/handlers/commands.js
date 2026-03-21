const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const storage = require('../utils/storage');
const config = require('../config');
const { MessageMedia } = require('whatsapp-web.js');
const playwright = require('playwright');
const fetch = require('node-fetch');
const workspaceManager = require('../utils/workspace');
const terminalSessions = require('../utils/terminal_sessions');
const reminders = require('../utils/reminders');
const { speak } = require('../tools/tts_voice');
const torrentSearchDownload = require('../tools/torrent_search_download');
const youtubeDownload = require('../tools/youtube_download');
const visionDescribe = require('../tools/vision_describe');

const MEMORY_FILE = 'memory.txt';
const IDENTITY_FILE = 'identity.txt';

const confirmClean = new Map();
const pendingForget = new Map();

let browserContext = null;
let pageInstance = null;

if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, '', 'utf8');
}

function readMemoryFile() {
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, '', 'utf8');
  }
  return fs.readFileSync(MEMORY_FILE, 'utf8');
}

function writeMemoryFile(content) {
  fs.writeFileSync(MEMORY_FILE, content, 'utf8');
}

function appendMemoryLine(text) {
  const existing = readMemoryFile().trimEnd();
  const next = existing ? `${existing}\n- ${text}` : `- ${text}`;
  writeMemoryFile(next);
}

function saveIdentityFile() {
  fs.writeFileSync(
    IDENTITY_FILE,
    `User name: ${storage.getUserName()}\nBot name: ${storage.getBotName()}\n`,
    'utf8'
  );
}

function truncate(text, max = 140) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeForgetTopic(lowerText) {
  let topic = lowerText.replace(
    /forget (anything about|i ever talked about|i said|we talked about|that|about)/i,
    ''
  ).trim();

  if (!topic) {
    topic = lowerText.replace(/forget/i, '').trim();
  }

  return topic;
}

function isTorrentSearchMessage(lowerText) {
  return /^(find|search)(\s+for)?\s+magnet\b/.test(lowerText) ||
    /^(find|search)\s+torrent\b/.test(lowerText) ||
    /^magnet\s+search\b/.test(lowerText) ||
    /^torrent\s+search\b/.test(lowerText) ||
    /^download\s+.+\s+torrent$/.test(lowerText) ||
    /^download\s+.+\s+magnet$/.test(lowerText);
}

function extractTorrentQuery(text) {
  return String(text || '')
    .replace(/^(find|search)(\s+for)?\s+magnet\s+/i, '')
    .replace(/^(find|search)\s+torrent\s+/i, '')
    .replace(/^magnet\s+search\s+/i, '')
    .replace(/^torrent\s+search\s+/i, '')
    .replace(/^download\s+/i, '')
    .replace(/\s+torrent$/i, '')
    .replace(/\s+magnet$/i, '')
    .trim();
}

function isTorrentChoiceMessage(lowerText) {
  return /^(1|2|3)$/.test(lowerText) ||
    lowerText === 'show more results' ||
    lowerText === 'show more' ||
    lowerText === 'more results' ||
    lowerText === 'more' ||
    lowerText === 'next page';
}

function isTorrentStatusMessage(lowerText) {
  return lowerText === 'check downloads' ||
    lowerText === 'download status' ||
    lowerText === 'check torrent progress' ||
    lowerText === 'check download status';
}

function isTorrentCompletedMessage(lowerText) {
  return lowerText === 'check completed' ||
    lowerText === 'completed downloads' ||
    lowerText === 'check completed downloads' ||
    lowerText === 'finished downloads' ||
    lowerText === 'show completed';
}

function isTorrentDaemonMessage(lowerText) {
  return lowerText === 'start aria2' ||
    lowerText === 'start daemon' ||
    lowerText === 'start aria2 daemon';
}

function parseYouTubeRequest(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const urlMatch = raw.match(/https?:\/\/\S+/i);
  if (!urlMatch) return null;
  if (!/(youtube\.com|youtu\.be)/i.test(urlMatch[0])) return null;

  let mode = 'video';
  if (lower.includes('mp3') || lower.includes('audio')) mode = 'audio';

  if (
    lower.startsWith('/yt ') ||
    lower.startsWith('/youtube ') ||
    lower.startsWith('download youtube') ||
    lower.startsWith('youtube mp3') ||
    lower.startsWith('youtube audio') ||
    lower.startsWith('youtube video') ||
    lower.startsWith('download this youtube') ||
    lower.startsWith('grab youtube')
  ) {
    return { url: urlMatch[0], mode };
  }

  return null;
}

function isVisionRequest(lowerText) {
  return lowerText === '/describe screenshot' ||
    lowerText === 'describe screenshot' ||
    lowerText === 'describe my screen' ||
    lowerText === 'what is on my screen' ||
    lowerText === "what's on my screen" ||
    lowerText === 'look at my screen';
}

async function ensureBrowserOpen(chat) {
  if (!pageInstance) {
    await chat.sendMessage('Open browser first with /openbrowser');
    return false;
  }
  return true;
}

async function findFillTarget(page, hint) {
  const placeholder = page.getByPlaceholder(hint, { exact: false });
  if (await placeholder.count()) return placeholder.first();

  const label = page.getByLabel(hint, { exact: false });
  if (await label.count()) return label.first();

  const roleTextbox = page.getByRole('textbox', { name: hint, exact: false });
  if (await roleTextbox.count()) return roleTextbox.first();

  return null;
}

async function findClickTarget(page, target) {
  const textLocator = page.getByText(target, { exact: false });
  if (await textLocator.count()) return textLocator.first();

  const buttonLocator = page.getByRole('button', { name: target, exact: false });
  if (await buttonLocator.count()) return buttonLocator.first();

  const linkLocator = page.getByRole('link', { name: target, exact: false });
  if (await linkLocator.count()) return linkLocator.first();

  return null;
}

function formatTerminalReply(result, inputText = null) {
  if (!result || result.ok === false) {
    return `❌ ${result?.error || 'Terminal operation failed.'}`;
  }

  const output = (result.output || '').trim();
  const status = result.active
    ? 'running'
    : `exited${typeof result.exitCode === 'number' ? ` (${result.exitCode})` : ''}`;

  const lines = ['💻 *Terminal*'];

  if (inputText !== null) {
    lines.push(`stdin: ${inputText}`);
  }

  lines.push(`cwd: ${result.cwd}`);
  lines.push(`$ ${result.command}`);
  lines.push(`status: ${status}`);
  lines.push('');
  lines.push(output || '(no new output)');

  return lines.join('\n');
}

function getClientFromMessage(msg, chat) {
  return msg?.client || msg?._client || chat?.client || null;
}

function cleanupFiles(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {}
  }
}

function buildSpeechText(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/[_~]/g, ' ')
    .trim();
}

async function sendVoiceNote(chat, text) {
  const speechText = buildSpeechText(text);
  if (!speechText) {
    return { ok: false, error: 'No text provided to speak.' };
  }

  let audioPath = null;
  try {
    audioPath = speak(speechText);
    logger.line('VOICE', 'Sending voice note', truncate(speechText, 100));
    const media = MessageMedia.fromFilePath(audioPath);
    await chat.sendMessage(media, { sendAudioAsVoice: true });
    cleanupFiles(audioPath);
    return { ok: true };
  } catch (error) {
    cleanupFiles(audioPath);
    return { ok: false, error: error.message || String(error) };
  }
}

async function describeCurrentScreen(chat) {
  const filePath = path.join('/tmp', `screen-${Date.now()}.png`);
  execSync(`scrot "${filePath}"`);
  try {
    const result = await visionDescribe({ imagePath: filePath });
    return result.ok ? result.description : `❌ ${result.error}`;
  } finally {
    cleanupFiles(filePath);
  }
}

function formatReminderList(items) {
  if (!items.length) return 'No active reminders.';
  return ['⏰ Active reminders:', ...items.map(item => `${item.id}. ${item.text} — ${new Date(item.dueAt).toLocaleString()}`)].join('\n');
}

async function handleTorrentMessage(chat, senderName, chatId, text, lower) {
  if (isTorrentSearchMessage(lower)) {
    const query = extractTorrentQuery(text);
    if (!query) {
      await chat.sendMessage('Tell me what to search for, for example: find magnet ubuntu 22.04');
      return true;
    }

    const result = await torrentSearchDownload({ action: 'search', chatId, query });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Torrent search failed.'}`);
    return true;
  }

  if (isTorrentChoiceMessage(lower)) {
    const choice = ['more results', 'more', 'next page'].includes(lower) ? 'show more results' : lower;
    const result = await torrentSearchDownload({ action: 'pick', chatId, choice });

    if (!result.ok) {
      const noPending = /no active torrent result list/i.test(result.error || '');
      if (!noPending) {
        await chat.sendMessage(`❌ ${result.error || 'Torrent selection failed.'}`);
        return true;
      }
      return false;
    }

    let reply = result.message || 'Done.';
    if (result.mode === 'download-started') {
      reply = [
        reply,
        `Seeds: ${result.seeds || '0'}`,
        `Size: ${result.size || 'Unknown'}`,
        `Uploaded: ${result.uploaded || 'Unknown'}`,
        '',
        result.output || ''
      ].filter(Boolean).join('\n');
    }

    await chat.sendMessage(reply);
    return true;
  }

  if (isTorrentStatusMessage(lower)) {
    const result = await torrentSearchDownload({ action: 'check-status', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not check downloads.'}`);
    return true;
  }

  if (isTorrentCompletedMessage(lower)) {
    const result = await torrentSearchDownload({ action: 'check-completed', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not check completed downloads.'}`);
    return true;
  }

  if (isTorrentDaemonMessage(lower)) {
    const result = await torrentSearchDownload({ action: 'start-daemon', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not start aria2 daemon.'}`);
    return true;
  }

  if (lower.startsWith('magnet:?')) {
    const result = await torrentSearchDownload({ action: 'download-magnet', chatId, magnet: text.trim() });
    await chat.sendMessage(result.ok ? `${result.message}\n${result.output || ''}`.trim() : `❌ ${result.error || 'Magnet download failed.'}`);
    return true;
  }

  return false;
}

async function handleYouTubeMessage(chat, text) {
  const request = parseYouTubeRequest(text);
  if (!request) return false;

  const result = await youtubeDownload(request);
  if (!result.ok) {
    await chat.sendMessage(`❌ ${result.error}`);
    return true;
  }

  const parts = [
    `✅ YouTube ${result.mode === 'audio' ? 'audio' : 'video'} downloaded.`,
    result.path ? `File: ${result.path}` : '',
    result.output ? truncate(result.output, 900) : ''
  ].filter(Boolean);

  await chat.sendMessage(parts.join('\n'));
  return true;
}

async function handleReminderMessage(chat, chatId, text, lower) {
  if (lower === 'list reminders' || lower === '/reminders') {
    await chat.sendMessage(formatReminderList(reminders.listReminders(chatId)));
    return true;
  }

  let match = text.match(/^\/cancelreminder\s+(\d+)$/i);
  if (match) {
    const removed = reminders.removeReminder(chatId, match[1]);
    await chat.sendMessage(removed ? `✅ Removed reminder ${removed.id}.` : '❌ Reminder not found.');
    return true;
  }

  const parsed = reminders.parseReminderRequest(text);
  if (!parsed) return false;

  const reminder = reminders.addReminder({ chatId, text: parsed.text, dueAt: parsed.dueAt });
  await chat.sendMessage(`✅ Reminder set for ${new Date(reminder.dueAt).toLocaleString()}\nTask: ${reminder.text}`);
  return true;
}

module.exports = async (msg, chat, db, senderName = 'Unknown User') => {
  const text = (msg.body || '').trim();
  const lower = text.toLowerCase();
  const chatId = msg.from;

  if (!text) return false;

  if (!text.startsWith('/') && terminalSessions.hasActiveSession(chatId)) {
    const result = await terminalSessions.sendInput(chatId, text);
    await chat.sendMessage(formatTerminalReply(result, text));
    return true;
  }

  if (!text.startsWith('/')) {
    if (await handleTorrentMessage(chat, senderName, chatId, text, lower)) return true;
    if (await handleYouTubeMessage(chat, text)) return true;
    if (await handleReminderMessage(chat, chatId, text, lower)) return true;
    if (isVisionRequest(lower)) {
      await chat.sendMessage(await describeCurrentScreen(chat));
      return true;
    }
  }

  const isCommand =
    lower.startsWith('/') ||
    lower === 'yes' ||
    (lower.includes('forget') &&
      (lower.includes('about') || lower.includes('talked') || lower.includes('said') || lower.includes('anything')));

  if (!isCommand) return false;

  await chat.sendStateTyping();
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    if (lower === '/commands' || lower === '/help') {
      await chat.sendMessage(`📋 *Commands*

🧠 Memory
/remember [text]
/seememory
/memories
/cleanmemory
/forget [topic]

👤 Identity
/changename [name]
/forgetname

📁 Workspace
/workspace
/workspace [path]

💻 Terminal
/termstatus
/termkill

🎙 Voice
/say [text]
/callme

🌐 Browser
/openbrowser
/closebrowser
/goto [url]
/type [text] into [field]
/click [text]
/pageshot

🖼 Screenshots + Vision
/screenshot
/describe screenshot
or say: describe my screen

🔎 Web
/websearch [query]

🧲 Torrents
find magnet [query]
reply with 1, 2, 3, or show more results
check downloads
check completed downloads
start aria2

🎥 YouTube
download youtube [url]
youtube mp3 [url]
/yt [url]

⏰ Reminders
remind me in 20 minutes to check downloads
remind me tomorrow at 9am to call mum
/reminders
/cancelreminder [id]

⚙️ Model
/model [name]`);
      return true;
    }

    if (lower === '/describe screenshot') {
      await chat.sendMessage(await describeCurrentScreen(chat));
      return true;
    }

    if (lower.startsWith('/yt ') || lower.startsWith('/youtube ')) {
      const handled = await handleYouTubeMessage(chat, text.replace(/^\/yt\s+/i, 'download youtube ').replace(/^\/youtube\s+/i, 'download youtube '));
      if (!handled) await chat.sendMessage('❌ Use /yt <youtube url>');
      return true;
    }

    if (lower === '/reminders') {
      await chat.sendMessage(formatReminderList(reminders.listReminders(chatId)));
      return true;
    }

    if (lower.startsWith('/cancelreminder ')) {
      const removed = reminders.removeReminder(chatId, text.slice(16).trim());
      await chat.sendMessage(removed ? `✅ Removed reminder ${removed.id}.` : '❌ Reminder not found.');
      return true;
    }

    if (lower === '/workspace') {
      await chat.sendMessage(`📁 Current workspace\n\n${workspaceManager.getWorkspace()}\n\nAll relative file operations use this as the root.`);
      return true;
    }

    if (lower.startsWith('/workspace ')) {
      try {
        const updated = workspaceManager.setWorkspace(text.slice(11).trim());
        await chat.sendMessage(`✅ Workspace changed\n\nNew root:\n${updated}`);
      } catch (err) {
        await chat.sendMessage(`❌ Failed to change workspace:\n${err.message}`);
      }
      return true;
    }

    if (lower === '/termstatus') {
      const status = terminalSessions.getStatus(chatId);
      if (!status.ok) {
        await chat.sendMessage(`❌ ${status.error}`);
        return true;
      }
      const runningStatus = status.active ? 'running' : `exited${typeof status.exitCode === 'number' ? ` (${status.exitCode})` : ''}`;
      await chat.sendMessage(`💻 *Terminal status*\ncwd: ${status.cwd}\n$ ${status.command}\nstatus: ${runningStatus}\n\n${(status.bufferedOutput || '').trim() || '(no buffered output)'}`);
      return true;
    }

    if (lower === '/termkill') {
      const result = await terminalSessions.terminateSession(chatId);
      await chat.sendMessage(result.ok ? formatTerminalReply(result) : `❌ ${result.error}`);
      return true;
    }

    if (lower.startsWith('/say ')) {
      const voiceResult = await sendVoiceNote(chat, text.slice(5).trim());
      if (!voiceResult.ok) await chat.sendMessage('❌ Voice note failed. Make sure `espeak-ng` and `ffmpeg` are installed.');
      return true;
    }

    if (lower === '/callme') {
      const client = getClientFromMessage(msg, chat);
      let callLink = '';
      if (client && typeof client.createCallLink === 'function') {
        try {
          callLink = await client.createCallLink(new Date(Date.now() + 60 * 1000), 'voice');
        } catch {}
      }
      await chat.sendMessage(callLink ? `📞 WhatsApp voice call link:\n${callLink}` : '⚠️ I could not create a WhatsApp call link on this setup, but I can still send a voice note.');
      await sendVoiceNote(chat, 'Hi Phil. Tap the call link in the chat if it appeared.');
      return true;
    }

    if (lower.includes('forget') && (lower.includes('about') || lower.includes('talked') || lower.includes('said') || lower.includes('anything'))) {
      const topic = normalizeForgetTopic(lower);
      if (!topic) {
        await chat.sendMessage('Tell me what topic to forget.');
        return true;
      }
      pendingForget.set(chatId, topic);
      await chat.sendMessage(`⚠️ Forget everything about *${topic}*? Reply *YES* to confirm.`);
      return true;
    }

    if (lower === 'yes' && pendingForget.has(chatId)) {
      const topic = pendingForget.get(chatId);
      const originalLines = readMemoryFile().split('\n');
      const filteredLines = originalLines.filter(line => !line.toLowerCase().includes(topic.toLowerCase()));
      const removedCount = originalLines.length - filteredLines.length;
      writeMemoryFile(filteredLines.join('\n'));
      pendingForget.delete(chatId);
      await chat.sendMessage(`✅ Forgot "${topic}" (${removedCount} lines removed).`);
      return true;
    }

    if (lower.startsWith('/remember ')) {
      const toSave = text.slice(10).trim();
      if (!toSave) {
        await chat.sendMessage('Nothing to remember.');
        return true;
      }
      appendMemoryLine(toSave);
      await chat.sendMessage('✅ Saved to permanent memory.');
      return true;
    }

    if (lower === '/seememory' || lower === '/memories') {
      const mem = readMemoryFile().trim() || '(empty)';
      const history = await db.getHistory(chatId, 30);
      const historyText = history.length ? history.map(h => `${h.role}: ${truncate(h.content, 80)}`).join('\n') : '(empty)';
      await chat.sendMessage(`📋 *Permanent Memory*\n${mem}\n\n📜 *Chat History*\n${historyText}`);
      return true;
    }

    if (lower === '/cleanmemory') {
      if (!confirmClean.get(chatId)) {
        confirmClean.set(chatId, true);
        await chat.sendMessage('⚠️ Wipe ALL permanent memory? Reply YES');
        return true;
      }
      return false;
    }

    if (lower === 'yes' && confirmClean.get(chatId)) {
      writeMemoryFile('');
      confirmClean.delete(chatId);
      await chat.sendMessage('✅ Permanent memory wiped.');
      return true;
    }

    if (lower.startsWith('/changename ')) {
      const newName = text.slice(12).trim();
      if (!newName) {
        await chat.sendMessage('Please provide a name.');
        return true;
      }
      storage.setBotName(newName);
      saveIdentityFile();
      await chat.sendMessage(`✅ Name changed to ${storage.getBotName()}`);
      return true;
    }

    if (lower === '/forgetname') {
      storage.setBotName('Peen');
      saveIdentityFile();
      await chat.sendMessage('✅ Name reset.');
      return true;
    }

    if (lower === '/openbrowser') {
      if (browserContext) {
        await chat.sendMessage('Browser already open.');
        return true;
      }
      browserContext = await playwright.chromium.launchPersistentContext(`${process.env.HOME}/.config/google-chrome`, { headless: false });
      pageInstance = browserContext.pages()[0] || await browserContext.newPage();
      await chat.sendMessage('✅ Browser opened.');
      return true;
    }

    if (lower === '/closebrowser') {
      if (!browserContext) {
        await chat.sendMessage('No browser open.');
        return true;
      }
      await browserContext.close();
      browserContext = null;
      pageInstance = null;
      await chat.sendMessage('✅ Browser closed.');
      return true;
    }

    if (lower.startsWith('/goto ')) {
      if (!(await ensureBrowserOpen(chat))) return true;
      const rawUrl = text.slice(6).trim();
      const finalUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
      await pageInstance.goto(finalUrl, { waitUntil: 'domcontentloaded' });
      await chat.sendMessage(`✅ Navigated to ${finalUrl}`);
      return true;
    }

    if (lower.startsWith('/type ') && lower.includes(' into ')) {
      if (!(await ensureBrowserOpen(chat))) return true;
      const body = text.slice(6);
      const splitIndex = body.toLowerCase().indexOf(' into ');
      const value = body.slice(0, splitIndex).trim();
      const hint = body.slice(splitIndex + 6).trim();
      const locator = await findFillTarget(pageInstance, hint);
      if (!locator) {
        await chat.sendMessage(`Could not find a field matching "${hint}".`);
        return true;
      }
      await locator.fill(value);
      await chat.sendMessage('✅ Typed.');
      return true;
    }

    if (lower.startsWith('/click ')) {
      if (!(await ensureBrowserOpen(chat))) return true;
      const target = text.slice(7).trim();
      const locator = await findClickTarget(pageInstance, target);
      if (!locator) {
        await chat.sendMessage(`Could not find anything clickable matching "${target}".`);
        return true;
      }
      await locator.click();
      await chat.sendMessage('✅ Clicked.');
      return true;
    }

    if (lower === '/pageshot') {
      if (!(await ensureBrowserOpen(chat))) return true;
      const filePath = path.join('/tmp', `pageshot-${Date.now()}.png`);
      await pageInstance.screenshot({ path: filePath, fullPage: true });
      await msg.reply(MessageMedia.fromFilePath(filePath));
      cleanupFiles(filePath);
      return true;
    }

    if (lower === '/screenshot') {
      try {
        const filePath = path.join('/tmp', `screenshot-${Date.now()}.png`);
        execSync(`scrot "${filePath}"`);
        await chat.sendMessage(MessageMedia.fromFilePath(filePath), { caption: '📸 Screenshot' });
        cleanupFiles(filePath);
      } catch (error) {
        await chat.sendMessage('❌ Screenshot failed. Make sure `scrot` is installed.');
      }
      return true;
    }

    if (lower.startsWith('/websearch ')) {
      const query = text.slice(11).trim();
      if (!config.BRAVE_API_KEY) {
        await chat.sendMessage('Brave API key is not configured.');
        return true;
      }
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, { headers: { 'X-Subscription-Token': config.BRAVE_API_KEY } });
      if (!res.ok) {
        await chat.sendMessage(`Search failed (${res.status}).`);
        return true;
      }
      const data = await res.json();
      const reply = data.web?.results?.length
        ? `Results for "${query}":\n\n${data.web.results.slice(0, 4).map(result => `• ${result.title || 'Untitled'}\n${result.url || ''}\n${truncate(result.description || 'No description.', 140)}`).join('\n\n')}`
        : 'No results.';
      await chat.sendMessage(reply);
      return true;
    }

    if (lower.startsWith('/model ')) {
      const newModel = text.slice(7).trim();
      if (!newModel) {
        await chat.sendMessage('Please provide a model name.');
        return true;
      }
      config.DEFAULT_MODEL = newModel;
      await chat.sendMessage(`✅ Model changed to ${config.DEFAULT_MODEL}`);
      return true;
    }

    return false;
  } catch (error) {
    logger.line('ERR', 'Command handler failed', error.message || String(error));
    await chat.sendMessage(`❌ Error: ${error.message || 'Something went wrong.'}`);
    return true;
  }
};
