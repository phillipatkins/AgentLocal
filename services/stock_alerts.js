const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ALERTS_FILE = path.join(process.cwd(), 'data', 'stock_alerts.json');

// Map of common crypto symbols to CoinGecko IDs
const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
  LTC: 'litecoin', UNI: 'uniswap', ATOM: 'cosmos', NEAR: 'near',
  SHIB: 'shiba-inu', TRX: 'tron', TON: 'the-open-network'
};

function readAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch { return []; }
}

function writeAlerts(alerts) {
  const dir = path.dirname(ALERTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = ALERTS_FILE + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(alerts, null, 2), 'utf8');
  fs.renameSync(tmp, ALERTS_FILE);
}

// Parse "watch AAPL above 200" or "alert me when BTC is below 50000"
function parseAlertCommand(text) {
  const raw = String(text || '').trim();

  let match = raw.match(/^watch\s+([A-Z0-9]+)\s+(above|below|over|under)\s+([\d,.]+)$/i);
  if (match) {
    return {
      symbol: match[1].toUpperCase(),
      condition: /above|over/i.test(match[2]) ? 'above' : 'below',
      threshold: parseFloat(match[3].replace(/,/g, ''))
    };
  }

  match = raw.match(/^alert\s+(?:me\s+)?when\s+([A-Z0-9]+)\s+(?:is\s+|goes?\s+)?(above|below|over|under)\s+([\d,.]+)$/i);
  if (match) {
    return {
      symbol: match[1].toUpperCase(),
      condition: /above|over/i.test(match[2]) ? 'above' : 'below',
      threshold: parseFloat(match[3].replace(/,/g, ''))
    };
  }

  return null;
}

// Parse "stop watching AAPL" / "remove alert AAPL"
function parseRemoveCommand(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^(?:stop watching|remove alert|delete alert|unwatch|cancel alert)\s+([A-Z0-9]+)$/i);
  if (match) return match[1].toUpperCase();
  return null;
}

function addAlert(chatId, symbol, condition, threshold) {
  const alerts = readAlerts();
  const filtered = alerts.filter(a => !(a.chatId === chatId && a.symbol === symbol));
  filtered.push({
    id: Date.now(),
    chatId,
    symbol,
    condition,
    threshold,
    createdAt: new Date().toISOString(),
    lastPrice: null,
    triggered: false
  });
  writeAlerts(filtered);
}

function removeAlert(chatId, symbol) {
  const alerts = readAlerts();
  const filtered = alerts.filter(a => !(a.chatId === chatId && a.symbol === symbol));
  const removed = filtered.length < alerts.length;
  writeAlerts(filtered);
  return removed;
}

function getAlerts(chatId) {
  return readAlerts().filter(a => a.chatId === chatId);
}

function formatAlertsList(alerts) {
  if (!alerts.length) return 'No active alerts. Set one with e.g. "watch BTC below 50000" or "watch AAPL above 200"';
  return alerts.map(a => {
    const price = a.lastPrice ? ` (last: $${Number(a.lastPrice).toLocaleString()})` : '';
    return `• ${a.symbol} ${a.condition} $${Number(a.threshold).toLocaleString()}${price}`;
  }).join('\n');
}

async function getPrice(symbol) {
  const cryptoId = CRYPTO_MAP[symbol.toUpperCase()];

  if (cryptoId) {
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: cryptoId, vs_currencies: 'usd' },
        timeout: 8000
      });
      const price = res.data?.[cryptoId]?.usd;
      if (price !== undefined) return { price, source: 'coingecko' };
    } catch {}
  }

  // Fallback: Yahoo Finance for stocks
  try {
    const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      params: { interval: '1d', range: '1d' },
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
    });
    const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price !== undefined) return { price, source: 'yahoo' };
  } catch {}

  return null;
}

// Returns array of triggered alerts: { chatId, symbol, condition, threshold, price }
async function checkAlerts() {
  const alerts = readAlerts();
  if (!alerts.length) return [];

  const triggered = [];
  const updated = alerts.map(a => ({ ...a }));

  for (let i = 0; i < updated.length; i++) {
    const alert = updated[i];
    try {
      const data = await getPrice(alert.symbol);
      if (!data) continue;

      updated[i].lastPrice = data.price;
      updated[i].lastChecked = new Date().toISOString();

      const hit = alert.condition === 'above'
        ? data.price >= alert.threshold
        : data.price <= alert.threshold;

      if (hit && !alert.triggered) {
        updated[i].triggered = true;
        triggered.push({
          chatId: alert.chatId,
          symbol: alert.symbol,
          condition: alert.condition,
          threshold: alert.threshold,
          price: data.price
        });
      } else if (!hit && alert.triggered) {
        // Reset so it can fire again when condition is met again
        updated[i].triggered = false;
      }
    } catch {}
  }

  writeAlerts(updated);
  return triggered;
}

module.exports = {
  parseAlertCommand,
  parseRemoveCommand,
  addAlert,
  removeAlert,
  getAlerts,
  formatAlertsList,
  checkAlerts,
  getPrice
};
