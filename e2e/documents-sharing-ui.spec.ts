import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { createPageWithText, documentAction, onboardDocumentsUser, shooter } from "./documents-onboard";
import { pickCandidate, submitShare, who } from "./documents-share-fixtures";
import { workspaceSeed } from "./onboard";

/**
 * Lane g1-08 (UNI-682) AC-3: sharing on the real stack, from the UI (the API-level
 * sharing spec of G1-09 is documents-sharing.spec.ts). The org admin turns
 * public links on in the documents settings tab, grants and revokes an
 * organization share, mints a public link whose URL is shown once, and an
 * anonymous second session reads the page through it; the access log records
 * the link view, and after the revoke the same URL answers the dead-link state.
 *
 * Needs: documents flag ON (`FF_DOCUMENTS=true`), Postgres + Redis up, this
 * worktree's migrations applied, web app on E2E_BASE_URL. Recipe:
 * reports/g1-08-versions-share-ui/serve.sh in the run folder.
 */
test.describe.configure({ timeout: 360_000 });

const seed = workspaceSeed("sharing", "links", Date.now());
const shot = shooter(
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-sharing-ui-shots"),
);

function shareDialog(page: Page) {
  // SH-S1 names the dialog after the document ("Chia sẻ “<title>”"); untitled ones keep the generic title.
  return page.getByRole("dialog", { name: /^(Chia sẻ tài liệu|Chia sẻ “|Share document|Share “)/ });
}

