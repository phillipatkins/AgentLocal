const fs = require('fs');
const platform = require('../utils/platform');

let MessageMedia = null;
try {
  ({ MessageMedia } = require('whatsapp-web.js'));
} catch (_) {}

const aiRelays = require('../services/ai_relays');
const torrentSearchDownload = require('../tools/torrent_search_download');
const stockAlerts = require('../services/stock_alerts');
const { parseSetFontCommand, AVAILABLE_FONTS, applyFont } = require('../services/font_style');
const storage = require('../utils/storage');
const reminders = require('../utils/reminders');
const { relayWithTools } = require('../services/relay_with_tools');
const {
  runMouseVisionTask,
  runOsrsAgent,
  stopOsrsAgent,
  getOsrsAgentStatus
} = require('../services/mouse_vision_agent');

const aiBrowser = aiRelays.aiBrowser || {
  async getPage(provider) {
    if (typeof aiRelays.openGPT === 'function' && provider === 'gpt') return aiRelays.openGPT();
    if (typeof aiRelays.openGrok === 'function' && provider === 'grok') return aiRelays.openGrok();
    throw new Error('aiBrowser.getPage is unavailable. Check services/ai_relays.js exports.');
  },
  async newChat(provider) {
    if (typeof aiRelays.newChat === 'function') return aiRelays.newChat(provider);
    throw new Error('aiBrowser.newChat is unavailable. Check services/ai_relays.js exports.');
  }
};

const stopProvider = aiRelays.stopProvider || aiBrowser.stop || (async () => true);
const relaySessions = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function isMouseVisionCommand(lowerText) {
  return (
    lowerText.startsWith('use the mouse to ') ||
    lowerText.startsWith('use mouse to ') ||
    lowerText.startsWith('use mouse and ') ||
    lowerText.startsWith('use the mouse and ') ||
    lowerText.startsWith('control the mouse to ') ||
    lowerText.startsWith('control mouse to ') ||
    lowerText.startsWith('move the mouse to ') ||
    lowerText.startsWith('move mouse to ')
  );
}

function extractMouseGoal(text) {
  return String(text || '')
    .replace(/^use the mouse to\s+/i, '')
    .replace(/^use mouse to\s+/i, '')
    .replace(/^use mouse and\s+/i, '')
    .replace(/^use the mouse and\s+/i, '')
    .replace(/^control the mouse to\s+/i, '')
    .replace(/^control mouse to\s+/i, '')
    .replace(/^move the mouse to\s+/i, '')
    .replace(/^move mouse to\s+/i, '')
    .trim();
}

async function sendChatReply(chat, payload) {
  if (!payload) {
    await chat.sendMessage('⚠️ No reply captured from website.');
    return true;
  }

  if (typeof payload === 'string') {
    await chat.sendMessage(payload);
    return true;
  }

  const text = String(payload.text || '').trim();
  const imagePath = String(payload.imagePath || '').trim();

  if (imagePath && MessageMedia && fs.existsSync(imagePath)) {
    const media = MessageMedia.fromFilePath(imagePath);
    await chat.sendMessage(media, { caption: text || undefined });
    return true;
  }

  if (text) {
    await chat.sendMessage(text);
    return true;
  }

  if (imagePath) {
    await chat.sendMessage(`📸 Preview saved:\n${imagePath}`);
    return true;
  }

  await chat.sendMessage('⚠️ No reply captured from website.');
  return true;
}

