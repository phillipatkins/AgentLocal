const sqlite3 = require('sqlite3').verbose();
const chalk = require('chalk');
const { fullLineText } = require('./utils/logger');
const DB_FILE = 'chat_history.db';

function initDB() {
  const db = new sqlite3.Database(DB_FILE);

  db.run('CREATE TABLE IF NOT EXISTS messages (chat_id TEXT, role TEXT, content TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run(`CREATE TABLE IF NOT EXISTS summaries (
    chat_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    covered_up_to INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log(chalk.cyan('✓ Database: ' + DB_FILE));

  return {
    getHistory: (chatId, limit = 50) =>
      new Promise((resolve, reject) =>
        db.all(
          'SELECT role, content FROM messages WHERE chat_id=? ORDER BY timestamp ASC LIMIT ?',
          [chatId, limit],
          (err, rows) => (err ? reject(err) : resolve(rows.map(r => ({ role: r.role, content: r.content }))))
        )
      ),

    addMessage: (chatId, role, content) =>
      new Promise((resolve, reject) =>
        db.run(
          'INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)',
          [chatId, role, content],
          err => (err ? reject(err) : resolve())
        )
      ),

    getMessageCount: (chatId) =>
      new Promise((resolve, reject) =>
        db.get(
          'SELECT COUNT(*) as count FROM messages WHERE chat_id=?',
          [chatId],
          (err, row) => (err ? reject(err) : resolve(row?.count || 0))
        )
      ),

    // Returns the oldest N messages (for summarisation)
    getOldestMessages: (chatId, limit = 30) =>
      new Promise((resolve, reject) =>
        db.all(
          'SELECT rowid, role, content FROM messages WHERE chat_id=? ORDER BY timestamp ASC LIMIT ?',
          [chatId, limit],
          (err, rows) => (err ? reject(err) : resolve(rows || []))
        )
      ),

    // Delete messages by rowid (called after summarisation)
    deleteMessagesByRowIds: (rowIds) =>
      new Promise((resolve, reject) => {
        if (!rowIds || !rowIds.length) return resolve();
        const placeholders = rowIds.map(() => '?').join(',');
        db.run(`DELETE FROM messages WHERE rowid IN (${placeholders})`, rowIds, err =>
          err ? reject(err) : resolve()
        );
      }),

    getSummary: (chatId) =>
      new Promise((resolve, reject) =>
        db.get(
          'SELECT summary FROM summaries WHERE chat_id=?',
          [chatId],
          (err, row) => (err ? reject(err) : resolve(row?.summary || null))
        )
      ),

    saveSummary: (chatId, summary, coveredUpTo) =>
      new Promise((resolve, reject) =>
        db.run(
          `INSERT INTO summaries (chat_id, summary, covered_up_to, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(chat_id) DO UPDATE SET summary=excluded.summary, covered_up_to=excluded.covered_up_to, updated_at=CURRENT_TIMESTAMP`,
          [chatId, summary, coveredUpTo],
          err => (err ? reject(err) : resolve())
        )
      )
  };
}

module.exports = { initDB };
