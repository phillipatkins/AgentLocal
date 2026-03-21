const fs = require('fs');
const { openProvider, closeConnection } = require('./browser_connect');

const providerState = new Map();

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function looksInterim(text) {
  const t = normalize(text).toLowerCase();
  return !t || t === 'thinking' || t === 'answer now' || t === 'thinking answer now';
}

function isCompleteJson(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch (_) {
    return false;
  }
}

async function openGPT() {
  return openProvider('gpt');
}

async function openGrok() {
  return openProvider('grok');
}

async function findInputForProvider(page, provider) {
  const candidates = provider === 'gpt'
    ? [
        page.locator('textarea'),
        page.locator('[contenteditable="true"]'),
        page.getByPlaceholder(/message chatgpt|send a message|ask anything/i)
      ]
    : [
        page.locator('textarea'),
        page.locator('[contenteditable="true"]'),
        page.getByPlaceholder(/ask grok|what do you want to know|message grok/i)
      ];

  for (const c of candidates) {
    const count = await c.count().catch(() => 0);
    if (!count) continue;
    try {
      const first = c.first();
      await first.waitFor({ state: 'visible', timeout: 15000 });
      return first;
    } catch (_) {}
  }

  throw new Error(`Could not find ${provider} input box. Make sure you are logged in.`);
}

async function getCachedInput(provider, page) {
  const state = providerState.get(provider);
  if (state && state.page === page && state.input) {
    try {
      await state.input.count();
      return state.input;
    } catch (_) {}
  }

  const input = await findInputForProvider(page, provider);
  providerState.set(provider, { ...(state || {}), page, input });
  return input;
}

async function fastFill(page, input, message) {
  const value = String(message || '');
  await input.click({ force: true }).catch(() => {});

  const filled = await input.evaluate((el, text) => {
    const isTextArea = el.tagName === 'TEXTAREA';
    const isInput = el.tagName === 'INPUT';
    const isEditable = el.isContentEditable;

    if (isInput || isTextArea) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (isEditable) {
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '' }));
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return true;
    }

    return false;
  }, value).catch(() => false);

  if (!filled) {
    await input.fill('').catch(() => {});
    await input.fill(value).catch(async () => {
      await page.keyboard.insertText(value);
    });
  }
}

async function clickSend(page) {
  const sendLocators = [
    page.locator('[data-testid*="send"]'),
    page.getByRole('button', { name: /send/i }),
    page.getByLabel(/send/i),
  ];

  for (const send of sendLocators) {
    const count = await send.count().catch(() => 0);
    if (!count) continue;
    try {
      await send.first().click({ timeout: 1500 });
      return true;
    } catch (_) {}
  }

  await page.keyboard.press('Enter');
  return true;
}

async function captureLatestReply(page, provider) {
  return normalize(
    provider === 'gpt'
      ? await page.evaluate(() => {
          const selectors = [
            '[data-message-author-role="assistant"]',
            'main article',
            'main [data-testid*="conversation-turn"]'
          ];
          const candidates = [];
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              if (text) candidates.push(text);
            }
            if (candidates.length) break;
          }
          return candidates.length ? candidates[candidates.length - 1] : '';
        })
      : await page.evaluate(() => {
          const selectors = ['main article', 'main [data-testid*="message"]', 'main [role="article"]'];
          const candidates = [];
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              if (text) candidates.push(text);
            }
            if (candidates.length) break;
          }
          return candidates.length ? candidates[candidates.length - 1] : '';
        })
  );
}

async function isGenerationActive(page, provider) {
  if (provider !== 'gpt') return false;
  const selectors = [
    '[data-testid*="stop"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]'
  ];

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector);
      const count = await loc.count().catch(() => 0);
      if (!count) continue;
      if (await loc.first().isVisible().catch(() => false)) return true;
    } catch (_) {}
  }

  return false;
}

