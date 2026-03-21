'use strict';

const chalk = require('chalk');

const W = s => chalk.bold.white(s);
const C = s => chalk.hex('#00d4ff').bold(s);
const D = s => chalk.gray(s);

//  ASCII representation of the Agent Local "AL" mark
//
//       /\     │
//      /  \    │
//     /    \   │
//    /      \  │
//   /   AL   \ │────────
//  /___________│        │
//               ─────────

const MARK = [
  W('    \\    ') + W('|'),
  W('   _ \\   ') + W('|'),
  W('  ___ \\  ') + W('|'),
  W('_/    _\\_____') + W('|'),
];

const WORDMARK  = C('  A G E N T   L O C A L');
const SUBMARK   = D('  self-hosted WhatsApp AI');

function print() {
  console.log('');
  MARK.forEach(l => console.log('  ' + l));
  console.log('');
  console.log('  ' + WORDMARK);
  console.log('  ' + SUBMARK);
  console.log('');
}

module.exports = { print };
