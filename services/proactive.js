const fs = require('fs');
const path = require('path');
const { braveSearch } = require('./web_search');

const MEMORY_FILE = path.join(process.cwd(), 'memory.txt');

const CHECKIN_MESSAGES = [
  "Hey, how's your day going?",
  "What are you up to right now?",
  "Checking in — anything interesting happening today?",
  "How's things? Anything worth saving to memory?",
  "What's been going on today?",
  "Hey — quick check-in. How you doing?",
  "Anything on your mind today?",
  "What's the vibe today?",
  "What have you been up to?",
  "How's the day treating you?",
];

const EVENING_CHECKIN_MESSAGES = [
  "Hey, how did today go?",
  "How was your day?",
  "Evening check-in — what happened today?",
  "How'd the day treat you?",
  "What got done today?",
  "Anything interesting happen today worth remembering?",
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getCheckinMessage(isEvening = false) {
  return isEvening ? randomFrom(EVENING_CHECKIN_MESSAGES) : randomFrom(CHECKIN_MESSAGES);
}

// Extract topics the user cares about from memory.txt
function extractInterestsFromMemory() {
  try {
    const text = fs.existsSync(MEMORY_FILE)
      ? fs.readFileSync(MEMORY_FILE, 'utf8').trim()
      : '';

    if (!text) return [];

    const interests = new Set();
    const lower = text.toLowerCase();

    // Common topic keywords — check if memory mentions them
    const topicMap = [
      { keywords: ['runescape', 'osrs', 'rs3', 'old school runescape'], topic: 'RuneScape OSRS' },
      { keywords: ['bitcoin', 'crypto', 'ethereum', 'btc', 'eth', 'defi', 'nft'], topic: 'crypto markets' },
      { keywords: ['football', 'soccer', 'premier league', 'champions league'], topic: 'football news' },
      { keywords: ['gaming', ' game', 'gamer', 'playstation', 'xbox', 'pc game'], topic: 'gaming news' },
      { keywords: ['programming', 'coding', 'developer', 'software', 'javascript', 'python'], topic: 'software development news' },
      { keywords: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'claude'], topic: 'AI news' },
      { keywords: ['music', 'spotify', 'playlist', 'album', 'band', 'artist'], topic: 'music news' },
      { keywords: ['film', 'movie', 'cinema', 'netflix', 'tv show', 'series'], topic: 'film and TV news' },
      { keywords: ['fitness', 'gym', 'workout', 'running', 'training'], topic: 'fitness' },
      { keywords: ['finance', 'investing', 'stocks', 'shares', 'market'], topic: 'stock market news' },
    ];

    for (const { keywords, topic } of topicMap) {
      if (keywords.some(kw => lower.includes(kw))) {
        interests.add(topic);
      }
    }

    // Also extract free-form interests from phrases like "likes X", "loves X", etc.
    const patterns = [
      /(?:likes?|loves?|enjoys?|interested in|fan of|into|obsessed with)\s+([^.,\n]{3,35})/gi,
      /hobby[:\s]+([^.,\n]{3,35})/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const topic = match[1].trim().replace(/^(the|a|an)\s+/i, '').replace(/\s+$/, '');
        if (topic.length >= 3 && topic.length <= 35) {
          interests.add(topic);
        }
      }
    }

    return [...interests].slice(0, 10);
  } catch {
    return [];
  }
}

// Pick a random interest and fetch one news article about it
async function getNewsDrop() {
  let interests = extractInterestsFromMemory();

  if (!interests.length) {
    interests = ['technology news', 'science news', 'world news'];
  }

  const topic = interests[Math.floor(Math.random() * interests.length)];

  try {
    const results = await braveSearch(`latest ${topic}`, 4);
    if (!results.length) return null;

    // Pick a random result from the top 3 so it varies
    const pick = results[Math.floor(Math.random() * Math.min(3, results.length))];
    return { topic, title: pick.title, description: pick.description, url: pick.url };
  } catch {
    return null;
  }
}

function formatNewsDrop(drop) {
  if (!drop) return null;
  const lines = [`📰 *${drop.topic}*\n`];
  lines.push(`*${drop.title}*`);
  if (drop.description) lines.push(drop.description);
  lines.push(drop.url);
  return lines.join('\n');
}

module.exports = {
  getCheckinMessage,
  getNewsDrop,
  formatNewsDrop,
  extractInterestsFromMemory
};
