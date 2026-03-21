'use strict';

// ─── Character map builder ─────────────────────────────────────────────────────
// Takes a string of exactly 26 upper chars, 26 lower chars, and optionally 10 digit chars.
// Uses spread so multi-codepoint supplementary characters are handled correctly.
function buildMap(upper26, lower26, digits10 = '') {
  const map = {};
  const U = [...upper26];
  const L = [...lower26];
  const D = digits10 ? [...digits10] : [];
  for (let i = 0; i < 26; i++) {
    if (U[i]) map[String.fromCharCode(65 + i)] = U[i];
    if (L[i]) map[String.fromCharCode(97 + i)] = L[i];
  }
  for (let i = 0; i < 10 && i < D.length; i++) {
    map[String(i)] = D[i];
  }
  return map;
}

// ─── Font maps ─────────────────────────────────────────────────────────────────

const FONT_MAPS = {

  // 𝐌𝐚𝐭𝐡 𝐒𝐞𝐫𝐢𝐟 𝐁𝐨𝐥𝐝
  bold: buildMap(
    '𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙',
    '𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳',
    '𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗'
  ),

  // 𝑀𝑎𝑡ℎ 𝑆𝑒𝑟𝑖𝑓 𝐼𝑡𝑎𝑙𝑖𝑐
  italic: buildMap(
    '𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍',
    '𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧'
  ),

  // 𝑩𝒐𝒍𝒅 𝑰𝒕𝒂𝒍𝒊𝒄
  bold_italic: buildMap(
    '𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁',
    '𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛'
  ),

  // 𝔾𝕠𝕥𝕙𝕚𝕔 / Fraktur
  gothic: buildMap(
    '𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ',
    '𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷'
  ),

  // 𝓑𝓸𝓵𝓭 𝓢𝓬𝓻𝓲𝓹𝓽 (no exceptions — cleanest script font)
  script: buildMap(
    '𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩',
    '𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃'
  ),

  // 𝔻𝕠𝕦𝕓𝕝𝕖-𝕤𝕥𝕣𝕦𝕔𝕜
  double: buildMap(
    '𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ',
    '𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫',
    '𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡'
  ),

  // 𝗦𝗮𝗻𝘀-𝗦𝗲𝗿𝗶𝗳 𝗕𝗼𝗹𝗱 (cleanest bold on mobile)
  sansbold: buildMap(
    '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭',
    '𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇',
    '𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵'
  ),

  // 𝙼𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎
  mono: buildMap(
    '𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉',
    '𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣',
    '𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿'
  ),

  // Ｆｕｌｌｗｉｄｔｈ
  fullwidth: buildMap(
    'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ',
    'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
    '０１２３４５６７８９'
  ),

  // sᴍᴀʟʟᴄᴀᴘs
  smallcaps: (() => {
    const sc = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
    const map = {};
    const chars = [...sc];
    for (let i = 0; i < 26; i++) {
      map[String.fromCharCode(65 + i)] = chars[i]; // uppercase → smallcap
      map[String.fromCharCode(97 + i)] = chars[i]; // lowercase → smallcap
    }
    return map;
  })(),
};

// ─── Available fonts list (for help command) ───────────────────────────────────
const AVAILABLE_FONTS = [
  { name: 'normal',      label: 'Normal',          example: 'Normal text' },
  { name: 'bold',        label: 'Bold Serif',       example: '𝐁𝐨𝐥𝐝' },
  { name: 'italic',      label: 'Italic Serif',     example: '𝐼𝑡𝑎𝑙𝑖𝑐' },
  { name: 'bold_italic', label: 'Bold Italic',      example: '𝑩𝒐𝒍𝒅 𝑰𝒕𝒂𝒍𝒊𝒄' },
  { name: 'smallcaps',   label: 'Small Caps',       example: 'sᴍᴀʟʟᴄᴀᴘs' },
  { name: 'gothic',      label: 'Gothic/Fraktur',   example: '𝔊𝔬𝔱𝔥𝔦𝔠' },
  { name: 'script',      label: 'Bold Script',      example: '𝓢𝓬𝓻𝓲𝓹𝓽' },
  { name: 'double',      label: 'Double-struck',    example: '𝔻𝕠𝕦𝕓𝕝𝕖' },
  { name: 'sansbold',    label: 'Sans Bold',        example: '𝗦𝗮𝗻𝘀 𝗕𝗼𝗹𝗱' },
  { name: 'mono',        label: 'Monospace',        example: '𝙼𝚘𝚗𝚘' },
  { name: 'fullwidth',   label: 'Fullwidth',        example: 'Ｗｉｄｅ' },
];

