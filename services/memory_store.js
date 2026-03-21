/**
 * Structured, searchable memory store.
 * Uses vector embeddings (nomic-embed-text) for semantic search with keyword fallback.
 * Backed by data/memory_store.json
 *
 * Categories: health, goals, preferences, facts, general
 */

const fs = require('fs');
const path = require('path');

let embedFn = null;
let cosineFn = null;
try {
  const emb = require('./embeddings');
  embedFn = emb.embed;
  cosineFn = emb.cosine;
} catch (_) {}

const FILE = path.join(process.cwd(), 'data', 'memory_store.json');
const LEGACY_FILE = path.join(process.cwd(), 'memory.txt');

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function write(data) {
  ensureDir();
  const tmp = FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function detectMemoryCategory(content) {
  const lower = String(content || '').toLowerCase();
  if (/(health|medical|stomach|pain|doctor|sick|ill|workout|exercise|sleep|water|diet|weight|symptom|body)/i.test(lower))
    return 'health';
  if (/(goal|target|want to|plan to|going to|achieve|by \w+ i want|this year|next year|working towards)/i.test(lower))
    return 'goals';
  if (/(prefer|like|dislike|hate|love|enjoy|favourite|favorite|don't like|can't stand|theme|mode)/i.test(lower))
    return 'preferences';
  return 'facts';
}

// Migrate legacy memory.txt entries into structured store on first run
function migrateFromLegacy(chatId) {
  if (!fs.existsSync(LEGACY_FILE)) return;
  const existing = read();
  const legacyFlag = existing.some(m => m._migratedFrom === 'memory.txt');
  if (legacyFlag) return;

  const lines = fs.readFileSync(LEGACY_FILE, 'utf8')
    .split(/\r?\n/)
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  if (!lines.length) return;

  const now = Date.now();
  const newEntries = lines.map((content, i) => ({
    id: `legacy_${i}`,
    chatId: String(chatId || ''),
    category: detectMemoryCategory(content),
    content,
    embedding: null,
    ts: now,
    _migratedFrom: 'memory.txt'
  }));

  write([...existing, ...newEntries]);
}

async function addMemory(chatId, content, category) {
  const cat = category || detectMemoryCategory(content);
  const mem = read();

  // Deduplicate: skip if nearly identical content already exists
  const lower = content.toLowerCase().trim();
  const duplicate = mem.find(m => m.content.toLowerCase().trim() === lower);
  if (duplicate) return { id: duplicate.id, category: duplicate.category, content, duplicate: true };

  let embedding = null;
  if (embedFn) {
    try {
      embedding = await embedFn(content);
    } catch (_) {}
  }

  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    chatId: String(chatId || ''),
    category: cat,
    content: String(content).trim(),
    embedding,
    ts: Date.now()
  };

  mem.push(entry);
  write(mem);
  return { id, category: cat, content };
}

async function searchMemory(chatId, query, limit = 5) {
  const mem = read().filter(m => !m.chatId || m.chatId === String(chatId || ''));
  if (!mem.length) return [];

  // Try semantic search first
  if (embedFn && cosineFn) {
    try {
      const qEmb = await embedFn(query);
      const withEmbeddings = mem.filter(m => Array.isArray(m.embedding) && m.embedding.length > 0);
      if (withEmbeddings.length > 0) {
        return withEmbeddings
          .map(m => ({ ...m, score: cosineFn(qEmb, m.embedding) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }
    } catch (_) {}
  }

  // Keyword fallback
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (!terms.length) return mem.slice(0, limit);

  return mem
    .filter(m => terms.some(t => m.content.toLowerCase().includes(t)))
    .slice(0, limit);
}

function listMemories(chatId, category) {
  migrateFromLegacy(chatId);
  const mem = read().filter(m => !m.chatId || m.chatId === String(chatId || ''));
  if (category) return mem.filter(m => m.category === category);
  return mem;
}

function deleteMemoryById(id) {
  const mem = read().filter(m => m.id !== id);
  write(mem);
}

function formatMemoriesForPrompt(rows) {
  if (!rows || !rows.length) return '(none)';
  const byCategory = {};
  for (const row of rows) {
    const cat = row.category || 'general';
    byCategory[cat] = byCategory[cat] || [];
    byCategory[cat].push(row.content);
  }
  return Object.entries(byCategory)
    .map(([cat, items]) => `[${cat}]\n${items.map(i => `- ${i}`).join('\n')}`)
    .join('\n\n');
}

module.exports = {
  addMemory,
  searchMemory,
  listMemories,
  deleteMemoryById,
  formatMemoriesForPrompt,
  detectMemoryCategory,
  migrateFromLegacy
};
