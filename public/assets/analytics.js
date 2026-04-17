// /assets/analytics.js
// GhostConvert GA4 custom event tracking enhanced

(function () {
  console.log("GhostConvert Analytics loaded");

  function hasGtag() {
    return typeof window !== "undefined" && typeof window.gtag === "function";
  }

  function sendGtag(eventName, params) {
    if (!hasGtag()) {
      console.warn("gtag not ready for event:", eventName, params);
      return;
    }
    window.gtag("event", eventName, params);
  }

  function getCommonContext() {
    if (typeof window === "undefined") return {};

    const nav = window.navigator || {};
    const ua = nav.userAgent || "";
    let deviceCategory = "desktop";
    if (/Mobi|Android|iPhone|iPad/i.test(ua)) deviceCategory = "mobile";

    let timeZone = null;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (_) {}

    return {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      language: nav.language || nav.userLanguage || null,
      device_category: deviceCategory,
      screen_width: window.innerWidth || null,
      screen_height: window.innerHeight || null,
      time_zone: timeZone,
    };
  }

  function deriveToolMeta(tool) {
    if (!tool) return {};
    let toolCategory = null;
    let toolSlug = tool;

    const idx = tool.indexOf(":");
    if (idx !== -1) {
      toolCategory = tool.slice(0, idx);
      toolSlug = tool.slice(idx + 1);
    }
    return {
      tool_category: toolCategory,
      tool_slug: toolSlug,
    };
  }

  function bucketFileSize(bytes) {
    if (typeof bytes !== "number" || isNaN(bytes) || bytes <= 0) {
      return "unknown";
    }
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return "under_1MB";
    if (mb < 5) return "1_to_5MB";
    if (mb < 20) return "5_to_20MB";
    if (mb < 100) return "20_to_100MB";
    return "over_100MB";
  }

  function categorizeError(msg) {
    if (!msg) return { category: "unknown", truncated: null };

    const str = String(msg);
    const lower = str.toLowerCase();
    const truncated = str.length > 200 ? str.slice(0, 197) + "..." : str;

    let category = "other";

    if (lower.includes("timeout")) category = "timeout";
    else if (lower.includes("network")) category = "network";
    else if (lower.includes("unsupported") || lower.includes("format")) category = "unsupported_format";
    else if (lower.includes("no such file") || lower.includes("not found")) category = "file_missing";
    else if (lower.includes("permission") || lower.includes("access denied")) category = "permission";
    else if (
      lower.includes("ffmpeg") ||
      lower.includes("imagemagick") ||
      lower.includes("ghostscript") ||
      lower.includes("libreoffice") ||
      lower.includes("vtracer")
    ) {
      category = "converter_tool_error";
    }

    return { category, truncated };
  }

  function trackEvent(name, data = {}) {
    const payload = Object.assign({}, getCommonContext(), data);
    sendGtag(name, payload);
    console.log("GA4 Event:", name, payload);
  }

  trackEvent("gc_page_view", {});

  const conversionTimers = Object.create(null);

  function startTimer(key) {
    if (!key) return;
    conversionTimers[key] = Date.now();
  }

  function stopTimer(key) {
    if (!key || !conversionTimers[key]) return null;
    const ms = Date.now() - conversionTimers[key];
    delete conversionTimers[key];
    return ms;
  }

  function normalizeGuideSlug(slugOrPath) {
    if (!slugOrPath) return null;
    const s = String(slugOrPath);
    const m = s.match(/\/guides\/([^\/]+)\.html/i);
    if (m && m[1]) return m[1];
    return s.replace(/\.html$/i, "");
  }

  window.GCAnalytics = {
    fileSelected: (tool, fileName, fileSize) => {
      const meta = deriveToolMeta(tool);
      trackEvent("file_selected", {
        tool,
        ...meta,
        file_name: fileName,
        file_size: fileSize,
        file_size_bucket: bucketFileSize(fileSize),
      });
    },

    conversionStarted: (tool, jobId) => {
      const meta = deriveToolMeta(tool);
      const key = jobId || tool || "default";
      startTimer(key);

      trackEvent("conversion_started", {
        tool,
        job_id: jobId || null,
        ...meta,
      });
    },

    conversionSuccess: (tool, outputFile, jobId) => {
      const meta = deriveToolMeta(tool);
      const key = jobId || tool || "default";
      const durationMs = stopTimer(key);

      trackEvent("conversion_success", {
        tool,
        job_id: jobId || null,
        ...meta,
        output_file: outputFile,
        conversion_duration_ms: durationMs,
      });
    },

    conversionFailed: (tool, errorMessage, jobId) => {
      const meta = deriveToolMeta(tool);
      const key = jobId || tool || "default";
      const durationMs = stopTimer(key);
      const { category, truncated } = categorizeError(errorMessage);

      trackEvent("conversion_failed", {
        tool,
        job_id: jobId || null,
        ...meta,
        conversion_duration_ms: durationMs,
        error_category: category,
        error_message: truncated,
      });
    },

    toolPageView: (tool) => {
      const meta = deriveToolMeta(tool);
      trackEvent("tool_page_view", {
        tool,
        ...meta,
      });
    },

    ctaClick: (id, label) => {
      trackEvent("cta_click", {
        cta_id: id,
        cta_label: label,
      });
    },

    toolCardClick: (slug, href) => {
      trackEvent("tool_card_click", {
        tool_slug: slug,
        tool_href: href,
      });
    },

    guideLinkClick: (guideSlugOrUrl, source) => {
      const guide_slug = normalizeGuideSlug(guideSlugOrUrl);
      trackEvent("guide_link_click", {
        guide_slug,
        source: source || null,
      });
    },

    guideToToolClick: (guideSlug, toolId) => {
      const meta = deriveToolMeta(toolId);
      trackEvent("guide_to_tool_click", {
        guide_slug: normalizeGuideSlug(guideSlug),
        tool: toolId || null,
        ...meta,
      });
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    const heroPrimary = document.getElementById("hero-primary-btn");
    if (heroPrimary) {
      heroPrimary.addEventListener("click", () => {
        window.GCAnalytics.ctaClick("hero_primary", "Start with PNG to JPG");
      });
    }

    const heroSecondary = document.querySelector(".hero-btn-secondary");
    if (heroSecondary) {
      heroSecondary.addEventListener("click", () => {
        window.GCAnalytics.ctaClick("hero_browse_tools", "Browse all tools");
      });
    }

    const toolCards = document.querySelectorAll("a.tool-card");
    toolCards.forEach((el) => {
      el.addEventListener("click", () => {
        const href = el.getAttribute("href") || "";

        if (/^\/guides\/.+\.html/i.test(href)) {
          window.GCAnalytics.guideLinkClick(href, "tool_card");
          return;
        }

        const match = href.match(/\/tools\/([^\.]+)\.html/);
        const slug = match ? match[1] : href;
        window.GCAnalytics.toolCardClick(slug, href);
      });
    });

    const guideToToolLinks = document.querySelectorAll("[data-guide-to-tool]");
    if (guideToToolLinks && guideToToolLinks.length) {
      guideToToolLinks.forEach((el) => {
        el.addEventListener("click", () => {
          const guide = el.getAttribute("data-guide") || window.location.pathname;
          const tool = el.getAttribute("data-tool") || null;
          window.GCAnalytics.guideToToolClick(guide, tool);
        });
      });
    }
  });
})();