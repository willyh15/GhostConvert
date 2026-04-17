// src/utils/fileStorage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { log } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = process.env.STORAGE_INPUT || "tmp/input";
const OUTPUT_DIR = process.env.STORAGE_OUTPUT || "tmp/output";

export function ensureStorageDirs() {
  const inputPath = path.join(__dirname, "..", "..", INPUT_DIR);
  const outputPath = path.join(__dirname, "..", "..", OUTPUT_DIR);

  [inputPath, outputPath].forEach((p) => {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
      log("Created directory:", p);
    }
  });
}

export function getInputPath(filename) {
  const base = path.join(__dirname, "..", "..", INPUT_DIR);
  return path.join(base, filename);
}

export function getOutputPath(filename) {
  const base = path.join(__dirname, "..", "..", OUTPUT_DIR);
  return path.join(base, filename);
}

export function generateFileName(ext = "") {
  const id = uuidv4();
  return ext ? `${id}.${ext.replace(/^\./, "")}` : id;
}