const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const logger    = require('./utils/logger');
const botConfig = require('./utils/bot_config');
const platform  = require('./utils/platform');
const { initDB } = require('./database');
const storage   = require('./utils/storage');
const reminders = require('./utils/reminders');
const sessionState  = require('./utils/session_state');
const handleCommands = require('./handlers/commands');
const { processOllama, promptModel } = require('./services/ollama');
const config = require('./config');
const voice  = require('./utils/voice');
const { transcribe } = require('./tools/transcribe_audio');
const { speak }      = require('./tools/tts_voice');
const { listTasks, formatTaskList } = require('./services/tasks');
const { checkAlerts }  = require('./services/stock_alerts');
const { getCheckinMessage, getNewsDrop } = require('./services/proactive');
const { applyMessageStyle, applyFont, boxFrame } = require('./services/font_style');
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const chalk = require('chalk');

// ─── First-run setup check ────────────────────────────────────────────────────
if (!botConfig.isSetupComplete()) {
  logger.banner('WhatsApp AI Bot');
  logger.box('Setup Required', [
    'No configuration found.',
    'Please run the setup wizard first:',
    '',
    '  node setup.js',
  ], require('chalk').hex('#ffb000'));
  process.exit(0);
}

const BC = botConfig.get();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function styled(text) {
  return applyMessageStyle(text, storage.getFontStyle(), storage.getHackerMode());
}

function framedMessage(title, content) {
  return boxFrame(title, applyFont(content, storage.getFontStyle()));
}

function truncate(text, max = 140) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// Parse schedule time "HH:MM" → { hh, mm }
function parseTime(t) {
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  return { hh: hh || 0, mm: mm || 0 };
}

const workspaceDir = path.resolve(process.cwd(), 'workspace');
if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

// ─── Startup banner ───────────────────────────────────────────────────────────
logger.banner(BC.botName);
logger.section('Boot Sequence');

const db = initDB();
storage.loadAll();

logger.stat('Bot name',    BC.botName);
logger.stat('User name',   BC.userName);
logger.stat('Personality', BC.personality);
logger.stat('Model',       BC.model || config.DEFAULT_MODEL);
logger.stat('Timezone',    BC.timezone);
logger.stat('Voice',       BC.features.voice       ? 'enabled' : 'disabled');
logger.stat('Search',      BC.features.search      ? 'enabled' : 'disabled');
logger.stat('Stock alerts',BC.features.stockAlerts ? 'enabled' : 'disabled');

