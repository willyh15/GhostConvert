// src/converters/svgVectorize.js
import { promisify } from "util";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

function esc(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

/**
 * Quick analysis using ImageMagick to decide if this is "photo-like".
 * Returns: { width, height, colors, entropy }
 */
export async function analyzeImageForVectorize(inputPath) {
  const cmd = `identify -quiet -format "%w %h %k %[entropy]" ${esc(inputPath)}`;
  const { stdout } = await execAsync(cmd, {
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const parts = stdout.trim().split(/\s+/);
  const width = parseInt(parts[0], 10) || 0;
  const height = parseInt(parts[1], 10) || 0;
  const colors = parseInt(parts[2], 10) || 0;
  const entropy = parseFloat(parts[3]) || 0;

  return { width, height, colors, entropy };
}

function ensureFileExists(p, msg) {
  if (!fs.existsSync(p)) throw new Error(msg);
}

function countPaths(svgText) {
  const m = svgText.match(/<path\b/gi);
  return m ? m.length : 0;
}

/**
 * Pre-resize bitmap to keep VTracer predictable.
 * VTracer doesn't resize on its own.
 */
async function makeResizedInput(inputPath, outputDir, baseName, maxDimension, timeoutMs) {
  const tmpIn = path.join(outputDir, `${baseName}-vtracer-input.png`);

  // Keep alpha (PNG logos) by default; PNG is a safe intermediate for JPG too.
  // -strip removes metadata
  // Resize only if larger than maxDimension on either edge.
  const cmd =
    `convert ${esc(inputPath)} ` +
    `-strip ` +
    `-resize ${maxDimension}x${maxDimension}\\> ` +
    `${esc(tmpIn)}`;

  await execAsync(cmd, {
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });

  ensureFileExists(tmpIn, "Preprocess failed: resized input was not created.");
  return tmpIn;
}

/**
 * Vectorize bitmap (PNG/JPG) -> SVG using VTracer
 *
 * Presets:
 *  - logo   → clean logos, icons, flat art (default)
 *  - poster → more detail, still compact
 *  - photo  → allows photos (bigger SVGs)
 */
export async function bitmapToSvg(inputPath, outputDir, baseName, options = {}) {
  const {
    maxPixels = 6_000_000,
    maxDimension = 1600,

    rejectPhotoLike = true,
    entropyReject = 7.2,
    colorsReject = 25000,

    timeoutMs = 90_000,

    preset = "logo", // "logo" | "poster" | "photo"

    // Output guardrails (prevents insane SVGs)
    maxSvgBytes = preset === "photo" ? 30 * 1024 * 1024 : preset === "poster" ? 12 * 1024 * 1024 : 6 * 1024 * 1024,
    maxSvgPaths = preset === "photo" ? 25000 : preset === "poster" ? 12000 : 6000,
  } = options;

  // Basic input checks
  ensureFileExists(inputPath, "Input file not found for vectorization.");

  const stats = await analyzeImageForVectorize(inputPath);
  const pixels = stats.width * stats.height;

  if (!stats.width || !stats.height) {
    throw new Error("Unable to read image dimensions for vectorization.");
  }

  if (pixels > maxPixels) {
    throw new Error(
      `Image too large to vectorize safely (${stats.width}×${stats.height}). Please upload a smaller logo or icon.`
    );
  }

  // Photo-likeness rejection unless user explicitly chooses photo preset
  if (rejectPhotoLike && preset !== "photo") {
    if (stats.entropy > entropyReject || stats.colors > colorsReject) {
      throw new Error(
        "This image looks like a detailed photo. SVG vectorization is best for logos, icons, and simple graphics. Try the Photo preset if you really need it."
      );
    }
  }

  // Ensure output folder exists
  fs.mkdirSync(outputDir, { recursive: true });

  const outSvg = path.join(outputDir, `${baseName}.svg`);

  // 1) Pre-resize (ACTUALLY uses maxDimension)
  const resizedInput = await makeResizedInput(inputPath, outputDir, baseName, maxDimension, timeoutMs);

  // 2) Preset tuning: map GhostConvert preset → VTracer preset + params
  // NOTE: VTracer preset "poster" is a strong default for logos too.
  let vPreset = "poster";
  let mode = "spline";
  let hierarchical = "stacked";

  // Tuning knobs
  let filterSpeckle = 4;
  let colorPrecision = 6;
  let pathPrecision = 3;
  let cornerThreshold = 60;     // degrees
  let spliceThreshold = 45;     // degrees
  let segmentLength = 6;        // px-ish
  let gradientStep = 16;        // bigger = fewer gradient layers

  if (preset === "photo") {
    vPreset = "photo";
    mode = "spline";
    filterSpeckle = 2;
    colorPrecision = 7;
    pathPrecision = 4;
    cornerThreshold = 50;
    spliceThreshold = 35;
    segmentLength = 4;
    gradientStep = 8;           // more layers = more detail
  } else if (preset === "poster") {
    vPreset = "poster";
    mode = "spline";
    filterSpeckle = 4;
    colorPrecision = 6;
    pathPrecision = 3;
    cornerThreshold = 58;
    spliceThreshold = 40;
    segmentLength = 5;
    gradientStep = 12;
  } else {
    // logo (default)
    vPreset = "poster";
    mode = "spline";
    filterSpeckle = 6;          // removes tiny trash blobs
    colorPrecision = 5;         // fewer colors = cleaner
    pathPrecision = 2;          // fewer decimals = smaller SVG
    cornerThreshold = 65;       // crisper corners
    spliceThreshold = 50;
    segmentLength = 7;          // smoother, fewer segments
    gradientStep = 18;          // fewer gradient layers
  }

  // 3) Run VTracer
  // Ensure vtracer exists in PATH (nice error if not)
  try {
    await execAsync(`vtracer --version`, { timeout: 5_000, maxBuffer: 1 * 1024 * 1024 });
  } catch {
    // cleanup resized input
    try { fs.unlinkSync(resizedInput); } catch (_) {}
    throw new Error("VTracer is not installed or not available in PATH (vtracer).");
  }

  const vtracerCmd =
    `vtracer ` +
    `--input ${esc(resizedInput)} ` +
    `--output ${esc(outSvg)} ` +
    `--preset ${vPreset} ` +
    `--mode ${mode} ` +
    `--hierarchical ${hierarchical} ` +
    `--filter_speckle ${filterSpeckle} ` +
    `--color_precision ${colorPrecision} ` +
    `--path_precision ${pathPrecision} ` +
    `--corner_threshold ${cornerThreshold} ` +
    `--splice_threshold ${spliceThreshold} ` +
    `--segment_length ${segmentLength} ` +
    `--gradient_step ${gradientStep}`;

  await execAsync(vtracerCmd, {
    timeout: timeoutMs,
    maxBuffer: 100 * 1024 * 1024,
  });

  // Cleanup resized temp input
  try { fs.unlinkSync(resizedInput); } catch (_) {}

  // 4) Validate output exists
  ensureFileExists(outSvg, "Vectorization failed: SVG output not created.");

  // 5) Guardrails: size + path count
  const st = fs.statSync(outSvg);
  if (st.size > maxSvgBytes) {
    try { fs.unlinkSync(outSvg); } catch (_) {}
    throw new Error(
      "SVG output is too large for this preset. Try a simpler graphic, reduce detail, or use the Logo/Poster preset instead of Photo."
    );
  }

  const svgText = fs.readFileSync(outSvg, "utf8");
  const paths = countPaths(svgText);
  if (paths > maxSvgPaths) {
    try { fs.unlinkSync(outSvg); } catch (_) {}
    throw new Error(
      "SVG output has too many shapes/paths. Try a simpler image, reduce noise, or use the Logo preset for a cleaner result."
    );
  }

  return outSvg;
}