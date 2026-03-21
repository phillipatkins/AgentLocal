const { buildScreenState } = require('../tools/screen_perception');
const browserAgent = require('./browser_agent');

function toTargets(boxes = []) {
  return boxes.map((box, index) => ({
    id: `ocr-${index}`,
    source: 'ocr',
    label: box.text,
    confidence: box.confidence,
    bbox: box.bbox,
    clickable: true
  }));
}

function browserTargetsFromState(browserState) {
  const words = Array.isArray(browserState.visibleTexts) ? browserState.visibleTexts : [];
  return words.slice(0, 100).map((word, index) => ({
    id: `browser-word-${index}`,
    source: 'browser',
    label: word,
    confidence: 90,
    bbox: null,
    clickable: false
  }));
}

async function buildWorldState(options = {}) {
  const screen = buildScreenState(Boolean(options.forceFresh));
  const browser = await browserAgent.getPageState();

  const targets = [
    ...toTargets(screen.textBoxes),
    ...browserTargetsFromState(browser)
  ];

  return {
    timestamp: Date.now(),
    activeWindow: screen.activeWindow,
    browser,
    screen,
    targets
  };
}

module.exports = {
  buildWorldState
};