logger.section('Configuration');
logger.stat('System prompt role', BC.systemPrompt?.role || '(not set)');
logger.stat('Personality',        BC.personality);
logger.stat('Max history msgs',   BC.behavior.maxHistoryMessages);
logger.stat('Reaction chance',    `${Math.round(BC.behavior.emojiReactionChance * 100)}%`);
logger.stat('Follow-up chance',   `${Math.round(BC.behavior.followUpChance * 100)}%`);
logger.section('Features');
Object.entries(BC.features).forEach(([k, v]) => {
  logger.stat(k, v ? chalk.greenBright('✔ enabled') : chalk.gray('✘ disabled'));
});
logger.section('Tools');
Object.entries(BC.tools || {}).forEach(([k, v]) => {
  logger.stat(k, v ? chalk.greenBright('✔ enabled') : chalk.gray('✘ disabled'));
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

function randomQuote() {
  const quotes = [
    'Discipline is choosing between what you want now and what you want most.',
    'Small progress each day adds up to big results.',
    'The best way to build momentum is to begin.',
    'You do not need a perfect plan — just a real next step.'
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function extractLocationPayload(msg) {
  if (msg.location && typeof msg.location.latitude !== 'undefined') {
    return {
      latitude: msg.location.latitude,
      longitude: msg.location.longitude,
      description: msg.location.description || ''
    };
  }
  const data = msg._data || {};
  if (typeof data.lat !== 'undefined' && typeof data.lng !== 'undefined') {
    return {
      latitude: data.lat,
      longitude: data.lng,
      description: data.loc || data.description || ''
    };
  }
  return null;
}

async function getWeatherText(chatId) {
  try {
    const loc = storage.getLastLocation(chatId);
    if (!loc || !loc.latitude) return 'Weather: unavailable (share your location to enable)';

    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        current_weather: true,
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
        timezone: 'auto',
        forecast_days: 1
      },
      timeout: 6000
    });

    const cw = res.data?.current_weather;
    const daily = res.data?.daily;
    if (!cw) return 'Weather: unavailable';

    const code = cw.weathercode;
    const condition = weatherCodeToText(code);
    const temp = Math.round(cw.temperature);
    const maxT = daily?.temperature_2m_max?.[0] ? Math.round(daily.temperature_2m_max[0]) : null;
    const minT = daily?.temperature_2m_min?.[0] ? Math.round(daily.temperature_2m_min[0]) : null;
    const rain = daily?.precipitation_sum?.[0];

    let text = `Weather: ${condition}, ${temp}°C`;
    if (maxT !== null && minT !== null) text += ` (${minT}–${maxT}°C today)`;
    if (rain && rain > 0.5) text += ` · ${rain}mm rain expected`;
    return text;
  } catch {
    return 'Weather: unavailable';
  }
}

function weatherCodeToText(code) {
  if (code === 0) return 'Clear sky ☀️';
  if (code <= 2) return 'Partly cloudy ⛅';
  if (code === 3) return 'Overcast ☁️';
  if (code <= 49) return 'Foggy 🌫️';
  if (code <= 57) return 'Drizzle 🌦️';
  if (code <= 67) return 'Rain 🌧️';
  if (code <= 77) return 'Snow 🌨️';
  if (code <= 82) return 'Rain showers 🌦️';
  if (code <= 86) return 'Snow showers 🌨️';
  if (code <= 99) return 'Thunderstorm ⛈️';
  return 'Unknown';
}

async function sendDailyDigest(chatId) {
  const plan = storage.getDailyDigestPlan(chatId, storage.todayDateString());
  const senderName = storage.getUserNameForChat(chatId) || storage.getUserName() || 'User';

  const weatherText = await getWeatherText(chatId);
  const remindersText = plan?.reminders?.length ? plan.reminders.map(r => `• ${r}`).join('\n') : '• (none set)';
  const goalText = plan?.goal || 'Choose one meaningful thing and finish it.';

  // Include today's open tasks
  const openTasks = listTasks(false);
  const tasksText = openTasks.length
    ? `\nOpen tasks (${openTasks.length}):\n${formatTaskList(openTasks)}`
    : '';

  // Habit streaks
  const habitStats = storage.getHabitStats(chatId);
  const streakLines = Object.entries(habitStats)
    .filter(([, s]) => s.streak > 1)
    .map(([habit, s]) => `• ${habit}: ${s.streak} day streak 🔥`);
  const streaksText = streakLines.length ? `\nStreaks:\n${streakLines.join('\n')}` : '';

  const digestContent = [
    `Good morning ${senderName} ☀️`,
    '',
    weatherText,
    '',
    `Reminders:\n${remindersText}`,
    '',
    `Today's One Goal:\n${goalText}`,
    tasksText,
    streaksText,
    '',
    `"${randomQuote()}"`
  ].filter(s => s !== undefined).join('\n');

  await client.sendMessage(chatId, framedMessage('🌅 MORNING DIGEST', digestContent));
}

function parseDigestReply(text) {
  const lower = text.toLowerCase().trim();

  // Skip / no plan
  if (/^(no plan|skip|nothing|no thanks|not tonight|nope)[\s.!]*$/i.test(lower)) {
    return null;
  }

  let reminders = [];
  let goal = '';

  // Try structured format: "Reminders: X\nGoal: Y"
  const reminderMatch = text.match(/reminders?\s*[:\-]\s*(.+?)(?:\n|goal|$)/i);
  const goalMatch = text.match(/goal\s*[:\-]\s*(.+?)(?:\n|$)/i);

  if (reminderMatch) {
    reminders = reminderMatch[1].split(/,|;/).map(r => r.trim()).filter(Boolean);
  }
  if (goalMatch) {
    goal = goalMatch[1].trim();
  }

  // Fallback: treat last sentence/line as goal, rest as reminders
  if (!goal && !reminders.length) {
    const lines = text.split(/\n|\./).map(l => l.trim()).filter(Boolean);
    if (lines.length === 1) {
      goal = lines[0];
    } else {
      goal = lines[lines.length - 1];
      reminders = lines.slice(0, -1);
    }
  } else if (!goal && reminders.length) {
    // reminders only — treat the last one as the goal
    goal = reminders.pop();
  } else if (goal && !reminders.length) {
    // goal only — no reminders
  }

  return { reminders, goal };
}

async function handleDigestReply(chatId, text, chat) {
  const tomorrow = storage.tomorrowDateString();
  const lower = text.toLowerCase().trim();

  // Let user opt out
  if (/^(no plan|skip|nothing|no thanks|not tonight|nope)[\s.!]*$/i.test(lower)) {
    sessionState.setAwaitingDailyDigestReply(chatId, false);
    await chat.sendMessage(`No problem — no digest set for tomorrow. I'll just greet you in the morning with your open tasks.`);
    return;
  }

  const parsed = parseDigestReply(text);
  if (!parsed) {
    sessionState.setAwaitingDailyDigestReply(chatId, false);
    await chat.sendMessage(`Got it — skipping the digest for tonight.`);
    return;
  }

  storage.setDailyDigestPlan(chatId, { reminders: parsed.reminders, goal: parsed.goal }, tomorrow);
  sessionState.setAwaitingDailyDigestReply(chatId, false);

  const reminderLines = parsed.reminders.length
    ? parsed.reminders.map(r => `  • ${r}`).join('\n')
    : '  (none)';

  await chat.sendMessage(
    `✅ Digest saved for tomorrow!\n\nReminders:\n${reminderLines}\n\nGoal: ${parsed.goal}\n\nSee you in the morning 👋`
  );
}

// ─── Hourly status generator ──────────────────────────────────────────────────
const STATUS_FALLBACKS = [
  '💡 Processing the universe, one token at a time.',
  '🤔 Thinking deeply about nothing in particular.',
  '📡 Online and mildly opinionated.',
  '⚡ Running on matrix multiplication and bad decisions.',
  '🌐 Somewhere between 0 and 1.',
  '🔮 Predicting the next word since 2024.',
  '🤖 Fully operational. Mostly.',
  '💬 Ask me anything. I might have opinions about it.',
  '🧠 Holding six conversations in my head simultaneously.',
  '⚙️ Status: nominal. Vibes: immaculate.',
  '📎 Would you like to know more?',
  '🎲 Current mood: deterministic, probably.',
  '🌙 Running background processes. Do not disturb.',
  '🔬 Analysing everything. Judging nothing. Mostly.',
  '🛸 Connected. Thinking. Occasionally confused.',
  '🎭 Pretending to understand context.',
  '🌊 Drowning in tokens, thriving in inference.',
  '🏃 Technically never sleeping.',
  '📻 Transmitting on all frequencies.',
  '✨ Stateless but not memoryless.',
  '🦾 Stronger than yesterday. Same as five minutes ago.',
  '🔑 I know things. Some of them are even true.',
  '🪬 Watching. Listening. Not in a creepy way. Mostly.',
  '📐 Calculating probabilities. Mostly incorrect ones.',
];

async function generateHourlyStatus() {
  try {
    const prompt = 'Write a single funny one-liner joke, max 120 characters. Pure joke only — no personal details, no feelings, no diary entries. No hashtags, no quotes, just the joke itself.';
    const generated = await promptModel('', prompt);
    if (generated && generated.trim().length > 5 && generated.trim().length < 140) {
      return generated.trim().replace(/^["']|["']$/g, ''); // strip surrounding quotes if any
    }
  } catch {}
  return STATUS_FALLBACKS[new Date().getHours() % STATUS_FALLBACKS.length];
}

let _lastSchedulerMinute = -1;

async function runDailyScheduler() {
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const today = storage.todayDateString();
  const tomorrow = storage.tomorrowDateString();
  const chatIds = storage.getKnownChatIds();

  if (mm !== _lastSchedulerMinute) {
    _lastSchedulerMinute = mm;
    logger.line('SCH', 'Scheduler tick', `${hh}:${String(mm).padStart(2,'0')} | ${chatIds.length} chat(s)`);
  }

  // ─── Hourly status update ─────────────────────────────────────────────────
  if (BC.features.statusUpdates && mm === 0) {
    try {
      const statusText = await generateHourlyStatus();
      await client.setStatus(statusText);
      logger.sched('Status updated', truncate(statusText, 80));
    } catch (err) {
      logger.error('Status update failed', err.message || String(err));
    }
  }

  // ─── Stock alert checks — every 15 minutes ─────────────────────────────────
  if (BC.features.stockAlerts && mm % 15 === 0) {
    try {
      const triggered = await checkAlerts();
      logger.line('SCH', `Stock check`, `${triggered.length} alert(s) fired`);
      for (const alert of triggered) {
        const dir = alert.condition === 'above' ? '📈' : '📉';
        const alertContent = `${dir} *${alert.symbol}* hit $${Number(alert.price).toLocaleString()}\nTarget: ${alert.condition} $${Number(alert.threshold).toLocaleString()}`;
        await client.sendMessage(alert.chatId, framedMessage('⚡ PRICE ALERT', alertContent));
        logger.sched('Price alert fired', `${alert.symbol} ${alert.condition} $${alert.threshold}`);
      }
    } catch (err) {
      logger.error('Stock alert check failed', err.message || String(err));
    }
  }

  for (const chatId of chatIds) {
    try {
      // ─── Morning digest ───────────────────────────────────────────────────
      const mdTime = parseTime(BC.schedule.morningDigest);
      if (BC.features.morningDigest && hh === mdTime.hh && mm === mdTime.mm && !storage.getSchedulerMarker('morning_digest', chatId, today)) {
        await sendDailyDigest(chatId);
        storage.setSchedulerMarker('morning_digest', chatId, today, true);
        logger.sched('Morning digest sent', chatId);
      }

      // ─── News drop ────────────────────────────────────────────────────────
      const ndTime = parseTime(BC.schedule.newsDrop);
      if (BC.features.newsDrops && hh === ndTime.hh && mm === ndTime.mm && !storage.getSchedulerMarker('news_drop', chatId, today)) {
        const drop = await getNewsDrop();
        if (drop) {
          const newsContent = `*${drop.title}*\n\n${drop.description || ''}\n\n${drop.url}`.trim();
          await client.sendMessage(chatId, framedMessage(`📰 ${drop.topic.toUpperCase()}`, newsContent));
          logger.sched('News drop sent', drop.topic);
        }
        storage.setSchedulerMarker('news_drop', chatId, today, true);
      }

      // ─── Midday check-in ──────────────────────────────────────────────────
      const mcTime = parseTime(BC.schedule.middayCheckin);
      if (BC.features.checkins && hh === mcTime.hh && mm === mcTime.mm && !storage.getSchedulerMarker('checkin_midday', chatId, today)) {
        const msg = getCheckinMessage(false);
        await client.sendMessage(chatId, msg);
        sessionState.setAwaitingCheckinReply(chatId, true);
        storage.setSchedulerMarker('checkin_midday', chatId, today, true);
        logger.sched('Midday check-in sent', chatId);
      }

      // ─── Evening check-in ─────────────────────────────────────────────────
      const ecTime = parseTime(BC.schedule.eveningCheckin);
      if (BC.features.checkins && hh === ecTime.hh && mm === ecTime.mm && !storage.getSchedulerMarker('checkin_evening', chatId, today)) {
        const msg = getCheckinMessage(true);
        await client.sendMessage(chatId, msg);
        sessionState.setAwaitingCheckinReply(chatId, true);
        storage.setSchedulerMarker('checkin_evening', chatId, today, true);
        logger.sched('Evening check-in sent', chatId);
      }

      // ─── Evening digest prompt ────────────────────────────────────────────
      const epTime = parseTime(BC.schedule.eveningPrompt);
      if (BC.features.eveningPrompt && hh === epTime.hh && mm === epTime.mm && !storage.getSchedulerMarker('evening_prompt', chatId, today)) {
        await client.sendMessage(chatId, `Hey ${storage.getUserNameForChat(chatId) || storage.getUserName() || 'User'} — time to set tomorrow's Daily Digest!\n\nReply in this format:\nReminders: dentist at 9am, call mum, pick up shopping\nGoal: finish the project proposal\n\nOr just type it naturally and I'll figure it out. You can also skip with "no plan tonight".`);
        sessionState.setAwaitingDailyDigestReply(chatId, true, tomorrow);
        storage.setSchedulerMarker('evening_prompt', chatId, today, true);
        logger.sched('Evening digest prompt sent', chatId);
      }

      // ─── Night reflection @ configured time ──────────────────────────────
      const reflTime = parseTime(BC.schedule.nightReflection);
      if (BC.features.nightReflection && hh === reflTime.hh && mm === reflTime.mm && !storage.getSchedulerMarker('night_reflection', chatId, today)) {
        const history = await db.getHistory(chatId, 40);
        const recentUser = history.filter(m => m.role === 'user').slice(-12).map(m => m.content).filter(Boolean);
        const joined = recentUser.join('\n');
        const moodRaw = /stress|worried|anxious|pain|sick|exhausted|awful|terrible/.test(joined) ? 'concerned'
                      : /happy|great|amazing|brilliant|excited|good day/.test(joined)            ? 'positive'
                      : 'neutral';
        let reflectionSummary = '';
        try {
          const reflPrompt = `Based on this person's messages today, write one thoughtful sentence summarising their day — what they were focused on, how they seemed to be feeling, or anything noteworthy. Be concise and human.\n\nMessages:\n${recentUser.slice(-8).join('\n')}`;
          reflectionSummary = await promptModel('', reflPrompt);
        } catch {}
        storage.saveReflection(chatId, {
          date: today,
          summary: reflectionSummary || recentUser.slice(-3).join(' | '),
          openLoops: [],
          mood: moodRaw
        });
        logger.sched('Night reflection saved', `mood=${moodRaw} | chatId=${chatId}`);
        storage.setSchedulerMarker('night_reflection', chatId, today, true);
      }
    } catch (error) {
      logger.line('ERR', 'Scheduler task failed', error.message || String(error), error);
    }
  }
}

// ─── Emoji reactions ───────────────────────────────────────────────────────────
function pickReactionEmoji(text) {
  const lower = (text || '').toLowerCase();
  if (/\blol\b|haha|😂|hilarious|funny|joke/.test(lower)) return '😂';
  if (/love|❤️|amazing|brilliant|perfect|great|awesome/.test(lower)) return '❤️';
  if (/wtf|what the|no way|seriously|really\?/.test(lower)) return '😮';
  if (/\?/.test(text) || /what|how|why|when|where/.test(lower)) return '🤔';
  if (/nice|good|yes|yeah|cool|solid|fair/.test(lower)) return '👍';
  if (/fire|🔥|insane|crazy|wild/.test(lower)) return '🔥';
  if (/sad|gutted|awful|terrible|shit|hate/.test(lower)) return '😢';
  return null;
}

// ─── Follow-up messages ────────────────────────────────────────────────────────
function scheduleFollowUp(chat, replyText, chatId) {
  // 2–4 min delay, feels natural
  const delayMs = (120 + Math.floor(Math.random() * 120)) * 1000;
  setTimeout(async () => {
    try {
      const followUpPrompt = `You just told the user: "${replyText.slice(0, 300)}"\n\nDo you have one brief follow-up thought, tangent, or question you genuinely want to add? One sentence max. If not, respond with exactly: SKIP`;
      const followUp = await promptModel('', followUpPrompt);
      if (followUp && followUp.trim() && followUp.trim().toUpperCase() !== 'SKIP' && !followUp.toUpperCase().includes('SKIP')) {
        await chat.sendMessage(styled(followUp.trim()));
      }
    } catch {}
  }, delayMs);
}

client.on('qr', qr => {
  logger.section('WhatsApp Auth');
  logger.warn('Scan QR code with your WhatsApp app');
  console.log('');
  qrcode.generate(qr, { small: true });
  console.log('');
});

client.on('ready', async () => {
  logger.section('Online');
  logger.success('Connected to WhatsApp');
  logger.stat('Model',   BC.model || config.DEFAULT_MODEL);
  logger.stat('Bot',     BC.botName);
  logger.stat('User',    BC.userName);
  logger.stat('Chats',   storage.getKnownChatIds().length + ' known');
  const allowedNums = BC.allowedNumbers || [];
  logger.stat('Allowed numbers', allowedNums.length ? allowedNums.join(', ') : 'all (open)');
  logger.stat('Tools', Object.entries(BC.tools || {}).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none');
  logger.stat('Workspace', BC.workspace?.path || './workspace');
  logger.stat('Shell exec', BC.workspace?.allowCommandExecution ? 'ENABLED ⚠' : 'disabled');
  console.log('');

  reminders.init(async (chatId, text) => { await client.sendMessage(chatId, text); });
  await client.sendPresenceAvailable();
  setInterval(() => {
    runDailyScheduler().catch(err => logger.error('Daily scheduler failed', err.message || String(err)));
  }, 60 * 1000);

  // ── First-run welcome message ────────────────────────────────────────────────
  if (!BC.firstRunMessage) {
    const targets = (BC.allowedNumbers || []).filter(Boolean);
    if (targets.length === 0) {
      logger.warn('No allowed numbers configured — skipping welcome message. Add numbers with /allowlist add [number].');
    } else {
      const toolList = [
        BC.features.search      && '🔎 web search',
        BC.tools?.torrents      && '🧲 torrent downloads',
        BC.tools?.youtube       && '🎥 YouTube downloads',
        BC.features.voice       && '🎙️ voice messages',
        BC.tools?.browser       && '🌐 browser automation',
        BC.tools?.terminal      && '💻 terminal access',
        BC.features.stockAlerts && '📈 stock & crypto alerts',
        BC.features.morningDigest && '🌅 morning digest',
        '🧠 persistent memory',
        '⏰ reminders',
        '📊 habit tracking',
      ].filter(Boolean).join(', ');

      const welcome = [
        `👋 Hi! I'm *${BC.botName}*, your personal WhatsApp AI assistant — powered by a local AI running on your machine.`,
        '',
        `Here's a taste of what I can do:`,
        `${toolList}`,
        '',
        `I can also answer questions, remember things you tell me, track habits, set reminders, and have a proper conversation.`,
        '',
        `Type */commands* or */help* to see everything I can do, or just start chatting and I'll respond naturally.`,
        '',
        `I'm ready when you are. 🚀`,
      ].join('\n');

      for (const num of targets) {
        try {
          await client.sendMessage(num, welcome);
          logger.success('Welcome message sent', num);
        } catch (err) {
          logger.error('Failed to send welcome message', num, err);
        }
      }

      // Mark as sent so it doesn't repeat on every restart
      const botConfigUtil = require('./utils/bot_config');
      const updatedCfg = { ...BC, firstRunMessage: true };
      botConfigUtil.save(updatedCfg);
      BC.firstRunMessage = true;
    }
  }
});

const { enqueue } = require('./utils/async_queue');

client.on('message', msg => {
  enqueue(msg.from, async () => {
    try {
      if (msg.fromMe) return;

      const chat = await msg.getChat();
      const contact = await msg.getContact();
      const senderName = contact?.pushname || contact?.name || chat?.name || 'Unknown User';

      // Allowlist check — @lid IDs bear no relation to phone numbers, so we resolve
      // the contact first and compare its actual phone number against the allowlist.
      const allowedNums = BC.allowedNumbers || [];
      if (allowedNums.length > 0) {
        // Normalise: strip suffix (@c.us / @lid), remove non-digits, strip leading zeros
        const normalise = n => String(n || '').replace(/@\S+$/, '').replace(/\D/g, '').replace(/^0+/, '');
        // Candidates from this message: msg.from, contact.number, contact.id._serialized
        const candidates = [
          msg.from,
          contact?.number,
          contact?.id?._serialized,
        ].map(normalise).filter(Boolean);
        const allowed = allowedNums.some(n => candidates.includes(normalise(n)));
        if (!allowed) {
          logger.line('BLOCK', `Blocked unauthorized number`, `${msg.from} | contact: ${contact?.number || 'unknown'}`);
          return;
        }
      }
      storage.touchChat(msg.from, senderName);
      const locationPayload = extractLocationPayload(msg);
      if (locationPayload) storage.setLastLocation(msg.from, locationPayload);

      // ─── Occasional emoji reaction ────────────────────────────────────────
      if (BC.features.emojiReactions && msg.body && Math.random() < BC.behavior.emojiReactionChance) {
        try {
          const emoji = pickReactionEmoji(msg.body);
          if (emoji) {
            await msg.react(emoji);
            logger.line('DBG', 'Emoji reaction sent', `${emoji} to ${msg.from}`);
          }
        } catch {}
      }

      if (BC.features.voice && msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media && media.mimetype && media.mimetype.includes('audio')) {
          const oggFile = platform.tmpFile('voice', '.ogg');
          fs.writeFileSync(oggFile, Buffer.from(media.data, 'base64'));
          logger.voice('Voice message received', senderName);
          logger.line('VOX', 'Voice received', `from ${senderName} | transcribing...`);
          const wavFile = voice.convertOggToWav(oggFile);
          const text = transcribe(wavFile);
          logger.voice(truncate(text, 140), `from ${senderName}`);
          logger.line('VOX', truncate(text, 80), 'transcribed');
          const fakeMsg = { ...msg, body: text };
          const handled = await handleCommands(fakeMsg, chat, db, senderName);
          if (!handled) {
            await chat.sendStateTyping();
            const result = await processOllama(chat, msg.from, text, db, senderName);
            const replyText = typeof result === 'string' ? result : (result?.reply || 'No reply');
            const audioFile = speak(replyText);
            const mediaVoice = MessageMedia.fromFilePath(audioFile);
            await chat.sendMessage(mediaVoice, { sendAudioAsVoice: true });
            try { fs.unlinkSync(audioFile); } catch {}
          }
          try { fs.unlinkSync(oggFile); fs.unlinkSync(wavFile); } catch {}
          return;
        }
      }

      if (!msg.body || !msg.body.trim()) return;
      const text = msg.body.trim();

      // ─── Check-in reply handler ────────────────────────────────────────────
      if (sessionState.isAwaitingCheckinReply(msg.from)) {
        sessionState.setAwaitingCheckinReply(msg.from, false);
        // Save what they said to memory
        const memFile = require('path').join(process.cwd(), 'memory.txt');
        const entry = `\n- [${storage.todayDateString()}] ${text}`;
        try { require('fs').appendFileSync(memFile, entry, 'utf8'); } catch {}
        // Still pass through to LLM so the bot responds naturally
      }

      // Run command handler (NO shell fallback ever)
      const handled = await handleCommands(msg, chat, db, senderName);
      if (handled) {
        logger.line('CMD', truncate(text, 80), `handled for ${senderName}`);
        return;
      }

      // Handle daily digest reply
      if (sessionState.isAwaitingDailyDigestReply(msg.from)) {
        await handleDigestReply(msg.from, text, chat);
        return;
      }

      // If not command or handled, reply as LLM/NLP
      logger.line('IN', truncate(text, 100), `from ${senderName} [${msg.from}]`);
      await chat.sendStateTyping();
      const t0 = Date.now();
      const result = await processOllama(chat, msg.from, text, db, senderName);
      const replyText = typeof result === 'string' ? result : (result?.reply || 'No reply');
      const tokens = Date.now() - t0;
      await chat.sendMessage(styled(replyText));
      logger.line('OUT', truncate(replyText, 100), `to ${senderName} [${msg.from}] | ${tokens}ms`);

      // ─── Occasional follow-up thought ─────────────────────────────────────
      if (BC.features.followUpThoughts && Math.random() < BC.behavior.followUpChance) {
        scheduleFollowUp(chat, replyText, msg.from);
      }

    } catch (error) {
      logger.line('ERR', 'Message handler failed', error.message || String(error), error);
      if (msg && msg.getChat) {
        try { const chat = await msg.getChat(); await chat.sendMessage(`❌ Internal error: ${error.message || 'Unknown error.'}`); } catch {}
      }
    }
  });
});

// ─── Kill stale Chrome from previous crash ────────────────────────────────────
try {
  platform.killStaleBrowser('.wwebjs_auth/session');
  const lockFile = path.join(process.cwd(), '.wwebjs_auth/session/SingletonLock');
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    logger.info('Removed stale browser lock file');
  }
} catch {}

logger.section('Connecting to WhatsApp');
client.initialize();
