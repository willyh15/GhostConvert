// VIDEO converters

import { promisify } from "util";
import { exec } from "child_process";
import path from "path";

const execAsync = promisify(exec);

// GIF → MP4
export async function convertGifToMp4(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.mp4`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -movflags faststart -pix_fmt yuv420p -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2" "${out}"`
  );
  return out;
}

// MOV → MP4
export async function convertMovToMp4(inputPath, outputDir, baseName) {
  const out = path.join(outputDir, `${baseName}.mp4`);
  await execAsync(
    `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart "${out}"`
  );
  return out;
}