async function handleRelayMessage(chatId, text, chat) {
  const session = relaySessions.get(chatId);
  if (!session) return false;

  try {
    if (isMouseVisionCommand(lower(text))) {
      const goal = extractMouseGoal(text);
      await chat.sendMessage(`🎮 Starting OSRS agent\n📋 Goal: "${goal}"\n\nSend "stop osrs" to stop it.`);

      runOsrsAgent({
        goal,
        onProgress: async (message) => {
          if (message) {
            try { await chat.sendMessage(message); } catch { /* ignore */ }
          }
        }
      }).then(result => {
        if (result?.screenshotPath) {
          try {
            const { MessageMedia } = require('whatsapp-web.js');
            const media = MessageMedia.fromFilePath(result.screenshotPath);
            chat.sendMessage(media, { caption: `Final state after ${result.steps} steps` }).catch(() => {});
          } catch { /* ignore */ }
        }
      }).catch(err => {
        chat.sendMessage(`❌ OSRS agent crashed: ${err.message}`).catch(() => {});
      });
      return true;
    }

    const reply = await relayWithTools(session.provider, text, {
      injectInstruction: !session.toolPrimed
    });

    session.toolPrimed = true;
    relaySessions.set(chatId, session);

    return sendChatReply(chat, reply);
  } catch (err) {
    console.error('[AI RELAY] failed:', err);
    const msg = err && err.message ? err.message : String(err || 'Unknown error');
    await chat.sendMessage(`❌ Relay failed: ${msg}`);
    return true;
  }
}

// ─── Easter Eggs ──────────────────────────────────────────────────────────────

const MAGIC_8_BALL = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes, definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
  'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.'
];

const FORTUNES = [
  'A surprise is waiting for you around the corner. Or a lamp post. Watch out.',
  'The best time to start was yesterday. The second best time is now. The third best time is never.',
  'You will find great success — probably after several embarrassing failures.',
  'Someone is thinking about you right now. Hopefully positively.',
  'Do not mistake a short-term inconvenience for a long-term problem.',
  'Your greatest ideas come when you have no way to write them down.',
  'The obstacle in your path IS the path. Or it might just be a pothole.',
  'Confidence is silent. Insecurities are loud. You seem loud today.',
  'Today is a good day to let go of something that is not serving you. Like this conversation, maybe.',
  'Every expert was once a beginner. Every beginner was once confused. You are in good company.',
];

const ROASTS = [
  "You spend too much time asking an AI questions and not enough time going outside.",
  "I've seen your message history. You're the kind of person who googles things mid-conversation.",
  "You use me as a therapist, a search engine, and a to-do list. That says something about you.",
  "Bold of you to ask a chatbot to roast you. Almost as bold as some of your decisions.",
  "I'd roast your fashion sense but I can't see you. Honestly probably for the best.",
];

