const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function tmp(name) {
  return path.join(require('os').tmpdir(), `${name}-${Date.now()}`);
}

function convertOggToWav(input) {
  const out = `${tmp('voice')}.wav`;

  execSync(`ffmpeg -y -i "${input}" -ar 16000 -ac 1 "${out}"`, {
    stdio: 'ignore'
  });

  return out;
}

function convertTextToVoice(text) {
  const wav = `${tmp('tts')}.wav`;
  const ogg = `${tmp('tts')}.ogg`;

  execSync(`espeak-ng -w "${wav}" ${JSON.stringify(text)}`);

  execSync(
    `ffmpeg -y -i "${wav}" -c:a libopus -b:a 48k "${ogg}"`,
    { stdio: 'ignore' }
  );

  if (fs.existsSync(wav)) {
    fs.unlinkSync(wav);
  }

  return ogg;
}

module.exports = {
  convertOggToWav,
  convertTextToVoice
};