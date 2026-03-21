// whatsapp/core/jobQueue.js - rudimentary background job queue
const EventEmitter = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.processing = false;
  }

  add(jobFn, desc = '') {
    this.jobs.push({ jobFn, desc });
    this.process();
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.jobs.length) {
      const { jobFn, desc } = this.jobs.shift();
      try {
        await jobFn();
        this.emit('job-done', desc);
      } catch (e) {
        this.emit('job-error', desc, e);
      }
    }
    this.processing = false;
  }
}

module.exports = new JobQueue();
