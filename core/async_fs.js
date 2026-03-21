// whatsapp/core/async_fs.js
// Async wrapper utilities for all file I/O in WhatsApp automation bot

const fs = require('fs').promises;
const path = require('path');

module.exports = {
  async readFileSafe(filePath, encoding = 'utf8') {
    try {
      return await fs.readFile(filePath, encoding);
    } catch (e) {
      return '';
    }
  },
  async writeFileSafe(filePath, content, encoding = 'utf8') {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, encoding);
      return true;
    } catch (e) {
      return false;
    }
  },
  async appendFileSafe(filePath, content, encoding = 'utf8') {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, encoding);
      return true;
    } catch (e) {
      return false;
    }
  },
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }
};
