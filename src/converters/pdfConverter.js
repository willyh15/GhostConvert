// src/converters/pdfConverter.js
import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../utils/logger.js";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const execAsync = promisify(exec);

/**
 * Compress PDF using Ghostscript
 */
export async function compressPdf(inputPath, outputPath) {
	const cmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
	log("Running PDF compress command:", cmd);
	await execAsync(cmd);
	return outputPath;
}

/**
 * PDF -> JPG (first page only)
 */
export async function pdfToJpg(inputPath, outputPath) {
	// -density 150 for decent quality, [0] = first page
	const cmd = `convert -density 150 "${inputPath}[0]" -quality 90 "${outputPath}"`;
	log("Running PDF->JPG command:", cmd);
	await execAsync(cmd);
	return outputPath;
}

/**
 * JPG -> PDF (single image -> single-page PDF)
 */
export async function jpgToPdf(inputPath, outputPath) {
	const cmd = `convert "${inputPath}" -auto-orient -strip "${outputPath}"`;
	log("Running JPG->PDF command:", cmd);
	await execAsync(cmd);
	return outputPath;
}

/**
 * PNG -> PDF (single image -> single-page PDF)
 * Multi-file PNG → PDF is handled in the worker using a multi-input `convert` command.
 */
export async function pngToPdf(inputPath, outputPath) {
	const cmd = `convert "${inputPath}" -auto-orient -strip "${outputPath}"`;
	log("Running PNG->PDF command:", cmd);
	await execAsync(cmd);
	return outputPath;
}

/**
 * Merge multiple PDFs into one
 * Tries pdfunite first, falls back to Ghostscript if needed.
 */
export async function mergePdf(inputPaths, outputPath) {
	const inputsJoined = inputPaths.map((p) => `"${p}"`).join(" ");

	// Try pdfunite
	try {
		const cmdUnite = `pdfunite ${inputsJoined} "${outputPath}"`;
		log("Running PDF merge command (pdfunite):", cmdUnite);
		await execAsync(cmdUnite);
		return outputPath;
	} catch (err) {
		log("pdfunite failed, falling back to Ghostscript:", err?.message || err);
	}

	// Fallback: Ghostscript merge
	const cmdGs = `gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -sOutputFile="${outputPath}" ${inputsJoined}`;
	log("Running PDF merge command (Ghostscript):", cmdGs);
	await execAsync(cmdGs);
	return outputPath;
}

/**
 * Split a single PDF into per-page PDFs and bundle them into a ZIP.
 *
 * Returns: absolute path to the ZIP file in outputDir.
 */
export async function splitPdf(inputPath, outputDir) {
	const baseName = path.parse(inputPath).name;
	const tempFolderName = `${baseName}-pages-${uuidv4()}`;
	const splitDir = path.join(outputDir, tempFolderName);

	fs.mkdirSync(splitDir, { recursive: true });

	// 1) Try pdfseparate (Poppler)
	try {
		const pattern = path.join(splitDir, `${baseName}-%03d.pdf`);
		const cmdSeparate = `pdfseparate "${inputPath}" "${pattern}"`;
		log("Running PDF split command (pdfseparate):", cmdSeparate);
		await execAsync(cmdSeparate);
	} catch (err) {
		log("pdfseparate failed, trying Ghostscript fallback:", err?.message || err);

		// 2) Fallback: Ghostscript per-page using pdfinfo to get page count
		try {
			const infoCmd = `pdfinfo "${inputPath}"`;
			log("Running pdfinfo for split fallback:", infoCmd);
			const { stdout } = await execAsync(infoCmd);

			const match = stdout.match(/Pages:\s+(\d+)/i);
			const pages = match ? parseInt(match[1], 10) : 0;
			if (!pages || Number.isNaN(pages)) {
				throw new Error("Unable to detect page count for PDF split");
			}

			for (let i = 1; i <= pages; i++) {
				const outPath = path.join(
					splitDir,
					`${baseName}-${String(i).padStart(3, "0")}.pdf`
				);
				const cmdGs = `gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -dFirstPage=${i} -dLastPage=${i} -sOutputFile="${outPath}" "${inputPath}"`;
				log("Running PDF split command (Ghostscript, page " + i + "):", cmdGs);
				await execAsync(cmdGs);
			}
		} catch (fallbackErr) {
			log(
				"Ghostscript split fallback failed:",
				fallbackErr?.message || fallbackErr
			);
			throw fallbackErr;
		}
	}

	// 3) Zip all the per-page PDFs into a single archive
	const zipName = `${baseName}-pages-${uuidv4()}.zip`;
	const zipPath = path.join(outputDir, zipName);

	// Create ZIP from within the splitDir so we only include the page files
	const cmdZip = `cd "${splitDir}" && zip -r "${zipPath}" .`;
	log("Zipping split PDF pages:", cmdZip);
	await execAsync(cmdZip);

	return zipPath;
}