async function waitForStableReply(page, provider, previousReply = '', timeoutMs = 180000) {
  const start = Date.now();
  let last = '';
  let stableCount = 0;
  let sawActive = false;

  while (Date.now() - start < timeoutMs) {
    const active = await isGenerationActive(page, provider).catch(() => false);
    if (active) sawActive = true;

    const current = await captureLatestReply(page, provider);

    if (current && current !== previousReply && !looksInterim(current)) {
      if (current === last) stableCount += 1;
      else {
        last = current;
        stableCount = 0;
      }

      if (isCompleteJson(current)) {
        if (!active && stableCount >= 2) return current;
      } else if (!current.startsWith('{')) {
        if ((!sawActive || !active) && stableCount >= 2) return current;
      }
    }

    await page.waitForTimeout(active ? 1000 : 700);
  }

  const finalReply = await captureLatestReply(page, provider);
  if (looksInterim(finalReply)) {
    throw new Error('Timed out waiting for GPT to finish generating.');
  }
  return finalReply;
}

async function sendToProvider(provider, message) {
  const page = provider === 'gpt' ? await openGPT() : await openGrok();
  const input = await getCachedInput(provider, page);
  const previousReply = providerState.get(provider)?.lastReply || '';

  await fastFill(page, input, message);
  await clickSend(page);

  const reply = await waitForStableReply(page, provider, previousReply);

  providerState.set(provider, {
    ...(providerState.get(provider) || {}),
    page,
    input,
    lastReply: reply,
  });

  return reply;
}

async function tryAttachImage(page, imagePath) {
  // ChatGPT has a visible image file input with id="upload-photos" (accept="image/*").
  // Use setInputFiles on it directly — no need to click any button.
  const selectors = ['#upload-photos', '#upload-files', 'input[type="file"][accept="image/*"]', 'input[type="file"]'];

  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0) === 0) continue;
      await loc.setInputFiles(imagePath);
      await page.waitForTimeout(1500);
      return true;
    } catch (_) {}
  }

  return false;
}

async function relayVisionAction(provider, prompt, imagePath) {
  const page = provider === 'gpt' ? await openGPT() : await openGrok();
  const input = await getCachedInput(provider, page);
  const previousReply = providerState.get(provider)?.lastReply || '';

  if (imagePath && fs.existsSync(imagePath)) {
    await tryAttachImage(page, imagePath).catch(() => {});
    await page.waitForTimeout(1500);
  }

  await fastFill(page, input, prompt);
  await clickSend(page);

  const reply = await waitForStableReply(page, provider, previousReply);

  providerState.set(provider, {
    ...(providerState.get(provider) || {}),
    page,
    input,
    lastReply: reply,
  });

  return reply;
}

async function relayToProvider(provider, message) {
  if (provider === 'gpt') return sendToProvider('gpt', message);
  if (provider === 'grok') return sendToProvider('grok', message);
  throw new Error(`Unknown provider: ${provider}`);
}

async function stopProvider(provider = '') {
  if (provider) providerState.delete(provider);
  else providerState.clear();
  await closeConnection();
  return true;
}

async function newChat(provider) {
  const page = provider === 'gpt' ? await openGPT() : await openGrok();
  const candidates = provider === 'gpt'
    ? [
        page.locator('[data-testid="create-new-chat-button"]'),
        page.getByRole('button', { name: /new chat/i }),
        page.getByRole('link', { name: /new chat/i }),
      ]
    : [
        page.getByRole('button', { name: /new chat|new conversation|new grok/i }),
        page.getByRole('link', { name: /new chat|new conversation|new grok/i }),
      ];

  for (const loc of candidates) {
    const count = await loc.count().catch(() => 0);
    if (!count) continue;
    try {
      await loc.first().click({ timeout: 1200 });
      providerState.set(provider, { page, input: null, lastReply: '' });
      return true;
    } catch (_) {}
  }

  return false;
}

const aiBrowser = {
  async getPage(provider) {
    if (provider === 'gpt') return openGPT();
    if (provider === 'grok') return openGrok();
    throw new Error(`Unknown provider: ${provider}`);
  },
  async newChat(provider) {
    return newChat(provider);
  },
  async stop(provider) {
    return stopProvider(provider);
  },
};

module.exports = {
  relayToProvider,
  relayVisionAction,
  aiBrowser,
  stopProvider,
  openGPT,
  openGrok,
  newChat
};
