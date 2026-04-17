// src/converters/heicConverter.js
import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../utils/logger.js";

const execAsync = promisify(exec);

/**
 * HEIC -> JPG using heif-convert (from libheif-examples)
 */
export async function heicToJpg(inputPath, outputPath) {
  // heif-convert input.heic output.jpg
  const cmd = `heif-convert "${inputPath}" "${outputPath}"`;
  log("Running HEIC command:", cmd);
  await execAsync(cmd);
  return outputPath;
}