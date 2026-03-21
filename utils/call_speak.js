const { speak } = require('../tools/tts_voice');
const { streamAudioToMic } = require('./call_audio');

async function speakIntoCall(text) {
  const audioFile = speak(text);
  const proc = streamAudioToMic(audioFile);

  return new Promise((resolve, reject) => {
    proc.on('close', code => {
      resolve({ ok: code === 0, code, audioFile });
    });
    proc.on('error', reject);
  });
}

module.exports = { speakIntoCall };