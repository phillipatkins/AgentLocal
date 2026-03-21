const BrowserAgent = require('./browser_agent');

let agent = null;

async function openBrowser(url = null, options = {}) {
  if (!agent) {
    agent = new BrowserAgent(options);
    await agent.start();
  }

  if (url) {
    await agent.goto(url);
  }

  return {
    browserContext: agent.context,
    pageInstance: agent.page,
    agent,
  };
}

async function closeBrowser() {
  if (!agent) return;
  await agent.close();
  agent = null;
}

function getPage() {
  return agent?.page || null;
}

function getContext() {
  return agent?.context || null;
}

module.exports = {
  openBrowser,
  closeBrowser,
  getPage,
  getContext,
  get browserContext() {
    return getContext();
  },
  get pageInstance() {
    return getPage();
  }
};
