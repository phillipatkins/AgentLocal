const agent = require('./desktop_agent');
const browserAgent = require('./browser_agent');

function rlog(message) {
  console.log(`[RECOVERY] ${message}`);
}

async function tryRecover(plan, error, context = {}) {
  const message = error && error.message ? error.message : String(error || 'unknown error');
  rlog(`recovering from action=${plan?.action} error=${message}`);

  try {
    if (plan && (plan.action === 'click_text' || plan.action === 'scroll')) {
      await agent.pressKey('Escape');
      return true;
    }

    if (plan && (plan.action === 'search_browser' || plan.action === 'goto_url')) {
      await browserAgent.openBrowser('https://www.google.com');
      return true;
    }

    if (plan && plan.action === 'open_browser') {
      await agent.openBrowser();
      return true;
    }
  } catch (inner) {
    rlog(`primary recovery failed: ${inner.message}`);
  }

  try {
    await agent.openBrowser();
    return true;
  } catch (inner) {
    rlog(`secondary recovery failed: ${inner.message}`);
  }

  return false;
}

module.exports = {
  tryRecover
};
