const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const { chromiumBinary } = require('../utils/platform');

const REMOTE_DEBUGGING_PORT = Number(process.env.CHROME_REMOTE_DEBUG_PORT || 9222);
const CHROME_BINARY = process.env.CHROME_BINARY || chromiumBinary();

let browser = null;
let context = null;
let launchAttempted = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
}

async function isChromeDebuggingAvailable() {
  try {
    const data = await httpGetJson(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`);
    return Boolean(data && (data.Browser || data.webSocketDebuggerUrl));
  } catch (_) {
    return false;
  }
}

async function waitForChromeDebugging(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isChromeDebuggingAvailable()) return true;
    await delay(600);
  }
  return false;
}

function spawnChrome(binary) {
  return new Promise((resolve) => {
    console.log("[BROWSER_CONNECT] launching Chromium with remote debugging");
    console.log("[BROWSER_CONNECT] binary:", binary);
    console.log("[BROWSER_CONNECT] port:", REMOTE_DEBUGGING_PORT);

    let settled = false;

    try {
      const child = spawn(
        binary,
        [
          `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
          "--no-first-run",
          "--no-default-browser-check"
        ],
        {
          detached: true,
          stdio: "ignore"
        }
      );

      child.once("error", (err) => {
        if (settled) return;
        settled = true;
        console.log(`[BROWSER_CONNECT] failed to spawn ${binary}: ${err.code || err.message}`);
        resolve(false);
      });

      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve(true);
      });
    } catch (err) {
      console.log(`[BROWSER_CONNECT] failed to spawn ${binary}: ${err.code || err.message}`);
      resolve(false);
    }
  });
}

async function startChrome() {
  if (browser && context) {
    return { browser, context };
  }

  const alreadyRunningWithDebug = await isChromeDebuggingAvailable();

  if (!alreadyRunningWithDebug) {
    if (!launchAttempted) {
      launchAttempted = true;
      const started = await spawnChrome(CHROME_BINARY);
      if (!started) {
        throw new Error(
          `Could not launch Chromium using binary "${CHROME_BINARY}". Set CHROME_BINARY if needed.`
        );
      }
    }

    const ok = await waitForChromeDebugging(35000);
    if (!ok) {
      throw new Error(
        `Chromium window may have opened, but remote debugging on port ${REMOTE_DEBUGGING_PORT} never became available. ` +
        `Close existing Chromium/Chrome windows and try again, or launch Chromium manually with --remote-debugging-port=${REMOTE_DEBUGGING_PORT}.`
      );
    }
  } else {
    console.log("[BROWSER_CONNECT] found existing Chrome/Chromium remote debugging session");
  }

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);

  if (!browser.contexts().length) {
    throw new Error("Connected to Chromium, but no browser contexts were available.");
  }

  context = browser.contexts()[0];
  return { browser, context };
}

function pageMatchesProvider(url, provider) {
  const u = String(url || "").toLowerCase();
  if (provider === "gpt") return u.includes("chatgpt.com");
  if (provider === "grok") return u.includes("grok.com") || u.includes("x.com/i/grok");
  return false;
}

function providerUrl(provider) {
  if (provider === "gpt") return "https://chatgpt.com";
  if (provider === "grok") return "https://grok.com";
  throw new Error(`Unknown provider: ${provider}`);
}

async function getExistingProviderPage(provider) {
  const { context } = await startChrome();

  for (const page of context.pages()) {
    try {
      const url = page.url();
      if (pageMatchesProvider(url, provider)) {
        await page.bringToFront().catch(() => {});
        return page;
      }
    } catch (_) {}
  }

  return null;
}

async function getPage(provider = "") {
  const { context } = await startChrome();

  if (provider) {
    const existing = await getExistingProviderPage(provider);
    if (existing) return existing;
  }

  const pages = context.pages();
  if (pages.length) {
    const page = pages[0];
    await page.bringToFront().catch(() => {});
    return page;
  }

  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  return page;
}

async function openProvider(provider) {
  const existing = await getExistingProviderPage(provider);
  if (existing) return existing;

  const page = await getPage();
  const target = providerUrl(provider);

  if (!pageMatchesProvider(page.url(), provider)) {
    console.log("[BROWSER_CONNECT] opening provider:", provider, target);
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
  }

  await page.bringToFront().catch(() => {});
  return page;
}

async function closeConnection() {
  try {
    if (browser) {
      await browser.close().catch(() => {});
    }
  } finally {
    browser = null;
    context = null;
    launchAttempted = false;
  }
}

module.exports = {
  startChrome,
  getPage,
  openProvider,
  getExistingProviderPage,
  closeConnection
};
