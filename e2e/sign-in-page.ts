import { expect, type Page } from "@playwright/test";
import { auditText, settle } from "./contrast";

/**
 * The sign-in screens' specs (ADR 0049, spec 2026-10-27 §4.6): the answers
 * they need from a server that cannot give them, and the measurements they
 * share.
 *
 * No CI deployment holds Google or Apple credentials, so /auth/providers
 * offers neither and no provider sign-in can leave a pending ticket behind.
 * Each stub still lets the request reach the server and keeps its response
 * (status line, CORS headers), replacing only the JSON, as
 * landing-office-stubs.ts does for /config: the web app calls the API on
 * another origin with credentials, and a hand-made response would fail CORS.
 * Stub before the first navigation.
 */

/** GET /auth/providers as a deployment with the web's Google and Apple turned on (spec §3.8). */
const BOTH_PROVIDERS = { google: true, apple: false, apple_web: true, google_native: false };

/**
 * Offers Google and Apple on the web. `hold` keeps the answer back until it
 * settles, so a spec can look at the page while the providers are in flight.
 */
export async function offerProviders(page: Page, hold?: Promise<void>): Promise<void> {
  await page.route(/\/api\/v1\/auth\/providers(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response, json: BOTH_PROVIDERS });
  });
}

/** What GET /auth/sign-in-ticket answers for a pending provider sign-in (SignInTicketSDO). */
export interface PendingSignIn {
  provider: "google" | "apple";
  kind: "unmatched" | "link_required";
  email: string;
  name: string;
  private_relay: boolean;
}

/**
 * The browser holds a pending sign-in: the HttpOnly ticket cookie the choice
 * screen only asks the server about. Only the read is stubbed; a command the
 * screen sends still meets the real server, which finds no ticket. Without
 * this stub the server's answer is 404 sign_in_ticket_missing: the expired
 * screen.
 */
export async function pendingSignIn(page: Page, ticket: PendingSignIn): Promise<void> {
  await page.route(/\/api\/v1\/auth\/sign-in-ticket(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, status: 200, json: ticket });
  });
}

/** The app's colour mode, as the theme switch sets it. Navigation resets it. */
export async function setMode(page: Page, mode: "light" | "dark"): Promise<void> {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

/**
 * The column has come to rest where it rises in (AuthShell's Rise). The
 * server draws it 40px low and see-through, and motion starts it only once
 * the page hydrates, so until then no animation runs and settle() alone
 * returns at once: a position measured then is where the card starts, not
 * where it stays.
 */
export async function risen(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator("main").evaluate((main) =>
        [...main.querySelectorAll<HTMLElement>("[style]")].every((el) => {
          const style = getComputedStyle(el);
          return style.transform === "none" && style.opacity === "1";
        }),
      ),
    )
    .toBe(true);
  await settle(page);
}

/** Every text node on the page clears WCAG AA against what is painted under it (contrast.ts). */
export async function expectReadable(page: Page, what: string): Promise<void> {
  const audit = await auditText(page);
  expect(audit.colorLevel4, "the canvas does not take CSS Color 4: the measurement would be silently wrong").toBe(true);
  expect(audit.checked, `${what}: no text node measured, the selector slipped`).toBeGreaterThan(3);
  expect(audit.fails, `${what}: ${audit.fails.join(" | ")}`).toEqual([]);
}

/**
 * How far the page scrolls sideways, in px; 0 when nothing does. The auth
 * column is its own scroller (`main`, overflow-y-auto, which scrolls in x
 * too), so a too-wide child shows there and not on the document.
 */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main");
    return Math.max(doc.scrollWidth - doc.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });
}
