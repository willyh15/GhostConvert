// AUDIO converter: MP4 → MP3

import { promisify } from "util";
import { exec } from "child_process";
import path from "path";

const execAsync = promisify(exec);

export async function convertMp4ToMp3(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.mp3`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${out}"`
  );
  return out;
}

// NEW: MP3 → WAV
export async function convertMp3ToWav(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.wav`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${out}"`
  );
  return out;
}

// NEW: WAV → MP3
export async function convertWavToMp3(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.mp3`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${out}"`
  );
  return out;
}

// NEW: M4A → MP3
export async function convertM4aToMp3(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.mp3`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 "${out}"`
  );
  return out;
}