/**
 * Delete selected PDF pages and return a new single output PDF.
 */
export async function deletePdfPages(inputPath, outputDir, removeSpec) {
	const baseName = path.parse(inputPath).name;
	const tempFolderName = `${baseName}-keep-${uuidv4()}`;
	const splitDir = path.join(outputDir, tempFolderName);

	fs.mkdirSync(splitDir, { recursive: true });

	log("Parsing removeSpec:", removeSpec);

	// Convert: "1,3,7-10" => Set of numbers
	const removeSet = new Set();
	const parts = (removeSpec || "").split(",");
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		if (trimmed.includes("-")) {
			const [start, end] = trimmed.split("-").map((x) => parseInt(x, 10));
			if (!isNaN(start) && !isNaN(end)) {
				for (let i = start; i <= end; i++) removeSet.add(i);
			}
		} else {
			const n = parseInt(trimmed, 10);
			if (!isNaN(n)) removeSet.add(n);
		}
	}

	// Step 1: get page count
	let pages = 0;
	try {
		const infoCmd = `pdfinfo "${inputPath}"`;
		const { stdout } = await execAsync(infoCmd);
		const match = stdout.match(/Pages:\s+(\d+)/i);
		pages = match ? parseInt(match[1], 10) : 0;
	} catch (err) {
		log("pdfinfo failed:", err?.message || err);
	}
	if (!pages) throw new Error("Unable to detect pages for delete operation");

	log("Total pages:", pages);

	// fast path using pdfseparate + pdfunite
	try {
		// split all pages
		const pattern = path.join(splitDir, `${baseName}-%03d.pdf`);
		const cmdSeparate = `pdfseparate "${inputPath}" "${pattern}"`;
		log("Running pdfseparate:", cmdSeparate);
		await execAsync(cmdSeparate);

		// collect kept pages
		const keepPaths = [];
		for (let i = 1; i <= pages; i++) {
			if (removeSet.has(i)) continue;
			const num = String(i).padStart(3, "0");
			keepPaths.push(path.join(splitDir, `${baseName}-${num}.pdf`));
		}

		if (!keepPaths.length) throw new Error("No pages left after deletion");

		const outName = `${baseName}-deleted-${uuidv4()}.pdf`;
		const outPath = path.join(outputDir, outName);

		const inputsJoined = keepPaths.map((p) => `"${p}"`).join(" ");
		const cmdUnite = `pdfunite ${inputsJoined} "${outPath}"`;
		log("Running pdfunite for delete:", cmdUnite);
		await execAsync(cmdUnite);

		return outPath;
	} catch (err) {
		log("Poppler path failed, using Ghostscript fallback:", err?.message || err);
	}

	// fallback: ghostscript page by page rebuild
	const keepList = [];
	for (let i = 1; i <= pages; i++) {
		if (!removeSet.has(i)) keepList.push(i);
	}
	if (!keepList.length) throw new Error("No pages left after deletion");

	const outName = `${baseName}-deleted-${uuidv4()}.pdf`;
	const outPath = path.join(outputDir, outName);

	// build single merged file via multiple gs calls
	const tempParts = [];
	for (const pageNum of keepList) {
		const num = String(pageNum).padStart(3, "0");
		const tempOut = path.join(splitDir, `${baseName}-${num}.pdf`);
		const cmdGs = `gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -dFirstPage=${pageNum} -dLastPage=${pageNum} -sOutputFile="${tempOut}" "${inputPath}"`;
		log("Split single via GS:", cmdGs);
		await execAsync(cmdGs);
		tempParts.push(tempOut);
	}

	const merged = tempParts.map((p) => `"${p}"`).join(" ");
	const cmdMerge = `gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -sOutputFile="${outPath}" ${merged}`;
	log("Merging kept pages via GS:", cmdMerge);
	await execAsync(cmdMerge);

	return outPath;
}

