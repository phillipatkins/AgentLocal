const axios = require('axios');
const { BRAVE_API_KEY } = require('../config');

async function braveSearch(query, count = 5) {
  const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_API_KEY
    },
    params: { q: query, count, safesearch: 'moderate' },
    timeout: 8000
  });

  const results = res.data?.web?.results || [];
  return results.slice(0, count).map(r => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || r.extra_snippets?.[0] || ''
  }));
}

function formatSearchResults(query, results) {
  if (!results.length) return `No results found for "${query}".`;

  const lines = [`🔍 *${query}*\n`];
  results.forEach((r, i) => {
    lines.push(`*${i + 1}. ${r.title}*`);
    if (r.description) lines.push(r.description);
    lines.push(r.url);
    lines.push('');
  });

  return lines.join('\n').trim();
}

function detectSearchIntent(prompt) {
  const raw = String(prompt || '').trim();
  const lower = raw.toLowerCase();

  // Explicit search commands
  let match = raw.match(/^search(?:\s+for)?\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^(?:look\s+up|lookup)\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^google\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^(?:find\s+info(?:rmation)?\s+(?:on|about)|research)\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^what(?:'s|\s+is)\s+(?:the\s+)?latest\s+(?:on|about|news\s+on)\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^what'?s\s+happening\s+with\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  match = raw.match(/^(?:latest|current)\s+news\s+(?:on|about)\s+(.+)$/i);
  if (match) return { query: match[1].trim() };

  // Questions that clearly need current/external info
  const currentInfoPatterns = [
    /^how much (?:does|is) .+ (?:cost|worth|trading|priced)/i,
    /^what(?:'s| is) the (?:current |latest )?(?:price|rate|value) of .+/i,
    /^what(?:'s| is) .+ (?:stock|share) price/i,
    /^what(?:'s| is) the (?:news|score|weather) (?:in|for|today)/i,
    /^(?:is|are) there any (?:news|updates) (?:on|about) .+/i
  ];

  for (const re of currentInfoPatterns) {
    if (re.test(raw)) return { query: raw };
  }

  return null;
}

module.exports = { braveSearch, formatSearchResults, detectSearchIntent };
