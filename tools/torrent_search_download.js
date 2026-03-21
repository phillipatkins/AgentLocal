const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getSession, updateSession } = require('../utils/session_state');

const execFileAsync = promisify(execFile);

const SEARCH_TIMEOUT_MS = Number(process.env.TORRENT_SEARCH_TIMEOUT_MS || 120000);
const DEFAULT_SITE = String(process.env.TORRENT_SEARCH_BASE_URL || 'https://thepiratebay.org').replace(/\/+$/, '');
const DEFAULT_PROXY = process.env.TORRENT_SEARCH_PROXY || 'socks5://127.0.0.1:9050';

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0];
}

function resolveScriptPath(scriptName, envValue) {
  const localScript = path.resolve(__dirname, '..', 'scripts', scriptName);
  const legacyScript = path.resolve(process.cwd(), 'scripts', scriptName);
  return firstExistingPath([
    envValue,
    localScript,
    legacyScript,
    path.resolve(__dirname, '..', 'scripts', scriptName)
  ].filter(Boolean));
}

const ARIA2_START_SCRIPT = resolveScriptPath('start-aria2-daemon.sh', process.env.ARIA2_START_SCRIPT);
const ARIA2_ADD_MAGNET_SCRIPT = resolveScriptPath('add-magnet.sh', process.env.ARIA2_ADD_MAGNET_SCRIPT);
const ARIA2_STATUS_SCRIPT = resolveScriptPath('status.sh', process.env.ARIA2_STATUS_SCRIPT);
const ARIA2_COMPLETED_SCRIPT = resolveScriptPath('completed.sh', process.env.ARIA2_COMPLETED_SCRIPT);

function normalizeQuery(input) {
  return String(input || '').trim().replace(/\s+/g, ' ');
}

function buildSearchUrl(query, page = 0) {
  return `${DEFAULT_SITE}/search.php?q=${encodeURIComponent(query)}&page=${encodeURIComponent(String(page))}`;
}

function decodeHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x3A;/gi, ':')
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function makeAbsoluteUrl(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return `${DEFAULT_SITE}${href}`;
  return `${DEFAULT_SITE}/${href}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((item) => {
    const key = `${item.magnet || ''}::${item.title || ''}`;
    if (!item.magnet || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeResults(results) {
  return dedupeResults(
    (results || []).map((item) => ({
      index: Number(item.index || 0),
      title: stripTags(item.title || '(no title)'),
      detailUrl: makeAbsoluteUrl(item.detailUrl || null),
      magnet: decodeHtml(item.magnet || ''),
      seeds: stripTags(item.seeds || ''),
      leeches: stripTags(item.leeches || ''),
      size: stripTags(item.size || ''),
      uploaded: stripTags(item.uploaded || ''),
      category: stripTags(item.category || '')
    }))
  ).filter((item) => item.magnet.startsWith('magnet:?'));
}

async function pageContainsAnyText(page, texts) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const normalized = String(bodyText || '').toLowerCase();
    return texts.some((text) => normalized.includes(String(text).toLowerCase()));
  } catch {
    return false;
  }
}

async function waitForResults(page) {
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      const hasEntries = await page.locator('li.list-entry').count().catch(() => 0);
      if (hasEntries > 0) return true;

      const hasTitleSpans = await page.locator('span.item-name.item-title, span.item-title, span.item-name').count().catch(() => 0);
      if (hasTitleSpans > 0) return true;

      const noResults = await pageContainsAnyText(page, ['No results found', 'No torrents found', '0 results']);
      if (noResults) return true;

      await sleep(1500);
    } catch (error) {
      lastError = error;
      await sleep(1500);
    }
  }

  throw new Error(`Timed out waiting for results page to finish loading${lastError ? `: ${lastError.message}` : ''}`);
}

async function scrapeWithPlaywright(query, pageNumber = 0) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    proxy: DEFAULT_PROXY ? { server: DEFAULT_PROXY } : undefined
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1200 }
    });

    const page = await context.newPage();
    const url = buildSearchUrl(query, pageNumber);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS });
    await waitForResults(page);

    const rawResults = await page.evaluate(() => {
      const entries = Array.from(document.querySelectorAll('li.list-entry'));

      function readText(node, selectors) {
        for (const selector of selectors) {
          const found = node.querySelector(selector);
          if (found && found.textContent) {
            const value = found.textContent.replace(/\s+/g, ' ').trim();
            if (value) return value;
          }
        }
        return '';
      }

      return entries.map((entry, index) => {
        const titleNode =
          entry.querySelector('span.item-name.item-title a') ||
          entry.querySelector('span.item-title a') ||
          entry.querySelector('span.item-name a') ||
          entry.querySelector('span.item-name.item-title') ||
          entry.querySelector('span.item-title') ||
          entry.querySelector('span.item-name');

        const magnetNode = entry.querySelector('a[href^="magnet:"]');
        const rawMagnet = magnetNode ? magnetNode.getAttribute('href') : '';

        return {
          index,
          title: titleNode ? titleNode.textContent.replace(/\s+/g, ' ').trim() : '(no title)',
          detailUrl: titleNode && titleNode.getAttribute ? titleNode.getAttribute('href') : null,
          magnet: rawMagnet || '',
          seeds: readText(entry, ['span.item-seed']),
          leeches: readText(entry, ['span.item-leech']),
          size: readText(entry, ['span.item-size']),
          uploaded: readText(entry, ['span.item-uploaded label', 'span.item-uploaded']),
          category: readText(entry, ['span.item-type'])
        };
      });
    });

    return {
      ok: true,
      query,
      page: pageNumber,
      url,
      totalFound: rawResults.length,
      results: sanitizeResults(rawResults).slice(0, 3),
      source: 'playwright'
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function requestText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      const statusCode = res.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(requestText(redirected, timeoutMs));
        return;
      }

      if (statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseResultsFromHtml(html) {
  const results = [];
  const rowRegex = /<li[^>]*class=["'][^"']*list-entry[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let rowMatch;
  let index = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const block = rowMatch[1];
    const magnetMatch = block.match(/href=["'](magnet:[^"']+)["']/i);
    if (!magnetMatch) continue;

    const titleMatch =
      block.match(/<span[^>]*class=["'][^"']*item-name[^"']*item-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<span[^>]*class=["'][^"']*item-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

    const seedsMatch = block.match(/<span[^>]*class=["'][^"']*item-seed[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const leechesMatch = block.match(/<span[^>]*class=["'][^"']*item-leech[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const sizeMatch = block.match(/<span[^>]*class=["'][^"']*item-size[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const uploadedMatch = block.match(/<span[^>]*class=["'][^"']*item-uploaded[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const categoryMatch = block.match(/<span[^>]*class=["'][^"']*item-type[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

    results.push({
      index: index += 1,
      title: titleMatch ? titleMatch[2] : '(no title)',
      detailUrl: titleMatch ? titleMatch[1] : null,
      magnet: magnetMatch[1],
      seeds: seedsMatch ? seedsMatch[1] : '',
      leeches: leechesMatch ? leechesMatch[1] : '',
      size: sizeMatch ? sizeMatch[1] : '',
      uploaded: uploadedMatch ? uploadedMatch[1] : '',
      category: categoryMatch ? categoryMatch[1] : ''
    });
  }

  return sanitizeResults(results);
}

async function scrapeWithHttpFallback(query, pageNumber = 0) {
  const url = buildSearchUrl(query, pageNumber);
  const html = await requestText(url, SEARCH_TIMEOUT_MS);
  const results = parseResultsFromHtml(html);

  return {
    ok: true,
    query,
    page: pageNumber,
    url,
    totalFound: results.length,
    results: results.slice(0, 3),
    source: 'http-fallback'
  };
}

async function scrapeResults(query, pageNumber = 0) {
  try {
    return await scrapeWithPlaywright(query, pageNumber);
  } catch (error) {
    return scrapeWithHttpFallback(query, pageNumber).catch((fallbackError) => {
      const firstMessage = error && error.message ? error.message : String(error);
      const secondMessage = fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError);
      throw new Error(`Search failed with Playwright (${firstMessage}) and HTTP fallback (${secondMessage})`);
    });
  }
}

function formatChoiceMessage(search) {
  if (!search.results || search.results.length === 0) {
    return `No results found for "${search.query}".`;
  }

  const lines = [`Top ${search.results.length} results for "${search.query}" (page ${Number(search.page) + 1}):`, ''];

  for (let i = 0; i < search.results.length; i += 1) {
    const item = search.results[i];
    lines.push(`${i + 1}. ${item.title}`);
    lines.push(`   Seeds: ${item.seeds || '0'} | Size: ${item.size || 'Unknown'} | Uploaded: ${item.uploaded || 'Unknown'}`);
    if (item.category) lines.push(`   Category: ${item.category}`);
    lines.push('');
  }

  lines.push('Reply with 1, 2, or 3 to download that result.');
  lines.push('Reply with "show more results" to fetch the next page.');
  return lines.join('\n');
}

function extractBtih(magnet) {
  const match = String(magnet || '').match(/[?&]xt=urn:btih:([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

async function runScript(scriptPath, args = []) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error(`Required script not found: ${scriptPath || '(missing path)'}`);
  }

  const { stdout, stderr } = await execFileAsync('bash', [scriptPath, ...args], {
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: String(stdout || '').trim(),
    stderr: String(stderr || '').trim()
  };
}

async function ensureAria2Daemon() {
  return runScript(ARIA2_START_SCRIPT);
}

async function startAria2Download(magnet) {
  const trimmed = String(magnet || '').trim();
  if (!trimmed.startsWith('magnet:?')) {
    throw new Error('Invalid magnet link');
  }

  await ensureAria2Daemon();
  const { stdout, stderr } = await runScript(ARIA2_ADD_MAGNET_SCRIPT, [trimmed]);

  return {
    ok: true,
    method: 'aria2-rpc',
    infoHash: extractBtih(trimmed),
    stdout,
    stderr
  };
}

function formatStatusOutput(title, output) {
  const clean = String(output || '').trim();
  if (!clean) return `${title}\nNo data returned.`;
  return `${title}\n${clean}`;
}

module.exports = async function torrentSearchDownload(args = {}) {
  try {
    const chatId = String(args.chatId || '').trim();
    const action = String(args.action || '').trim().toLowerCase();
    const query = normalizeQuery(args.query);
    const pageNumber = Number.isFinite(Number(args.page)) ? Number(args.page) : 0;
    const choiceRaw = String(args.choice || '').trim().toLowerCase();

    if (!chatId) {
      return { ok: false, error: 'chatId is required' };
    }

    if (action === 'search') {
      if (!query) {
        return { ok: false, error: 'query is required for search' };
      }

      const search = await scrapeResults(query, pageNumber);
      updateSession(chatId, {
        pendingTorrentPick: {
          query,
          page: search.page,
          results: search.results,
          url: search.url,
          updatedAt: Date.now()
        }
      });

      return {
        ok: true,
        mode: 'choice',
        query,
        page: search.page,
        results: search.results.map(({ magnet, ...rest }) => rest),
        message: formatChoiceMessage(search)
      };
    }

    if (action === 'pick') {
      const pending = (getSession(chatId) || {}).pendingTorrentPick;
      if (!pending || !Array.isArray(pending.results) || pending.results.length === 0) {
        return { ok: false, error: 'There is no active torrent result list for this chat. Run a search first.' };
      }

      if (choiceRaw === 'more' || choiceRaw === 'show more' || choiceRaw === 'show more results' || choiceRaw === 'next page') {
        const search = await scrapeResults(pending.query, Number(pending.page || 0) + 1);
        updateSession(chatId, {
          pendingTorrentPick: {
            query: pending.query,
            page: search.page,
            results: search.results,
            url: search.url,
            updatedAt: Date.now()
          }
        });

        return {
          ok: true,
          mode: 'choice',
          query: pending.query,
          page: search.page,
          results: search.results.map(({ magnet, ...rest }) => rest),
          message: formatChoiceMessage(search)
        };
      }

      const choice = Number(choiceRaw);
      if (![1, 2, 3].includes(choice)) {
        return { ok: false, error: 'Choice must be 1, 2, 3, or "show more results".' };
      }

      const selected = pending.results[choice - 1];
      if (!selected || !selected.magnet) {
        return { ok: false, error: `Result ${choice} is not available on the current page.` };
      }

      const download = await startAria2Download(selected.magnet);
      updateSession(chatId, {
        pendingTorrentPick: null,
        lastTorrentDownload: {
          query: pending.query,
          title: selected.title,
          page: pending.page,
          downloadedAt: Date.now(),
          infoHash: download.infoHash || null,
          downloader: download.method
        }
      });

      return {
        ok: true,
        mode: 'download-started',
        title: selected.title,
        seeds: selected.seeds || '0',
        size: selected.size || 'Unknown',
        uploaded: selected.uploaded || 'Unknown',
        magnet: selected.magnet,
        downloader: download.method,
        infoHash: download.infoHash || null,
        output: download.stdout || download.stderr || '',
        message: `Started download: ${selected.title}`
      };
    }

    if (action === 'download-magnet') {
      const download = await startAria2Download(String(args.magnet || '').trim());
      updateSession(chatId, {
        lastTorrentDownload: {
          query: null,
          title: null,
          page: null,
          downloadedAt: Date.now(),
          infoHash: download.infoHash || null,
          downloader: download.method
        }
      });

      return {
        ok: true,
        mode: 'download-started',
        downloader: download.method,
        infoHash: download.infoHash || null,
        output: download.stdout || download.stderr || '',
        message: 'Started magnet download.'
      };
    }

    if (action === 'check-status') {
      await ensureAria2Daemon();
      const { stdout, stderr } = await runScript(ARIA2_STATUS_SCRIPT);
      const output = stdout || stderr || 'No active downloads found.';
      return {
        ok: true,
        mode: 'status',
        output,
        message: formatStatusOutput('Active downloads:', output)
      };
    }

    if (action === 'check-completed') {
      await ensureAria2Daemon();
      const { stdout, stderr } = await runScript(ARIA2_COMPLETED_SCRIPT);
      const output = stdout || stderr || 'No completed downloads found.';
      return {
        ok: true,
        mode: 'completed',
        output,
        message: formatStatusOutput('Completed downloads:', output)
      };
    }

    if (action === 'start-daemon') {
      const { stdout, stderr } = await ensureAria2Daemon();
      const output = stdout || stderr || 'aria2 daemon checked.';
      return {
        ok: true,
        mode: 'daemon',
        output,
        message: output
      };
    }

    return {
      ok: false,
      error: 'Unsupported action. Use search, pick, download-magnet, check-status, check-completed, or start-daemon.'
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
};
