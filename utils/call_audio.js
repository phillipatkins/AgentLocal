const { spawn } = require('child_process');

function streamAudioToMic(file) {
  return spawn('ffmpeg', [
    '-re',
    '-i', file,
    '-f', 'pulse',
    'bot_sink'
  ], {
    stdio: 'inherit'
  });
}

module.exports = { streamAudioToMic };