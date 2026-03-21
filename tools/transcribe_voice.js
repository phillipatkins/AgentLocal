const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { transcribe } = require('./transcribe_audio');

function cleanupFiles(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (_) {}
  }
}

async function tryDownloadMedia(msg) {
  if (msg && typeof msg.downloadMedia === 'function') {
    return msg.downloadMedia();
  }

  const client =
    msg?.client ||
    msg?._client ||
    msg?.clientInstance ||
    null;

  if (client && typeof client.downloadMedia === 'function') {
    return client.downloadMedia(msg);
  }

  return null;
}

module.exports = async function transcribeVoice({ msg }) {
  let inputPath = null;
  let wavPath = null;

  try {
    const media = await tryDownloadMedia(msg);

    if (!media || !media.data) {
      return {
        ok: false,
        error: 'Could not download voice media.'
      };
    }

    const mime = String(media.mimetype || msg?._data?.mimetype || 'audio/ogg');
    const ext =
      mime.includes('ogg') ? 'ogg' :
      mime.includes('mpeg') ? 'mp3' :
      mime.includes('mp4') ? 'mp4' :
      mime.includes('wav') ? 'wav' :
      'ogg';

    inputPath = path.join('/tmp', `voice-${Date.now()}.${ext}`);
    wavPath = path.join('/tmp', `voice-${Date.now()}.wav`);

    fs.writeFileSync(inputPath, Buffer.from(media.data, 'base64'));

    execSync(
      `ffmpeg -y -loglevel error -i "${inputPath}" -ar 16000 -ac 1 "${wavPath}"`
    );

    if (!fs.existsSync(wavPath)) {
      return {
        ok: false,
        error: 'Failed to convert voice note to wav.'
      };
    }

    const text = transcribe(wavPath);

    if (!text || !String(text).trim()) {
      return {
        ok: false,
        error: 'No speech detected.'
      };
    }

    return {
      ok: true,
      text: String(text).trim()
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  } finally {
    cleanupFiles(inputPath, wavPath);
  }
};