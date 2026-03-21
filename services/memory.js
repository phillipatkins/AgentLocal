const sqlite3 = require("sqlite3");

class Memory {
  constructor() {
    this.db = new sqlite3.Database("memory.db");
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signature TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });
  }

  seen(signature) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT id FROM history WHERE signature = ?",
        [signature],
        (err, row) => {
          if (err) return reject(err);
          if (row) return resolve(true);

          this.db.run(
            "INSERT OR IGNORE INTO history(signature) VALUES(?)",
            [signature],
            (insertErr) => {
              if (insertErr) return reject(insertErr);
              resolve(false);
            }
          );
        }
      );
    });
  }
}

module.exports = Memory;
