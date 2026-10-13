// Fixed inputs of the G7-06 capture provider (contract section 3). Kept in one
// place so a shot's determinism settings are never spread over the two hosts.

/** Exit codes: the harness-wide convention (0 PASS, 1 FAIL, 77 BLOCKED). */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_BLOCKED = 77;

export const HOSTS = ["desktop", "web"];

/**
 * The page/window viewport per host (contract Amendment 4). Web is wider so the
 * module frame region (about 1456x868 inside the shell) is as wide as the
 * desktop module view (about 1440x860): at 1440x900 the web frame was 1176 px
 * wide and cut the xlsx sheet's column G.
 */
export const VIEWPORTS = { desktop: { w: 1440, h: 900 }, web: { w: 1720, h: 980 } };

/** A web module frame narrower than this fails the fixture as `frame_too_small` (the shell's chrome ate the width). */
export const MIN_FRAME_WIDTH = 1400;
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

/**
 * Settle: poll interval, how many identical consecutive frames end it, how long
 * they must have been identical (the sheets view repaints its status bar when a
 * streaming load finishes seconds after the grid first looks complete), and the
 * budget: 45 s by default, 90 s once a module status reports a streaming load
 * (the desktop xlsx still read "Đang tải theo luồng ...: 9 hàng khả dụng." after 45 s in cloud
 * round 2). Still loading after the budget is a failed fixture, never a mask.
 */
export const STREAMING_TIMEOUT_MS = 90_000;
export const SETTLE = { intervalMs: 300, identicalFrames: 2, quietMs: 2_500, timeoutMs: 45_000, streamingTimeoutMs: STREAMING_TIMEOUT_MS };

/** How long a module takes to show up (a tab/WebContentsView on desktop, the frame's ready state on web). */
export const OPEN_TIMEOUT_MS = 90_000;

/** Text under this many visible characters is the job's `no_rendered_text`; the provider reports it but still writes the file. */
export const MIN_VISIBLE_CHARS = 20;

/** How long the login form has to hydrate (a cold `next dev` compiles /login on first hit), and how long the sign-in may take after the click. */
export const HYDRATE_TIMEOUT_MS = 45_000;
export const SIGN_IN_TIMEOUT_MS = 60_000;