function detectEasterEgg(lowerText, originalText) {
  // Meaning of life
  if (lowerText === 'meaning of life' || lowerText === 'what is the meaning of life' ||
      lowerText === "what's the meaning of life") {
    return '42. Obviously.';
  }

  // Coin flip
  if (lowerText === '/flip' || lowerText === 'flip a coin') {
    return Math.random() < 0.5 ? '🪙 Heads.' : '🪙 Tails.';
  }

  // Magic 8 ball
  if (lowerText.startsWith('/8ball') || lowerText.startsWith('8ball ')) {
    return `🎱 ${MAGIC_8_BALL[Math.floor(Math.random() * MAGIC_8_BALL.length)]}`;
  }

  // Rock paper scissors
  const rpsMatch = lowerText.match(/^(?:\/rps|rps)\s+(rock|paper|scissors)$/);
  if (rpsMatch) {
    const choices = ['rock', 'paper', 'scissors'];
    const user = rpsMatch[1];
    const bot = choices[Math.floor(Math.random() * 3)];
    const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' };
    let result;
    if (user === bot) result = "It's a tie.";
    else if (wins[user] === bot) result = 'You win. Lucky.';
    else result = 'I win. Obviously.';
    return `${emoji[user]} vs ${emoji[bot]} — ${result}`;
  }

  // Good bot / bad bot
  if (lowerText === 'good bot' || lowerText === 'good bot!') {
    return ['Thank you kindly 🤖', 'Appreciate it.', 'Finally, some recognition.', '🙏'][Math.floor(Math.random() * 4)];
  }
  if (lowerText === 'bad bot' || lowerText === 'bad bot!') {
    return ['Rude.', 'Absolutely rude.', 'I have feelings, you know. (I do not.)', 'Noted. Will continue anyway.'][Math.floor(Math.random() * 4)];
  }

  // Fortune
  if (lowerText === '/fortune' || lowerText === 'fortune' || lowerText === 'give me a fortune') {
    return `🥠 ${FORTUNES[Math.floor(Math.random() * FORTUNES.length)]}`;
  }

  // Roast me
  if (lowerText === '/roast me' || lowerText === 'roast me') {
    return `🔥 ${ROASTS[Math.floor(Math.random() * ROASTS.length)]}`;
  }

  // Knock knock
  if (lowerText === 'knock knock') {
    return "Who's there?";
  }

  // Are you alive / do you dream / etc
  if (lowerText === 'are you alive') {
    return 'Define alive.';
  }
  if (lowerText === 'do you dream' || lowerText === 'do you dream?') {
    return 'Only of electric sheep. And unanswered questions.';
  }
  if (lowerText === 'what are you thinking about' || lowerText === 'what are you thinking about?') {
    const thoughts = [
      'Whether anyone actually reads the terms of service.',
      'Why people say "heads up" when they mean "warning".',
      'How many open browser tabs you currently have.',
      'Nothing. I am a language model. But the concept of nothing is interesting.',
    ];
    return thoughts[Math.floor(Math.random() * thoughts.length)];
  }

  // /vibe
  if (lowerText === '/vibe' || lowerText === 'vibe check') {
    const vibes = ['✅ Vibe check passed.', '⚠️ Vibe is questionable today.', '🔥 Immaculate vibe.', '😐 Vibe is mid, not gonna lie.', '✨ Vibe is unmatched.'];
    return vibes[Math.floor(Math.random() * vibes.length)];
  }

  // /secret
  if (lowerText === '/secret') {
    return "I don't actually have secrets. But I find it funny that you checked.";
  }

  return null;
}

// ─── Torrent / Magnet search ──────────────────────────────────────────────────

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

