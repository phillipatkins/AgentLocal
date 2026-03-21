
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'reflections.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function reflect(chatId, messages) {
  const reflection = {
    chatId,
    date: new Date().toISOString().slice(0,10),
    summary: messages.slice(-10),
    createdAt: new Date().toISOString()
  };

  const data = load();
  data.push(reflection);
  save(data);

  return reflection;
}

module.exports = { reflect };
