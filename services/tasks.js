/**
 * Simple task/to-do system backed by data/tasks.json
 *
 * Usage phrases handled in ollama.js:
 *   Add:      "add task: buy groceries", "todo: X", "remind me to X", "add to my list: X"
 *   List:     "what's on my list", "show my tasks", "my todo list", "what do i need to do"
 *   Complete: "done: buy groceries", "mark X as done", "completed X", "finished X"
 *   Delete:   "delete task: X", "remove task: X"
 */

const fs = require('fs');
const path = require('path');

const TASKS_FILE = path.join(process.cwd(), 'data', 'tasks.json');

function ensureDir() {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readTasks() {
  ensureDir();
  if (!fs.existsSync(TASKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  ensureDir();
  const tmp = TASKS_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8');
  fs.renameSync(tmp, TASKS_FILE);
}

function addTask(text, dueDate = null) {
  const tasks = readTasks();
  const id = Date.now();
  const task = {
    id,
    text: String(text).trim(),
    done: false,
    createdAt: new Date().toISOString(),
    dueDate: dueDate || null,
    doneAt: null
  };
  tasks.push(task);
  writeTasks(tasks);
  return task;
}

function listTasks(includeDone = false) {
  const tasks = readTasks();
  return includeDone ? tasks : tasks.filter(t => !t.done);
}

function completeTask(textOrId) {
  const tasks = readTasks();
  const lower = String(textOrId || '').toLowerCase().trim();
  const idx = tasks.findIndex(
    t => !t.done && (String(t.id) === lower || t.text.toLowerCase().includes(lower))
  );
  if (idx === -1) return null;
  tasks[idx].done = true;
  tasks[idx].doneAt = new Date().toISOString();
  writeTasks(tasks);
  return tasks[idx];
}

function deleteTask(textOrId) {
  const tasks = readTasks();
  const lower = String(textOrId || '').toLowerCase().trim();
  const idx = tasks.findIndex(
    t => String(t.id) === lower || t.text.toLowerCase().includes(lower)
  );
  if (idx === -1) return null;
  const [removed] = tasks.splice(idx, 1);
  writeTasks(tasks);
  return removed;
}

function formatTaskList(tasks) {
  if (!tasks.length) return 'Your task list is empty.';
  return tasks
    .map((t, i) => {
      const status = t.done ? '✅' : '☐';
      const due = t.dueDate ? ` (due ${t.dueDate})` : '';
      return `${status} ${i + 1}. ${t.text}${due}`;
    })
    .join('\n');
}

function detectTaskIntent(prompt) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase();

  // Add
  let match = raw.match(/^(?:add\s+(?:task|to\s+my\s+list|to\s+list)|todo|task)[:\s]+(.+)$/i);
  if (match) return { action: 'add', text: match[1].trim() };

  match = raw.match(/^(?:remind\s+me\s+to|i\s+need\s+to)\s+(.+)$/i);
  if (match) return { action: 'add', text: match[1].trim() };

  // List
  if (
    lower === "what's on my list" ||
    lower === 'show my tasks' ||
    lower === 'my todo list' ||
    lower === 'my task list' ||
    lower === 'show my todo list' ||
    lower === 'what do i need to do' ||
    lower === "what's on my todo list" ||
    lower === 'list my tasks' ||
    lower === 'show tasks'
  ) {
    return { action: 'list' };
  }

  // Complete
  match = raw.match(/^(?:done|completed|finished|mark\s+(?:as\s+)?done)[:\s]+(.+)$/i);
  if (match) return { action: 'complete', text: match[1].trim() };

  match = raw.match(/^mark\s+(.+?)\s+as\s+done$/i);
  if (match) return { action: 'complete', text: match[1].trim() };

  match = raw.match(/^i(?:'ve|\s+have)\s+(?:done|finished|completed)\s+(.+)$/i);
  if (match) return { action: 'complete', text: match[1].trim() };

  // Delete
  match = raw.match(/^(?:delete|remove)\s+(?:task\s+)?(.+)(?:\s+from\s+(?:my\s+)?(?:list|tasks))?$/i);
  if (match) return { action: 'delete', text: match[1].trim() };

  return null;
}

function handleTaskIntent(intent) {
  if (!intent) return null;

  if (intent.action === 'add') {
    const task = addTask(intent.text);
    return `Added to your list: "${task.text}"`;
  }

  if (intent.action === 'list') {
    const tasks = listTasks();
    return tasks.length
      ? `Your tasks:\n\n${formatTaskList(tasks)}`
      : 'Nothing on your list right now.';
  }

  if (intent.action === 'complete') {
    const task = completeTask(intent.text);
    return task
      ? `Marked as done: "${task.text}" ✅`
      : `Couldn't find a task matching "${intent.text}".`;
  }

  if (intent.action === 'delete') {
    const task = deleteTask(intent.text);
    return task
      ? `Removed "${task.text}" from your list.`
      : `Couldn't find a task matching "${intent.text}".`;
  }

  return null;
}

module.exports = {
  addTask,
  listTasks,
  completeTask,
  deleteTask,
  formatTaskList,
  detectTaskIntent,
  handleTaskIntent
};