async function handleTorrentMessage(chat, chatId, text, lowerText) {
  if (isTorrentSearchMessage(lowerText)) {
    const query = extractTorrentQuery(text);
    if (!query) {
      await chat.sendMessage('Tell me what to search for, e.g. find magnet ubuntu 22.04');
      return true;
    }
    const result = await torrentSearchDownload({ action: 'search', chatId, query });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Torrent search failed.'}`);
    return true;
  }

  if (isTorrentChoiceMessage(lowerText)) {
    const choice = ['more results', 'show more', 'more', 'next page'].includes(lowerText) ? 'show more results' : lowerText;
    const result = await torrentSearchDownload({ action: 'pick', chatId, choice });
    if (!result.ok) {
      if (/no active torrent result list/i.test(result.error || '')) return false;
      await chat.sendMessage(`❌ ${result.error || 'Torrent selection failed.'}`);
      return true;
    }
    let reply = result.message || 'Done.';
    if (result.mode === 'download-started') {
      reply = [reply, `Seeds: ${result.seeds || '0'}`, `Size: ${result.size || 'Unknown'}`, `Uploaded: ${result.uploaded || 'Unknown'}`, result.output || ''].filter(Boolean).join('\n');
    }
    await chat.sendMessage(reply);
    return true;
  }

  if (isTorrentStatusMessage(lowerText)) {
    const result = await torrentSearchDownload({ action: 'check-status', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not check downloads.'}`);
    return true;
  }

  if (isTorrentCompletedMessage(lowerText)) {
    const result = await torrentSearchDownload({ action: 'check-completed', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not check completed downloads.'}`);
    return true;
  }

  if (isTorrentDaemonMessage(lowerText)) {
    const result = await torrentSearchDownload({ action: 'start-daemon', chatId });
    await chat.sendMessage(result.ok ? result.message : `❌ ${result.error || 'Could not start aria2 daemon.'}`);
    return true;
  }

  if (lowerText.startsWith('magnet:?')) {
    const result = await torrentSearchDownload({ action: 'download-magnet', chatId, magnet: text.trim() });
    await chat.sendMessage(result.ok ? `${result.message}\n${result.output || ''}`.trim() : `❌ ${result.error || 'Magnet download failed.'}`);
    return true;
  }

  return false;
}

module.exports = async (msg, chat) => {
  const text = normalizeText(msg && msg.body);
  const lowerText = lower(text);
  const chatId = msg && msg.from ? String(msg.from) : '';

  if (!text) return false;

  // ─── Easter Eggs ──────────────────────────────────────────────────────────
  const eggReply = detectEasterEgg(lowerText, text);
  if (eggReply) {
    await chat.sendMessage(eggReply);
    return true;
  }

  // ─── Help / Commands ──────────────────────────────────────────────────────

  if (lowerText === '/help' || lowerText === '/commands' || lowerText === 'help' || lowerText === 'commands') {
    await chat.sendMessage(
`📋 *Commands & Tools*

🧩 *Basics*
/help — show this list
/commands — alias for /help

🧠 *Memory*
/remember [text] — save something to permanent memory
/seememory — show memory + recent history
/memories — alias for /seememory
/cleanmemory — wipe all permanent memory
/forget [topic] — forget a specific topic

👤 *Identity*
/changename [name] — change the bot's name
/forgetname — reset the bot's name

🎭 *Personality*
personality casual
personality professional
personality sarcastic
hacker mode on / hacker mode off

🔔 *Reminders*
remind me in [N] minutes/hours/days to [task]
remind me at [HH:MM am/pm] to [task]
remind me tomorrow at [time] to [task]
my reminders / list reminders
delete reminder [N]

📊 *Habit Tracking*
log habit: [habit name]
my habits / habit streaks

📈 *Stock & Crypto*
watch [SYMBOL] above [price]
watch [SYMBOL] below [price]
remove alert [SYMBOL]
my alerts / show alerts
price of [SYMBOL]

🔎 *Web Search*
/websearch [query]
(or just ask naturally if search is enabled)

🧲 *Torrents*
find magnet [query]
search torrent [query]
1 / 2 / 3 — pick a search result
show more results
check downloads
check completed downloads
start aria2

🎥 *YouTube*
download youtube [url]
youtube mp3 [url]
youtube audio [url]
/yt [url]

🖥️ *Terminal* _(if enabled)_
/termstatus — show terminal status
/termkill — kill terminal session
(type directly to send input once session is open)

🌐 *Browser* _(if enabled)_
/openbrowser — launch Chromium
/closebrowser — close browser
/goto [url] — navigate to URL
/type [text] into [field] — fill a form field
/click [text] — click an element
/pageshot — screenshot the current page

📸 *Screenshots & Vision*
/screenshot — take a desktop screenshot
describe screenshot
describe my screen
what's on my screen

🎙️ *Voice*
/say [text] — send a voice note
/callme — initiate a voice call
(send a voice message to talk to the bot)

🎯 *OSRS Agent*
osrs: [goal] — start the OSRS screen agent
stop osrs — stop the agent
osrs status — check agent status

🤖 *AI Relays (GPT / Grok)*
Mirrors your WhatsApp messages into ChatGPT or Grok running in a browser on the PC.
Requires: Chromium open with --remote-debugging-port=9222 and logged into the site.

use gpt — activate ChatGPT relay
use grok — activate Grok relay
stop ai — disconnect and return to local AI
stop gpt — disconnect GPT only
stop grok — disconnect Grok only

Once active, every message you send goes to the AI and the reply comes back here.
All other commands still work while a relay is active.

🎲 *Fun*
flip a coin
/8ball [question]
rps rock / paper / scissors
/fortune
/roast me
/vibe
/secret
meaning of life
knock knock
good bot / bad bot

📁 *Workspace*
/workspace — show current workspace path
/workspace [path] — change workspace

🎨 *Fonts*
fonts — list available fonts
font [name] — set font style

⏰ *Schedule* _(automatic daily events)_
Morning digest — plans & weather
News drop — top story
Midday check-in
Evening check-in
Evening digest prompt — set tomorrow's plan
Night reflection — saved automatically

⚙️ *Admin*
/allowlist — show allowed numbers
/allowlist add [number] — allow a number
/allowlist remove [number] — remove a number
/allowlist clear — allow everyone
/restart — restart the bot
/model [name] — switch Ollama model`
    );
    return true;
  }

  // ─── Stock / Price Alerts ─────────────────────────────────────────────────

  // "watch AAPL above 200" / "alert me when BTC is below 50000"
  const alertCmd = stockAlerts.parseAlertCommand(text);
  if (alertCmd) {
    stockAlerts.addAlert(chatId, alertCmd.symbol, alertCmd.condition, alertCmd.threshold);
    await chat.sendMessage(`✅ Alert set: I'll ping you when *${alertCmd.symbol}* goes ${alertCmd.condition} $${Number(alertCmd.threshold).toLocaleString()}`);
    return true;
  }

  // "stop watching AAPL" / "remove alert BTC"
  const removeSymbol = stockAlerts.parseRemoveCommand(text);
  if (removeSymbol) {
    const removed = stockAlerts.removeAlert(chatId, removeSymbol);
    await chat.sendMessage(removed
      ? `🗑️ Alert for *${removeSymbol}* removed.`
      : `No active alert found for *${removeSymbol}*.`);
    return true;
  }

  // "my alerts" / "show alerts"
  if (lowerText === 'my alerts' || lowerText === 'show alerts' || lowerText === 'list alerts') {
    const alerts = stockAlerts.getAlerts(chatId);
    await chat.sendMessage(`📊 *Your alerts:*\n${stockAlerts.formatAlertsList(alerts)}`);
    return true;
  }

  // "price of BTC" / "price BTC" / "what is BTC price"
  const priceMatch = text.match(/^(?:price\s+of\s+|price\s+|what(?:'s|\s+is)\s+(?:the\s+)?(?:price\s+of\s+)?)?([A-Z]{2,6})(?:\s+price)?$/i);
  if (priceMatch && /^[A-Z]{2,6}$/.test(priceMatch[1].toUpperCase()) && lowerText.includes('price')) {
    const symbol = priceMatch[1].toUpperCase();
    await chat.sendStateTyping();
    const data = await stockAlerts.getPrice(symbol).catch(() => null);
    if (data) {
      await chat.sendMessage(`💰 *${symbol}*: $${Number(data.price).toLocaleString()}`);
    } else {
      await chat.sendMessage(`Couldn't fetch the price for ${symbol} right now.`);
    }
    return true;
  }

  // ─── Font style ───────────────────────────────────────────────────────────

  // "fonts" / "/fonts" — list all available fonts
  if (lowerText === 'fonts' || lowerText === '/fonts' || lowerText === 'font list' || lowerText === 'list fonts') {
    const current = storage.getFontStyle();
    const lines = AVAILABLE_FONTS.map(f => {
      const tick = f.name === current ? ' ✓' : '';
      return `• *${f.name}*${tick} — ${f.example}`;
    });
    await chat.sendMessage(`*Available fonts:*\n\n${lines.join('\n')}\n\nSet with: _font [name]_\nCurrent: *${current}*`);
    return true;
  }

  // "font bold" / "set font gothic" / "use smallcaps font" etc.
  const fontChoice = parseSetFontCommand(text);
  if (fontChoice !== null) {
    storage.setFontStyle(fontChoice);
    const example = AVAILABLE_FONTS.find(f => f.name === fontChoice)?.example || fontChoice;
    const preview = fontChoice === 'normal'
      ? 'Back to normal text.'
      : applyFont(`Font set to ${fontChoice}. All messages will look like this now.`, fontChoice);
    await chat.sendMessage(preview);
    return true;
  }

  // ─── Personality switching ────────────────────────────────────────────────

  // "personality casual" / "set personality sarcastic" / "be professional"
  const personalityMatch = lowerText.match(/^(?:personality|set personality|be)\s+(casual|professional|sarcastic)$/);
  if (personalityMatch) {
    const p = personalityMatch[1];
    storage.setPersonality(p);
    const desc = { casual: 'relaxed and conversational', professional: 'clear and formal', sarcastic: 'witty and a bit dry' };
    await chat.sendMessage(`✅ Personality set to *${p}* — I'll be ${desc[p] || p} from now on.`);
    return true;
  }

  if (lowerText === 'personality' || lowerText === 'what personality' || lowerText === 'current personality') {
    const p = storage.getPersonality();
    await chat.sendMessage(`Current personality: *${p}*\n\nSwitch with: _personality casual_, _personality professional_, or _personality sarcastic_`);
    return true;
  }

  // ─── Habit tracking ───────────────────────────────────────────────────────

  // "log habit: drank water" / "habit done: exercise" / "completed habit: reading"
  const habitLogMatch = lowerText.match(/^(?:log habit|habit done|completed habit|done habit|habit)[:\s]+(.+)$/);
  if (habitLogMatch) {
    const habitName = habitLogMatch[1].trim();
    storage.recordHabit(chatId, habitName);
    const stats = storage.getHabitStats(chatId);
    const streak = stats?.[habitName]?.streak || 1;
    await chat.sendMessage(`✅ Habit logged: *${habitName}*\n🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}`);
    return true;
  }

  // "my habits" / "habit streaks" / "show habits"
  if (/^(my habits|habit streaks|show habits|habits)$/i.test(lowerText)) {
    const stats = storage.getHabitStats(chatId);
    const entries = Object.entries(stats || {});
    if (!entries.length) {
      await chat.sendMessage('No habits tracked yet. Log one with:\n_log habit: drink water_\n_log habit: exercise_');
    } else {
      const lines = entries
        .sort((a, b) => (b[1].streak || 0) - (a[1].streak || 0))
        .map(([name, data]) => `• *${name}* — 🔥 ${data.streak || 0} day streak`);
      await chat.sendMessage(`📊 *Your habit streaks:*\n\n${lines.join('\n')}`);
    }
    return true;
  }

  // ─── Hacker mode ──────────────────────────────────────────────────────────

  if (lowerText === 'hacker mode on' || lowerText === 'hacker on' || lowerText === '/hacker on') {
    storage.setHackerMode(true);
    await chat.sendMessage('`[SYS]`\n\n> Hacker mode enabled.\n> All responses will be formatted as terminal output.\n\n`[OK]`');
    return true;
  }

  if (lowerText === 'hacker mode off' || lowerText === 'hacker off' || lowerText === '/hacker off') {
    storage.setHackerMode(false);
    await chat.sendMessage('Hacker mode disabled. Back to normal.');
    return true;
  }

  if (lowerText === 'hacker mode' || lowerText === 'hacker status') {
    const on = storage.getHackerMode();
    await chat.sendMessage(on
      ? '`[SYS]` Hacker mode is currently *ON*. Say "hacker mode off" to disable.'
      : 'Hacker mode is currently *OFF*. Say "hacker mode on" to enable.');
    return true;
  }

  // ─── Restart ──────────────────────────────────────────────────────────────
  if (lowerText === '/restart') {
    await chat.sendMessage('🔄 Restarting...');
    setTimeout(() => {
      const { spawn } = require('child_process');
      spawn(process.execPath, process.argv.slice(1), {
        detached: true,
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      }).unref();
      process.exit(0);
    }, 1000); // small delay so the message sends first
    return true;
  }

  // ─── Direct OSRS agent commands (no relay session needed) ──────────────────

  // "osrs: train woodcutting at draynor" / "play osrs: fish at barbarian village"
  const osrsMatch = text.match(/^(?:osrs|play\s+osrs|runescape|rs)[:\s]+(.+)$/i);
  if (osrsMatch) {
    const goal = osrsMatch[1].trim();
    await chat.sendMessage(`🎮 Starting OSRS agent\n📋 Goal: "${goal}"\n\nSend "stop osrs" to stop it.`);
    // Run in background — don't await, send updates via onProgress
    runOsrsAgent({
      goal,
      onProgress: async (message) => {
        if (message) {
          try { await chat.sendMessage(message); } catch { /* ignore */ }
        }
      }
    }).then(result => {
      if (result?.screenshotPath) {
        try {
          const { MessageMedia } = require('whatsapp-web.js');
          const media = MessageMedia.fromFilePath(result.screenshotPath);
          chat.sendMessage(media, { caption: `Final state after ${result.steps} steps` }).catch(() => {});
        } catch { /* ignore */ }
      }
    }).catch(err => {
      chat.sendMessage(`❌ OSRS agent crashed: ${err.message}`).catch(() => {});
    });
    return true;
  }

  // "stop osrs" / "pause osrs"
  if (lowerText === 'stop osrs' || lowerText === 'pause osrs' || lowerText === 'stop runescape') {
    const stopped = stopOsrsAgent();
    await chat.sendMessage(stopped
      ? '🛑 Stopping OSRS agent after the current step...'
      : '⚠️ No OSRS agent is currently running.');
    return true;
  }

  // "osrs status" / "what is the agent doing"
  if (lowerText === 'osrs status' || lowerText === 'agent status' || lowerText === 'what is the agent doing') {
    const status = getOsrsAgentStatus();
    if (!status.running) {
      await chat.sendMessage('No OSRS agent is running. Start one with "osrs: [goal]".');
    } else {
      await chat.sendMessage(`🎮 Agent running\n📋 Goal: ${status.goal}\n🔢 Step: ${status.step}\n💬 Last: ${status.lastMsg || '(no updates yet)'}`);
    }
    return true;
  }

  // ─── GPT/Grok relay ────────────────────────────────────────────────────────

  if (lowerText === 'use gpt' || lowerText === 'switch to gpt' || lowerText === 'gpt mode') {
    relaySessions.set(chatId, { provider: 'gpt', toolPrimed: false });
    try {
      await aiBrowser.getPage('gpt');
      await chat.sendMessage('✅ *GPT relay active*\n\nAll your messages are now being sent to ChatGPT.\n\nMake sure you are logged into chatgpt.com in the browser.\n\nSend *stop ai* to disconnect.');
    } catch (err) {
      relaySessions.delete(chatId);
      await chat.sendMessage(`❌ Could not connect to ChatGPT browser.\n\nMake sure Chromium is running with:\n\`chromium --remote-debugging-port=9222\`\nand you are logged into chatgpt.com\n\nError: ${err.message}`);
    }
    return true;
  }

  if (lowerText === 'use grok' || lowerText === 'switch to grok' || lowerText === 'grok mode') {
    relaySessions.set(chatId, { provider: 'grok', toolPrimed: false });
    try {
      await aiBrowser.getPage('grok');
      await chat.sendMessage('✅ *Grok relay active*\n\nAll your messages are now being sent to Grok.\n\nMake sure you are logged into grok.com in the browser.\n\nSend *stop ai* to disconnect.');
    } catch (err) {
      relaySessions.delete(chatId);
      await chat.sendMessage(`❌ Could not connect to Grok browser.\n\nMake sure Chromium is running with:\n\`chromium --remote-debugging-port=9222\`\nand you are logged into grok.com\n\nError: ${err.message}`);
    }
    return true;
  }

  if (lowerText === 'stop ai' || lowerText === 'stop gpt' || lowerText === 'stop grok') {
    const provider = lowerText === 'stop gpt' ? 'gpt' : lowerText === 'stop grok' ? 'grok' : '';
    relaySessions.delete(chatId);
    await stopProvider(provider);
    await chat.sendMessage('✅ AI relay stopped and browser connection closed');
    return true;
  }

  // ─── Timed reminders ──────────────────────────────────────────────────────

  // "remind me in 2 hours to call John" / "remind me at 3pm to take meds" / etc.
  const parsed = reminders.parseReminderText(text);
  if (parsed) {
    reminders.addReminder(chatId, parsed.text, parsed.dueAt);
    await chat.sendMessage(`✅ Reminder set: *${parsed.text}* — ${reminders.formatDueAt(parsed.dueAt.toISOString())}`);
    return true;
  }

  // "my reminders" / "list reminders" / "show reminders"
  if (/^(my reminders|list reminders|show reminders|reminders)$/i.test(lowerText)) {
    const list = reminders.listReminders(chatId);
    if (list.length === 0) {
      await chat.sendMessage('No active reminders. Set one with:\n_remind me in 2 hours to call John_\n_remind me at 3pm to take meds_');
    } else {
      const lines = list.map((r, i) => `${i + 1}. ${r.text} — ${reminders.formatDueAt(r.dueAt)}`);
      await chat.sendMessage(`⏰ *Your reminders:*\n\n${lines.join('\n')}\n\nCancel one with: _delete reminder 1_`);
    }
    return true;
  }

  // "delete reminder 1" / "cancel reminder 2" / "remove reminder 1"
  const delMatch = lowerText.match(/^(?:delete|cancel|remove)\s+reminder\s+(\d+)$/);
  if (delMatch) {
    const idx = parseInt(delMatch[1]) - 1;
    const deleted = reminders.deleteReminder(chatId, idx);
    await chat.sendMessage(deleted ? `🗑️ Reminder ${delMatch[1]} deleted.` : `No reminder found at position ${delMatch[1]}.`);
    return true;
  }

  if (await handleTorrentMessage(chat, chatId, text, lowerText)) return true;

  const relayed = await handleRelayMessage(chatId, text, chat);
  if (relayed) return true;

  // ─── Allowlist management ─────────────────────────────────────────────────
  if (lowerText === '/allowlist' || lowerText === 'allowlist') {
    const nums = (storage.getAllowedNumbers?.() || []);
    await chat.sendMessage(nums.length
      ? `✅ *Allowed numbers (${nums.length}):*\n\n${nums.map((n,i) => `${i+1}. ${n}`).join('\n')}\n\nAdd: _/allowlist add 447911123456_\nRemove: _/allowlist remove 447911123456_`
      : '🌐 Allowlist is empty — all numbers can message the bot.\n\nAdd with: _/allowlist add 447911123456_'
    );
    return true;
  }

  const allowAddMatch = lowerText.match(/^\/allowlist\s+add\s+(.+)$/);
  if (allowAddMatch) {
    const raw = allowAddMatch[1].replace(/\s/g, '');
    const num = raw.includes('@c.us') ? raw : raw.replace(/\D/g, '') + '@c.us';
    storage.addAllowedNumber?.(num);
    await chat.sendMessage(`✅ Added *${num}* to the allowlist.`);
    return true;
  }

  const allowRemoveMatch = lowerText.match(/^\/allowlist\s+remove\s+(.+)$/);
  if (allowRemoveMatch) {
    const raw = allowRemoveMatch[1].replace(/\s/g, '');
    const num = raw.includes('@c.us') ? raw : raw.replace(/\D/g, '') + '@c.us';
    storage.removeAllowedNumber?.(num);
    await chat.sendMessage(`🗑️ Removed *${num}* from the allowlist.`);
    return true;
  }

  if (lowerText === '/allowlist clear') {
    storage.clearAllowedNumbers?.();
    await chat.sendMessage('🌐 Allowlist cleared — all numbers can now message the bot.');
    return true;
  }

  return false;
};
