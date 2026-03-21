const { execSync } = require('child_process');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

// OCR for dialog detection
function readText(image) {
  try {
    return run(`tesseract ${image} stdout 2>/dev/null`);
  } catch {
    return "";
  }
}

// Detect "Click here to continue"
function detectContinue(text) {
  return text.toLowerCase().includes("click here to continue");
}

// Detect yellow arrow (VERY IMPORTANT)
function detectYellowArrow(image) {
  try {
    const out = run(`
convert ${image} \
  -fuzz 20% -fill white -opaque yellow \
  -format "%[fx:mean]" info:
`);
    return parseFloat(out) > 0.01;
  } catch {
    return false;
  }
}

// Detect minimap (top-right bright area)
function detectMinimapClick(image) {
  return {
    x: 2100,
    y: 200
  };
}

// Detect inventory slot (right side grid)
function detectInventory(image) {
  return {
    x: 1900,
    y: 700
  };
}

module.exports = {
  readText,
  detectContinue,
  detectYellowArrow,
  detectMinimapClick,
  detectInventory
};