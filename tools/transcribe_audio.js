const { spawnSync } = require('child_process');
const fs = require('fs');

function transcribe(file) {
  if (!file || !fs.existsSync(file)) {
    throw new Error(`Audio file not found: ${file}`);
  }

  const pythonCode = `
from faster_whisper import WhisperModel
import sys

audio_path = sys.argv[1]

model = WhisperModel("tiny", compute_type="int8")
segments, info = model.transcribe(audio_path, vad_filter=True)

parts = []
for seg in segments:
    text = seg.text.strip()
    if text:
        parts.append(text)

final_text = " ".join(parts).strip()
print(final_text)
`;

  const result = spawnSync(
    './venv/bin/python',
    ['-c', pythonCode, file],
    {
      encoding: 'utf8'
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Transcription failed: ${result.stderr || result.stdout || 'unknown error'}`
    );
  }

  return (result.stdout || '').trim();
}

module.exports = { transcribe };