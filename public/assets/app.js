// public/assets/app.js

/**
 * Generic tool handler for file upload + conversion + polling
 */
async function handleToolPage(config) {
  const fileInput = document.querySelector("#file-input");
  const uploadArea = document.querySelector("#upload-area");
  const fileNameEl = document.querySelector("#file-name");
  const convertBtn = document.querySelector("#convert-btn");
  const statusText = document.querySelector("#status-text");
  const progressBar = document.querySelector("#progress-bar");

  // NEW: optional preset selector (used by PNG→SVG + JPG→SVG pages)
  const presetSelect = document.querySelector("#preset-select");

  // Optional extra payload field (e.g. pages to delete)
  const extraInput =
    config && config.extraPayloadFieldId
      ? document.querySelector(`#${config.extraPayloadFieldId}`)
      : null;

  // Multi-file tools
  const MULTI_FILE_TOOLS = new Set([
    "pdf:jpg-to-pdf",
    "pdf:merge-pdf",
    "pdf:png-to-pdf" // <-- allow PNG→PDF to select multiple files
  ]);
  const isMultiFileTool = MULTI_FILE_TOOLS.has(config.tool);

  if (fileInput && isMultiFileTool) {
    fileInput.multiple = true;
  }

  let selectedFiles = [];
  let isConverting = false;
  const apiBase = "/api";

  // ---- GA4 analytics helpers (safe if GCAnalytics not loaded) ----
  const analytics = window.GCAnalytics || null;

  // per-tool page view event
  if (analytics && typeof analytics.toolPageView === "function" && config && config.tool) {
    try {
      analytics.toolPageView(config.tool);
    } catch (e) {
      console.warn("toolPageView analytics error:", e);
    }
  }

  function trackFileSelected(file) {
    if (analytics && analytics.fileSelected) {
      analytics.fileSelected(config.tool, file.name, file.size);
    }
  }

  function trackConversionStarted() {
    if (analytics && analytics.conversionStarted) {
      analytics.conversionStarted(config.tool);
    }
  }

  function trackConversionSuccess(outputRef) {
    if (analytics && analytics.conversionSuccess) {
      analytics.conversionSuccess(config.tool, outputRef);
    }
  }

  function trackConversionFailed(message) {
    if (analytics && analytics.conversionFailed) {
      analytics.conversionFailed(config.tool, message);
    }
  }
  // ----------------------------------------------------------------

  function setStatus(text, type = "info") {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.classList.remove("success", "error");
    if (type === "success") statusText.classList.add("success");
    if (type === "error") statusText.classList.add("error");
  }

  function setProgress(value) {
    if (!progressBar) return;
    progressBar.style.width = `${value}%`;
  }

  function showFileNames(files) {
    if (!fileNameEl) return;
    if (!files || !files.length) {
      fileNameEl.textContent = "";
      return;
    }

    if (isMultiFileTool && files.length > 1) {
      fileNameEl.textContent = `${files.length} files selected (first: ${files[0].name})`;
    } else {
      fileNameEl.textContent = files[0].name;
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const dtFiles = e.dataTransfer.files;
    if (!dtFiles || !dtFiles.length) return;

    if (isMultiFileTool) {
      selectedFiles = Array.from(dtFiles);
    } else {
      selectedFiles = [dtFiles[0]];
    }

    showFileNames(selectedFiles);
    setStatus("File(s) ready. Click Convert to start.");

    if (selectedFiles[0]) {
      trackFileSelected(selectedFiles[0]);
    }
  }

  uploadArea?.addEventListener("click", () => fileInput?.click());
  uploadArea?.addEventListener("dragover", (e) => e.preventDefault());
  uploadArea?.addEventListener("drop", handleDrop);

  fileInput?.addEventListener("change", () => {
    if (!fileInput.files || !fileInput.files.length) {
      selectedFiles = [];
      showFileNames([]);
      return;
    }

    if (isMultiFileTool) {
      selectedFiles = Array.from(fileInput.files);
    } else {
      selectedFiles = [fileInput.files[0]];
    }

    showFileNames(selectedFiles);
    setStatus("File(s) ready. Click Convert to start.");

    if (selectedFiles[0]) {
      trackFileSelected(selectedFiles[0]);
    }
  });

  // timing + job tracking for richer analytics (non-breaking)
  let conversionStartTime = null;
  let currentJobId = null;

  convertBtn?.addEventListener("click", async () => {
    if (isConverting) return;
    if (!selectedFiles.length) {
      setStatus("Please select a file first.", "error");
      return;
    }

    try {
      isConverting = true;
      setStatus("Uploading file(s)...");
      setProgress(10);

      // record start time before starting conversion
      conversionStartTime =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      trackConversionStarted();

      const formData = new FormData();

      if (isMultiFileTool) {
        for (const f of selectedFiles) {
          formData.append("file", f);
        }
      } else {
        formData.append("file", selectedFiles[0]);
      }

      formData.append("tool", config.tool);

      // NEW: build one extraPayload object that can support multiple tools
      const extra = {};

      // existing: pagesToDelete (pdf:delete-pages etc.)
      if (extraInput) {
        const raw = (extraInput.value || "").trim();
        if (raw) {
          extra.pagesToDelete = raw;
        }
      }

      // NEW: SVG vectorize preset (image:png-to-svg, image:jpg-to-svg)
      if (presetSelect) {
        const preset = (presetSelect.value || "").trim();
        if (preset) {
          extra.preset = preset; // "logo" | "poster" | "photo"
        }
      }

      if (Object.keys(extra).length) {
        formData.append("extraPayload", JSON.stringify(extra));
      }

      // Explicit URL + debug log
      const convertUrl = `${apiBase}/convert`;
      console.log("Posting to:", convertUrl, "tool:", config.tool);

      const res = await fetch(convertUrl, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error || "Upload failed";
        trackConversionFailed(msg);

        // optional enhanced failure analytics
        if (analytics && typeof analytics.conversionFailedDetailed === "function") {
          try {
            analytics.conversionFailedDetailed(config.tool, {
              message: msg,
              job_id: null,
            });
          } catch (e) {
            console.warn("conversionFailedDetailed error:", e);
          }
        }

        throw new Error(msg);
      }

      const { jobId } = await res.json();
      currentJobId = jobId;
      setStatus("Processing file(s)...");
      setProgress(40);

      // Poll status
      let attempts = 0;
      const maxAttempts = 60;

      const poll = async () => {
        attempts++;

        const statusUrl = `${apiBase}/status/${jobId}`;
        console.log("Polling status at:", statusUrl);

        const r = await fetch(statusUrl);
        if (!r.ok) {
          const failMsg = "Status check failed";
          trackConversionFailed(failMsg);

          if (analytics && typeof analytics.conversionFailedDetailed === "function") {
            try {
              analytics.conversionFailedDetailed(config.tool, {
                message: failMsg,
                job_id: currentJobId,
              });
            } catch (e) {
              console.warn("conversionFailedDetailed error:", e);
            }
          }

          throw new Error(failMsg);
        }

        const data = await r.json();
        if (data.status === "completed" && data.downloadUrl) {
          setStatus("Done! Download ready.", "success");
          setProgress(100);
          trackConversionSuccess(data.downloadUrl);

          if (analytics && typeof analytics.conversionSuccessDetailed === "function") {
            try {
              const endTime =
                typeof performance !== "undefined" && performance.now
                  ? performance.now()
                  : Date.now();
              const durationMs =
                conversionStartTime != null ? endTime - conversionStartTime : null;

              let totalSizeBytes = 0;
              try {
                for (const f of selectedFiles) {
                  totalSizeBytes += f.size || 0;
                }
              } catch (_) {}

              analytics.conversionSuccessDetailed(config.tool, {
                download_url: data.downloadUrl,
                job_id: currentJobId,
                duration_ms: durationMs,
                file_count: selectedFiles.length,
                total_size_bytes: totalSizeBytes,
              });
            } catch (e) {
              console.warn("conversionSuccessDetailed error:", e);
            }
          }

          if (config && typeof config.onSuccess === "function") {
            try {
              config.onSuccess(data.downloadUrl);
            } catch (hookErr) {
              console.warn("onSuccess hook error:", hookErr);
            }
          }

          // Default behavior (auto open + redirect) unless specifically disabled
          if (!config || !config.preventAutoRedirect) {
            try {
              if (config.tool && config.tool.startsWith("pdf:")) {
                window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
              }
            } catch (openErr) {
              console.warn("PDF auto-open failed:", openErr);
            }

            window.location.href = data.downloadUrl;
          }

          isConverting = false;
          return;
        }

        if (data.status === "failed") {
          const msg = data.error || "Conversion failed";
          trackConversionFailed(msg);

          if (analytics && typeof analytics.conversionFailedDetailed === "function") {
            try {
              analytics.conversionFailedDetailed(config.tool, {
                message: msg,
                job_id: currentJobId,
              });
            } catch (e) {
              console.warn("conversionFailedDetailed error:", e);
            }
          }

          throw new Error(msg);
        }

        if (attempts >= maxAttempts) {
          const msg = "Timed out waiting for conversion";
          trackConversionFailed(msg);

          if (analytics && typeof analytics.conversionFailedDetailed === "function") {
            try {
              analytics.conversionFailedDetailed(config.tool, {
                message: msg,
                job_id: currentJobId,
              });
            } catch (e) {
              console.warn("conversionFailedDetailed error:", e);
            }
          }

          throw new Error(msg);
        }

        const prog = 40 + Math.min(50, attempts * 2);
        setProgress(prog);

        setTimeout(poll, 2000);
      };

      await poll();
    } catch (err) {
      console.error(err);
      const msg = err.message || "Something went wrong";
      setStatus(msg, "error");
      setProgress(0);
      trackConversionFailed(msg);

      if (analytics && typeof analytics.conversionFailedDetailed === "function") {
        try {
          analytics.conversionFailedDetailed(config.tool, {
            message: msg,
            job_id: currentJobId,
          });
        } catch (e) {
          console.warn("conversionFailedDetailed error:", e);
        }
      }

      isConverting = false;
    }
  });

  // Initial status text
  setStatus(
    isMultiFileTool
      ? "Select or drop one or more files to get started."
      : "Select or drop a file to get started."
  );
}

/**
 * Home page hero button
 */
document.addEventListener("DOMContentLoaded", () => {
  const heroPrimary = document.querySelector("#hero-primary-btn");
  if (heroPrimary) {
    heroPrimary.addEventListener("click", () => {
      window.location.href = "/tools/png-to-jpg.html";
    });
  }

  // Silence benign asset errors
  window.addEventListener(
    "error",
    (e) => {
      if (
        e.target.tagName === "IMG" ||
        e.target.tagName === "LINK" ||
        e.target.tagName === "VIDEO"
      ) {
        e.stopImmediatePropagation();
      }
    },
    true
  );
});