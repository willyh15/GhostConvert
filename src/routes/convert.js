// src/routes/convert.js
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Queue } from "bullmq";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, "..", "..");
const INPUT_DIR = path.join(ROOT_DIR, "tmp", "input");
const OUTPUT_DIR = path.join(ROOT_DIR, "tmp", "output");

// Ensure dirs
for (const dir of [INPUT_DIR, OUTPUT_DIR]) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(new Date().toISOString(), "- Created directory:", dir);
	}
}

const connection = {
	host: process.env.REDIS_HOST || "127.0.0.1",
	port: parseInt(process.env.REDIS_PORT || "6379", 10),
	maxRetriesPerRequest: null,
};

const conversionQueue = new Queue("file-conversions", { connection });

// Allowed tools – keep in sync with worker + frontend
const TOOL_CONFIG = {
	// IMAGE
	"image:png-to-jpg": true,
	"image:jpg-to-png": true,
	"image:heic-to-jpg": true,
	"image:compress-image": true,
	"image:webp-to-jpg": true,
	"image:gif-to-webp": true,
	"image:png-to-webp": true,
	"image:jpg-to-webp": true,
	"image:webp-to-png": true,
	"image:svg-to-png": true,
	"image:svg-to-jpg": true,
	"image:svg-to-webp": true,

	// NEW: bitmap -> SVG vectorize (logo/line-art oriented)
	"image:png-to-svg": true,
	"image:jpg-to-svg": true,

	// PDF
	"pdf:pdf-to-jpg": true,
	"pdf:compress-pdf": true,
	"pdf:jpg-to-pdf": true,
	"pdf:png-to-pdf": true,
	"pdf:merge-pdf": true,
	"pdf:split-pdf": true,
	"pdf:delete-pages": true,
	"pdf:pdf-to-word": true,
	"pdf:unlock-pdf": true,
	"pdf:rotate-pdf": true, // NEW
	"pdf:protect-pdf": true, // NEW
	"doc:word-to-pdf": true,
	"doc:excel-to-pdf": true,

	// AUDIO
	"audio:mp4-to-mp3": true,
	"audio:mp3-to-wav": true,
	"audio:wav-to-mp3": true,
	"audio:m4a-to-mp3": true,

	// VIDEO
	"video:gif-to-mp4": true,
	"video:mov-to-mp4": true,

	// ARCHIVE
	"archive:zip-extract": true,
};

// Multer
const storage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, INPUT_DIR),
	filename: (_req, file, cb) => {
		const ext = path.extname(file.originalname) || "";
		cb(null, `${uuidv4()}${ext.toLowerCase()}`);
	},
});

const upload = multer({ storage });
const router = Router();

/**
 * POST /api/convert
 */
router.post("/convert", upload.any(), async (req, res) => {
	try {
		const { tool, extraPayload } = req.body;
		const files = req.files || [];

		if (!tool || !TOOL_CONFIG[tool]) {
			return res.status(400).json({ error: "Unknown or missing tool" });
		}
		if (!files.length) {
			return res.status(400).json({ error: "No file uploaded" });
		}

		// Tools that accept multiple files
		const MULTI_FILE_TOOLS = new Set([
			"pdf:jpg-to-pdf",
			"pdf:merge-pdf",
			"pdf:png-to-pdf",
		]);

		let job;
		if (MULTI_FILE_TOOLS.has(tool)) {
			const inputFilenames = files.map((f) => f.filename);
			job = await conversionQueue.add("convert", {
				tool,
				inputFilenames,
				extraPayload: extraPayload || null,
			});
		} else {
			const file = files[0];
			job = await conversionQueue.add("convert", {
				tool,
				inputFilename: file.filename,
				extraPayload: extraPayload || null,
			});
		}

		return res.json({ jobId: job.id });
	} catch (err) {
		console.error("Error in /api/convert", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

/**
 * GET /api/status/:id
 */
router.get("/status/:id", async (req, res) => {
	try {
		const job = await conversionQueue.getJob(req.params.id);
		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		const state = await job.getState();

		if (state === "completed") {
			const result = job.returnvalue;
			if (!result || !result.outputFilename) {
				return res.status(500).json({ error: "Missing output" });
			}

			const downloadUrl = `/api/download/${encodeURIComponent(result.outputFilename)}`;

			return res.json({
				status: "completed",
				downloadUrl,
			});
		}

		if (state === "failed") {
			return res.json({ status: "failed" });
		}

		return res.json({ status: "processing" });
	} catch (err) {
		console.error("Error in /api/status", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

/**
 * GET /api/download/:filename
 */
router.get("/download/:filename", async (req, res) => {
	try {
		const filename = req.params.filename;
		const fullPath = path.join(OUTPUT_DIR, filename);

		if (!fs.existsSync(fullPath)) {
			return res.status(404).send("File not found");
		}

		return res.download(fullPath, filename);
	} catch (err) {
		console.error("Error in /api/download", err);
		return res.status(500).send("Internal server error");
	}
});

export default router;
export { router as convertRouter };