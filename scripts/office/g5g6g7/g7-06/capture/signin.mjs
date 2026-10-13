// Web sign-in through the login form, with a failure message that says why.
// Round 1 only ever reported `page.waitForURL: Timeout 60000ms exceeded`; the
// cause (the page never hydrated, so the click was a native GET submit that
// left the browser on /login?email=...) was found by running the stack. The
// message now carries the URL reached (query VALUES hidden: a native submit
// puts the password there), the visible heading and any alert text.
import { HYDRATE_TIMEOUT_MS, SIGN_IN_TIMEOUT_MS } from "./constants.mjs";

const EMAIL_INPUT = 'input[type="email"]';

/** In-page: has React attached to the element? (React puts `__reactProps$<id>` on every DOM node it manages, so a server-rendered but never hydrated form has none.) */
export function isHydrated(selector) {
  const el = document.querySelector(selector);
  return Boolean(el) && Object.keys(el).some((key) => key.startsWith("__reactProps$"));
}

/** In-page: what the screen says. Serialised by Playwright, so it must not close over anything. */
export function readScreen() {
  const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const heading = clean(document.querySelector("h1, h2, [role='heading']")?.textContent);
  const notices = [...document.querySelectorAll('[role="alert"], [role="status"], [data-sonner-toast]')].map((el) => clean(el.textContent)).filter(Boolean).slice(0, 3);
  return { title: clean(document.title), heading, notices };
}

/** The URL with its query values hidden (`/login?email=&password=`): which fields travelled, never what they held. */
export function redactUrl(href) {
  try {
    const url = new URL(href);
    const keys = [...new Set(url.searchParams.keys())];
    return `${url.pathname}${keys.length > 0 ? `?${keys.map((key) => `${key}=…`).join("&")}` : ""}`;
  } catch {
    return "(unreadable url)";
  }
}

async function describeScreen(page) {
  let screen = { title: "", heading: "", notices: [] };
  try {
    screen = await page.evaluate(readScreen);
  } catch {
    // the page is navigating or gone; the URL alone still says something
  }
  const parts = [`url ${redactUrl(page.url())}`];
  if (screen.heading) parts.push(`heading "${screen.heading}"`);
  else if (screen.title) parts.push(`title "${screen.title}"`);
  if (screen.notices.length > 0) parts.push(`notice "${screen.notices.join(" | ")}"`);
  return parts.join(", ");
}

/**
 * Signs `seed` in through /login and resolves once the page left /login.
 * Throws one line: `<what failed>; url ..., heading "...", notice "..."`.
 */
export async function signIn(page, webOrigin, seed, { hydrateTimeoutMs = HYDRATE_TIMEOUT_MS, loginTimeoutMs = SIGN_IN_TIMEOUT_MS } = {}) {
  await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded" });
  // The inputs exist in the server-rendered HTML long before React owns them:
  // filling and clicking then is a native form submit, not a login.
  let hydrated = true;
  await page.waitForFunction(isHydrated, EMAIL_INPUT, { timeout: hydrateTimeoutMs, polling: 100 }).catch(() => {
    hydrated = false;
  });
  if (!hydrated) {
    throw new Error(
      `the login form did not hydrate within ${hydrateTimeoutMs / 1000}s (no client JS ran on the page; a next dev web served from 127.0.0.1 blocks /_next/hmr, so serve it as localhost); ${await describeScreen(page)}`,
    );
  }
  try {
    await page.getByLabel("Email").fill(seed.email);
    await page.getByLabel(/^(Mật khẩu|Password)$/).fill(seed.password);
    await page.getByRole("button", { name: /^(Đăng nhập|Log in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: loginTimeoutMs });
  } catch (error) {
    const what = String(error.message).split("\n")[0].replaceAll(seed.password, "<password>");
    throw new Error(`${what}; ${await describeScreen(page)}`);
  }
}