test("share, public link, anonymous read, access log and revoke", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardDocumentsUser(page, seed);
  const docUrl = await createPageWithText(page, seed, "Nội dung công khai của trang");

  // Org settings: public links start closed; the admin opens them.
  await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/settings?tab=documents`);
  const toggle = page.getByRole("switch", { name: "Liên kết công khai" });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).not.toBeChecked();
  await shot(page, "documents-settings-light-vi");
  await toggle.click();
  await expect(toggle).toBeChecked({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("switch", { name: "Liên kết công khai" })).toBeChecked({ timeout: 60_000 });

  // Organization share: granted, listed, revoked.
  await page.goto(docUrl);
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Chia sẻ");
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Người và nhóm có quyền")).toBeVisible({ timeout: 30_000 });
  // The SHARING candidate picker (UNI-1784): pick the organization, then share. A grant the
  // server warns about reads back its reach first (share-add-confirm); accept it.
  await pickCandidate(dialog, seed.orgName, who(seed.orgName));
  await submitShare(dialog).click();
  const revokeOrg = dialog.getByRole("button", { name: `Thu hồi ${seed.orgName}` });
  const confirmOrg = dialog.getByTestId("share-add-confirm");
  await expect(revokeOrg.or(confirmOrg)).toBeVisible({ timeout: 30_000 });
  if (await confirmOrg.isVisible()) await confirmOrg.getByRole("button", { name: "Xác nhận" }).click();
  await expect(revokeOrg).toBeVisible({ timeout: 30_000 });

  // Public link: the raw URL is shown once.
  await dialog.getByRole("button", { name: "Tạo liên kết mới" }).click();
  const created = dialog.getByTestId("share-created-url");
  await expect(created).toBeVisible({ timeout: 30_000 });
  const linkUrl = (await created.textContent())?.trim() ?? "";
  expect(linkUrl).toMatch(/\/share\/[^/\s]+$/);
  const linkPath = new URL(linkUrl, "http://placeholder").pathname;
  await expect(dialog.getByText(/URL chỉ hiển thị lần này/)).toBeVisible();
  await shot(page, "share-dialog-light-vi");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(400); // let transition-colors settle before the shot
  await shot(page, "share-dialog-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // A revoke whose dry run has something to say is confirmed in the row (share-access-confirm).
  await revokeOrg.click();
  const confirmRevoke = dialog.getByTestId("share-access-confirm");
  await expect
    .poll(async () => (await confirmRevoke.isVisible()) || (await revokeOrg.count()) === 0, { timeout: 30_000 })
    .toBe(true);
  if (await confirmRevoke.isVisible()) await confirmRevoke.getByRole("button", { name: "Xác nhận" }).click();
  await expect(revokeOrg).toHaveCount(0, { timeout: 30_000 });
  // The owner row survives the revoke: the badge reads "Chủ sở hữu" and, for the owner, carries the transfer button.
  await expect(dialog.getByText("Chủ sở hữu", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Chuyển quyền sở hữu" })).toBeVisible();

  // Anonymous second session: no app session, only the token.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(linkPath);
  await expect(visitor.getByText("Nội dung công khai của trang")).toBeVisible({ timeout: 60_000 });
  await expect(visitor.getByText("Chia sẻ qua liên kết công khai")).toBeVisible();
  await shot(visitor, "public-page-light-vi");
  await visitor.setViewportSize({ width: 390, height: 844 });
  await shot(visitor, "public-page-mobile-vi");

  // Reopening the dialog never shows the raw URL again.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await documentAction(page, "Chia sẻ");
  await expect(dialog.getByText("Liên kết công khai", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("share-created-url")).toHaveCount(0);

  // TEMP-DIAG (UNI-1914): remove before the final commit.
  page.on("request", (r) => {
    if (r.method() === "DELETE") console.log(`DIAG request ${r.method()} ${r.url()}`);
  });
  await page.evaluate(() => {
    const w = window as unknown as { __diag: string[] };
    w.__diag = [];
    const d = (s: string) => w.__diag.push(`${Math.round(performance.now())} ${s}`);
    const desc = (n: Element | null) =>
      n ? `${n.tagName}${n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : ""}.${(n.getAttribute("data-slot") ?? "")}` : "null";
    for (const phase of [true, false]) {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        document.addEventListener(
          type,
          (e) => {
            const me = e as MouseEvent;
            const btn = document.querySelector('[role="dialog"] section[aria-labelledby="share-links-title"] ul button');
            const top = document.elementFromPoint(me.clientX, me.clientY);
            const dialogs = document.querySelectorAll('[role="dialog"]').length;
            const path = e.composedPath().slice(0, 4).map((n) => desc(n as Element)).join(" > ");
            if (type === "pointerdown") (btn as HTMLElement | null)?.setAttribute("data-diag-id", String(performance.now()));
            const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
            const dr = dlg?.getBoundingClientRect();
            const br = btn?.getBoundingClientRect();
            const anims = dlg?.getAnimations().map((a) => `${(a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName}:${a.playState}`).join(",");
            d(
              `rect dlg=${dr?.top.toFixed(1)}..${dr?.bottom.toFixed(1)} h=${dr?.height.toFixed(1)} scrollTop=${dlg?.scrollTop} scrollH=${dlg?.scrollHeight} btn=${br?.top.toFixed(1)}..${br?.bottom.toFixed(1)} anims=[${anims}] tf=${dlg ? getComputedStyle(dlg).transform : ""}`,
            );
            d(
              `${phase ? "cap" : "bub"} ${type} xy=${me.clientX},${me.clientY} target=${desc(e.target as Element)} top=${desc(top)} btnConnected=${btn?.isConnected} btnDisabled=${(btn as HTMLButtonElement | null)?.disabled} btnId=${btn?.getAttribute("data-diag-id")} dialogs=${dialogs} prevented=${e.defaultPrevented} path=${path}`,
            );
          },
          phase,
        );
      }
    }
    let frames = 0;
    let last = "";
    const sample = () => {
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const btn = document.querySelector('[role="dialog"] section[aria-labelledby="share-links-title"] ul button');
      const dr = dlg?.getBoundingClientRect();
      const br = btn?.getBoundingClientRect();
      const kids = Array.from(dlg?.children ?? []).map((c) => `${c.tagName}:${Math.round(c.getBoundingClientRect().height)}:${(c.textContent ?? "").slice(0, 24)}`);
      const inner = Array.from(dlg?.querySelector(":scope > div.flex-col")?.children ?? []).map((c) => `${c.tagName}:${Math.round(c.getBoundingClientRect().height)}:${(c.textContent ?? "").slice(0, 24).replace(/\s+/g, " ")}`);
      const cur = `kids=${kids.join("|")} inner=${inner.join("|")} raf dlg=${dr?.top.toFixed(1)}..${dr?.bottom.toFixed(1)} scrollTop=${dlg?.scrollTop} scrollH=${dlg?.scrollHeight} btn=${br?.top.toFixed(1)}..${br?.bottom.toFixed(1)}`;
      if (frames++ < 600 && cur !== last) d(cur);
      last = cur;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of Array.from(m.removedNodes)) {
          if (n instanceof Element && (n.matches("button") || n.querySelector("ul button") || n.matches('[role="dialog"]'))) {
            d(`removed ${desc(n)} children=${n.childElementCount}`);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const diagBtn = dialog.getByRole("region", { name: "Liên kết công khai" }).getByRole("button", { name: /^Thu hồi/ });
  console.log(`DIAG box ${JSON.stringify(await diagBtn.boundingBox())} dialogBox ${JSON.stringify(await dialog.boundingBox())}`);
  // Revoke the link; the anonymous reader gets the dead-link state.
  await diagBtn.click();
  await page.waitForTimeout(2000);
  console.log(`DIAG log\n${(await page.evaluate(() => (window as unknown as { __diag: string[] }).__diag)).join("\n")}`);
  await expect(dialog.getByText("Chưa có liên kết nào.")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: "Liên kết không còn hiệu lực" })).toBeVisible({
    timeout: 60_000,
  });
  await shot(visitor, "public-page-revoked-mobile-vi");
  await anon.close();

  // Access log: the anonymous link view is recorded.
  await documentAction(page, "Nhật ký truy cập");
  const log = page.getByRole("dialog", { name: /Nhật ký truy cập/ });
  await expect(log.getByText("Mở qua liên kết").first()).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText("Ẩn danh").first()).toBeVisible();
  await shot(page, "access-log-light-vi");
  await page.keyboard.press("Escape");

  // English copy of the share dialog.
  await page.getByRole("button", { name: "Ngôn ngữ" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Share");
  await expect(shareDialog(page).getByText("Public links", { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, "share-dialog-light-en");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await page.reload();

  // Mobile share dialog.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await documentAction(page, "Chia sẻ");
  await expect(shareDialog(page).getByText("Người và nhóm có quyền")).toBeVisible({ timeout: 30_000 });
  await shot(page, "share-dialog-mobile-vi");
});
