// Fixed inputs of the G7-06 capture provider (contract section 3). Kept in one
// place so a shot's determinism settings are never spread over the two hosts.

/** Exit codes: the harness-wide convention (0 PASS, 1 FAIL, 77 BLOCKED). */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_BLOCKED = 77;

export const HOSTS = ["desktop", "web"];

export const VIEWPORT = { w: 1440, h: 900 };
export const DEVICE_SCALE_FACTOR = 1;
export const LOCALE = "vi-VN";
export const TIMEZONE = "Asia/Ho_Chi_Minh";
export const COLOR_SCHEME = "light";

/** The fixture format -> the genoffice module that opens it (OfficeModule ids of packages/core/office). */
export const MODULE_OF_FORMAT = {
  docx: "docs",
  xlsx: "sheets",
  pptx: "slides",
  pdf: "pdf",
  md: "markdown",
  html: "html",
};

/** Settle: poll interval, how many identical consecutive frames end it, and the budget. */
export const SETTLE = { intervalMs: 300, identicalFrames: 2, timeoutMs: 45_000 };

/** How long a module takes to show up (a tab/WebContentsView on desktop, the frame's ready state on web). */
export const OPEN_TIMEOUT_MS = 90_000;

/** Text under this many visible characters is the job's `no_rendered_text`; the provider reports it but still writes the file. */
export const MIN_VISIBLE_CHARS = 20;