export async function excelToPdf(inputPath, outputDir) {
	const baseName = path.parse(inputPath).name;
	const outPath = path.join(outputDir, `${baseName}.pdf`);

	const cmd = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
	log("Running Excel->PDF command:", cmd);

	try {
		const { stdout, stderr } = await execAsync(cmd);
		if (stdout) log("LibreOffice Excel->PDF stdout:", stdout.trim());
		if (stderr) log("LibreOffice Excel->PDF stderr:", stderr.trim());
	} catch (err) {
		log("LibreOffice Excel->PDF error:", err?.stderr || err?.message || err);
		throw err;
	}

	// Preferred: baseName.pdf
	if (fs.existsSync(outPath)) {
		return outPath;
	}

	// Fallback: scan for any matching PDF starting with baseName
	try {
		const files = fs.readdirSync(outputDir);
		const match = files.find(
			(f) =>
			f.toLowerCase().endsWith(".pdf") &&
			(f === `${baseName}.pdf` || f.startsWith(baseName))
		);
		if (match) {
			const candidate = path.join(outputDir, match);
			if (fs.existsSync(candidate)) {
				log("Excel->PDF: found PDF via fallback scan:", candidate);
				return candidate;
			}
		}
	} catch (scanErr) {
		log("Excel->PDF: error scanning outputDir for PDF:", scanErr?.message || scanErr);
	}

	throw new Error(`Excel->PDF output not found for base "${baseName}"`);
}

/**
 * PDF -> Word (DOCX)
 * (see existing logic)
 */
export async function pdfToWord(inputPath, outputDir) {
	const baseName = path.parse(inputPath).name;
	const odtPath = path.join(outputDir, `${baseName}.odt`);
	const docxPath = path.join(outputDir, `${baseName}.docx`);

	// --- Step 1: PDF → ODT ---
	const cmdPdfToOdt = `libreoffice --headless --convert-to "odt:writer8" --outdir "${outputDir}" "${inputPath}"`;
	log("Running PDF->ODT command:", cmdPdfToOdt);

	try {
		const { stdout, stderr } = await execAsync(cmdPdfToOdt);
		if (stdout) log("LibreOffice PDF->ODT stdout:", stdout.trim());
		if (stderr) log("LibreOffice PDF->ODT stderr:", stderr.trim());
	} catch (err) {
		log("LibreOffice PDF->ODT error:", err?.stderr || err?.message || err);
		throw err;
	}

	let actualOdt = odtPath;
	if (!fs.existsSync(actualOdt)) {
		try {
			const files = fs.readdirSync(outputDir);
			const match = files.find(
				(f) =>
				f.toLowerCase().endsWith(".odt") &&
				(f === `${baseName}.odt` || f.startsWith(baseName))
			);
			if (match) {
				actualOdt = path.join(outputDir, match);
			}
		} catch (scanErr) {
			log("Error scanning outputDir for ODT:", scanErr?.message || scanErr);
		}
	}

	if (!fs.existsSync(actualOdt)) {
		throw new Error(`PDF->Word: ODT file not found for base "${baseName}"`);
	}

	// --- Step 2: ODT → DOCX ---
	const cmdOdtToDocx = `libreoffice --headless --convert-to "docx:MS Word 2007 XML" --outdir "${outputDir}" "${actualOdt}"`;
	log("Running ODT->DOCX command:", cmdOdtToDocx);

	try {
		const { stdout, stderr } = await execAsync(cmdOdtToDocx);
		if (stdout) log("LibreOffice ODT->DOCX stdout:", stdout.trim());
		if (stderr) log("LibreOffice ODT->DOCX stderr:", stderr.trim());
	} catch (err) {
		log("LibreOffice ODT->DOCX error:", err?.stderr || err?.message || err);
	}

	if (fs.existsSync(docxPath)) {
		try { fs.unlinkSync(actualOdt); } catch (_) {}
		return docxPath;
	}

	if (fs.existsSync(actualOdt)) {
		try {
			fs.copyFileSync(actualOdt, docxPath);
			log("ODT->DOCX: real DOCX missing; copied ODT contents to DOCX path:", docxPath);
			return docxPath;
		} catch (copyErr) {
			log("ODT->DOCX fallback copy failed:", copyErr?.message || copyErr);
		}
	}

	throw new Error(`PDF->Word output DOCX not found for base "${baseName}"`);
}

