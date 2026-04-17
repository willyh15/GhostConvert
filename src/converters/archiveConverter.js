import { promisify } from "util";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

/**
 * Extract a ZIP and re-zip into a clean archive.
 */
export async function extractZipArchive(inputPath, outputDir, baseName) {
  const extractDir = path.join(outputDir, `${baseName}_extracted`);
  const outputZip = path.join(outputDir, `${baseName}-extracted.zip`);

  await fs.promises.mkdir(extractDir, { recursive: true });

  await execAsync(`unzip -o "${inputPath}" -d "${extractDir}"`);
  await execAsync(
    `cd "${outputDir}" && zip -r "${path.basename(outputZip)}" "${path.basename(extractDir)}"`
  );

  return outputZip;
}