// ─── Command parser ────────────────────────────────────────────────────────────
const FONT_ALIASES = {
  sans: 'sansbold', ssbold: 'sansbold', 'sans bold': 'sansbold',
  fraktur: 'gothic', cursive: 'script', calligraphy: 'script', calligraphic: 'script',
  caps: 'smallcaps', sc: 'smallcaps',
  fw: 'fullwidth', wide: 'fullwidth',
  monospace: 'mono', typewriter: 'mono',
  bi: 'bold_italic', bolditalic: 'bold_italic', 'bold italic': 'bold_italic',
  db: 'double', doublestruck: 'double', blackboard: 'double',
  default: 'normal', off: 'normal', reset: 'normal',
};

function parseSetFontCommand(text) {
  const lower = String(text || '').toLowerCase().trim();
  const validNames = AVAILABLE_FONTS.map(f => f.name);

  // "font bold" / "set font gothic" / "change font to smallcaps" / "use mono font"
  const match = lower.match(/^(?:set\s+|change\s+|use\s+)?font(?:\s+(?:to|style|:))?\s+([a-z_\s]+)$/) ||
                lower.match(/^(?:set\s+|change\s+|use\s+)?([a-z_]+)\s+font$/);
  if (match) {
    const req = match[1].trim().replace(/_/g, ' ').replace(/\s+/g, '_');
    const canonical = req.replace(/_/g, ' ');
    if (validNames.includes(req)) return req;
    if (FONT_ALIASES[req]) return FONT_ALIASES[req];
    if (FONT_ALIASES[canonical]) return FONT_ALIASES[canonical];
  }
  return null;
}

// ─── Core transform ────────────────────────────────────────────────────────────
function transformText(text, fontMap) {
  if (!fontMap || !text) return text;

  // Preserve URLs intact
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);

  return parts.map(part => {
    if (/^https?:\/\//.test(part)) return part;
    // Spread handles supplementary codepoints correctly
    return [...part].map(ch => fontMap[ch] ?? ch).join('');
  }).join('');
}

function applyFont(text, fontStyle) {
  if (!fontStyle || fontStyle === 'normal' || fontStyle === 'hacker') return text;
  return transformText(text, FONT_MAPS[fontStyle] ?? null);
}

// ─── Hacker mode wrapper ───────────────────────────────────────────────────────
function hackerWrap(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const lines = String(text || '').split('\n');
  const body = lines
    .map(line => line.trim() ? `> ${line}` : '')
    .join('\n')
    .trim();

  return `\`[SYS ${hh}:${mm}:${ss}]\`\n\n${body}\n\n\`[EOF]\``;
}

// ─── Box frame for important messages ─────────────────────────────────────────
// Works well on mobile because each line is independent (no alignment dependency)
function boxFrame(title, content) {
  const bar = '━'.repeat(26);
  return `*${bar}*\n*  ${title}  *\n*${bar}*\n\n${content}\n\n*${bar}*`;
}

// ─── Main entry ───────────────────────────────────────────────────────────────
function applyMessageStyle(text, fontStyle, hackerMode) {
  if (!text) return text;
  if (hackerMode) return hackerWrap(text);
  if (fontStyle && fontStyle !== 'normal') return applyFont(text, fontStyle);
  return text;
}

module.exports = {
  applyFont,
  hackerWrap,
  boxFrame,
  applyMessageStyle,
  parseSetFontCommand,
  AVAILABLE_FONTS,
  FONT_MAPS,
};
