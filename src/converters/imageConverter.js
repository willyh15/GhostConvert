// src/converters/imageConverter.js
import { promisify } from "util";
import { exec } from "child_process";
import path from "path";

const execAsync = promisify(exec);

// All image conversions use ImageMagick `convert` where possible.

export async function convertPngToJpg(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.jpg`);
	await execAsync(`convert "${inputPath}" -strip -quality 85 "${out}"`);
	return out;
}

export async function convertJpgToPng(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.png`);
	await execAsync(`convert "${inputPath}" -strip "${out}"`);
	return out;
}

export async function convertHeicToJpg(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.jpg`);
	// using ImageMagick (with HEIC delegates) or `heif-convert` fallback
	try {
		await execAsync(`convert "${inputPath}" -strip -quality 90 "${out}"`);
	} catch {
		await execAsync(`heif-convert "${inputPath}" "${out}"`);
	}
	return out;
}

export async function compressImage(inputPath, outputDir, baseName) {
	const outExt = path.extname(inputPath).toLowerCase() === ".png" ? "png" : "jpg";
	const out = path.join(outputDir, `${baseName}-compressed.${outExt}`);
	if (outExt === "png") {
		await execAsync(
			`convert "${inputPath}" -strip -define png:compression-level=9 "${out}"`
		);
	} else {
		await execAsync(`convert "${inputPath}" -strip -quality 75 "${out}"`);
	}
	return out;
}

export async function convertWebpToJpg(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.jpg`);
	await execAsync(`convert "${inputPath}" -strip -quality 85 "${out}"`);
	return out;
}

export async function convertGifToWebp(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.webp`);
	// Animated GIF -> animated WEBP
	await execAsync(
		`convert "${inputPath}" -coalesce -loop 0 -quality 80 "${out}"`
	);
	return out;
}

// PNG -> WEBP
export async function convertPngToWebp(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.webp`);
	await execAsync(`convert "${inputPath}" -strip -quality 80 "${out}"`);
	return out;
}

// JPG -> WEBP
export async function convertJpgToWebp(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.webp`);
	await execAsync(`convert "${inputPath}" -strip -quality 80 "${out}"`);
	return out;
}

// NEW: WEBP -> PNG
export async function convertWebpToPng(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.png`);
	await execAsync(`convert "${inputPath}" -strip "${out}"`);
	return out;
}

// SVG → PNG
export async function convertSvgToPng(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.png`);
	// keep transparency where possible
	await execAsync(`convert "${inputPath}" -background none -strip "${out}"`);
	return out;
}

// SVG → JPG
export async function convertSvgToJpg(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.jpg`);
	// flatten onto white background since JPG has no alpha
	await execAsync(
		`convert "${inputPath}" -background white -flatten -strip -quality 85 "${out}"`
	);
	return out;
}

// SVG → WEBP (robust, with librsvg fallback)
export async function convertSvgToWebp(inputPath, outputDir, baseName) {
	const out = path.join(outputDir, `${baseName}.webp`);

	try {
		// First try direct ImageMagick raster → webp
		await execAsync(
			`convert "${inputPath}" -background none -strip -quality 80 "${out}"`
		);
		return out;
	} catch (err) {
		console.warn("Direct SVG→WEBP via ImageMagick failed, trying rsvg-convert fallback:", err?.message || err);

		// Fallback path: use librsvg (rsvg-convert) to rasterize SVG → PNG, then PNG → WEBP
		const tmpPng = path.join(outputDir, `${baseName}-tmp-svg.png`);

		// 1) SVG -> PNG via rsvg-convert (more robust SVG renderer)
		await execAsync(
			`rsvg-convert -f png -o "${tmpPng}" "${inputPath}"`
		);

		// 2) PNG -> WEBP via ImageMagick
		await execAsync(
			`convert "${tmpPng}" -strip -quality 80 "${out}"`
		);

		// 3) Clean up temp PNG (best-effort)
		try {
			await execAsync(`rm -f "${tmpPng}"`);
		} catch (_) {
			// ignore cleanup errors
		}

		return out;
	}
}