/**
 * Unlock PDF (remove owner restrictions).
 * If password is provided, qpdf will use it. Otherwise it will attempt decrypt without password.
 */
export async function unlockPdf(inputPath, outputDir, password = null) {
	const baseName = path.parse(inputPath).name;
	const outPath = path.join(outputDir, `${baseName}-unlocked.pdf`);

	const pwArg = password ? `--password="${String(password).replace(/"/g, '\\"')}" ` : "";
	const cmd = `qpdf ${pwArg}--decrypt "${inputPath}" "${outPath}"`;
	log("Running Unlock-PDF command:", cmd);

	await execAsync(cmd);
	return outPath;
}

/**
 * Rotate PDF pages using qpdf.
 * extra:
 *  - degrees: 90 | -90 | 180  (strings ok)
 *  - pages: "all" or "1-3,5,9-10" (optional; default "all")
 *
 * qpdf supports:
 *   --rotate=+90           (all pages)
 *   --rotate=+90:1-3,5     (specific pages)
 */
export async function rotatePdf(inputPath, outputDir, degrees = 90, pages = "all") {
	const baseName = path.parse(inputPath).name;
	const outPath = path.join(outputDir, `${baseName}-rotated.pdf`);

	const degNum = parseInt(String(degrees), 10);
	const normalized =
		degNum === 90 ? "+90" :
		degNum === -90 ? "-90" :
		degNum === 180 ? "180" :
		degNum === -180 ? "180" :
		"+90";

	const pageSpec = (pages && String(pages).trim() && String(pages).trim().toLowerCase() !== "all")
		? `:${String(pages).trim()}`
		: "";

	const cmd = `qpdf --rotate=${normalized}${pageSpec} "${inputPath}" "${outPath}"`;
	log("Running Rotate-PDF command:", cmd);

	await execAsync(cmd);
	return outPath;
}

/**
 * Protect PDF with password using qpdf --encrypt
 * extra:
 *  - userPassword (required)
 *  - ownerPassword (optional; if omitted, uses userPassword)
 *  - keyLength: 128 or 256 (optional; default 256)
 *
 * qpdf syntax:
 *   qpdf --encrypt <user> <owner> <keylen> -- in.pdf out.pdf
 */
export async function protectPdf(inputPath, outputDir, userPassword, ownerPassword = null, keyLength = 256) {
	if (!userPassword || !String(userPassword).trim()) {
		throw new Error("Missing userPassword for pdf:protect-pdf");
	}

	const baseName = path.parse(inputPath).name;
	const outPath = path.join(outputDir, `${baseName}-protected.pdf`);

	const user = String(userPassword).replace(/"/g, '\\"');
	const owner = String(ownerPassword || userPassword).replace(/"/g, '\\"');

	const keyLen = parseInt(String(keyLength), 10);
	const safeKeyLen = keyLen === 128 ? 128 : 256;

	const cmd = `qpdf --encrypt "${user}" "${owner}" ${safeKeyLen} -- "${inputPath}" "${outPath}"`;
	log("Running Protect-PDF command:", cmd);

	await execAsync(cmd);
	return outPath;
}

export async function wordToPdf(inputPath, outputDir) {
	const baseName = path.parse(inputPath).name;
	const outPath = path.join(outputDir, `${baseName}.pdf`);

	const cmd = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
	await execAsync(cmd);
	return outPath;
}