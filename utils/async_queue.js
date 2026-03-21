// Per-chat async queue for safe mutation of chat state/persistence
const queues = {};

function enqueue(chatId, taskFn) {
  if (!queues[chatId]) {
    queues[chatId] = Promise.resolve();
  }
  // Chain the current task after the last
  queues[chatId] = queues[chatId].then(() => taskFn()).catch(() => {});
  return queues[chatId];
}

module.exports = { enqueue };