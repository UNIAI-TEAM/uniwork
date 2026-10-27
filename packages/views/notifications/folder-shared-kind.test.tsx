import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Notification, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav } from "../test/api-mock";
import { NotificationRow } from "./notification-row";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

// UNI-2244: a folder bulk share sends ONE grouped document_shared row per recipient and level;
// resource_id is the folder id and params.count is the number of documents whose access rose.

const i18n = initI18n();
const { t } = i18n;

const workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;

const folderShare = (params: Record<string, string> = {}): Notification => ({
  id: "n-folder-1",
  kind: "document_shared",
  workspace_id: "ws1",
  organization_id: "o1",
  resource_type: "document",
  resource_id: "fld1",
  resource_deleted: false,
  resource_access_lost: false,
  comment_deleted: false,
  actor_kind: "human",
  actor_id: "u2",
  title_key: "notifications.kind.document_shared",
  params: { actor: "An", document: "Hợp đồng", document_id: "fld1", level: "edit", batch_id: "b1", count: "12", ...params },
  count: 1,
  created_at: "2026-10-17T10:00:00Z",
});

const sentence = (n: Notification) => {
  const { container, unmount } = render(<NotificationTitle notification={n} unread={false} />);
  const text = container.textContent ?? "";
  unmount();
  return text;
};

beforeEach(async () => {
  await setLocale("vi");
});

afterEach(async () => {
  cleanup();
  await setLocale("vi");
});

describe("UNI-2244 grouped folder document_shared notification", () => {
  it("reads singular for one document and plural for many in en", async () => {
    await setLocale("en");
    const level = t("documents.share.level_edit");
    expect(sentence(folderShare({ count: "1" }))).toBe(`An shared 1 document in folder "Hợp đồng" with you (${level}).`);
    expect(sentence(folderShare({ count: "12" }))).toBe(`An shared 12 documents in folder "Hợp đồng" with you (${level}).`);
  });

  it("reads the same sentence for one and many in vi", async () => {
    const level = t("documents.share.level_edit");
    const expected = (count: number) => `An đã chia sẻ ${count} tài liệu trong thư mục "Hợp đồng" với bạn. Quyền: ${level}.`;
    expect(sentence(folderShare({ count: "1" }))).toBe(expected(1));
    expect(sentence(folderShare({ count: "12" }))).toBe(expected(12));
  });

  it("drops the level clause when the level is missing or unknown", async () => {
    for (const level of [undefined, "", "super_edit"]) {
      const params: Record<string, string> = level === undefined ? { level: "" } : { level };
      const n = folderShare({ ...params, count: "3" });
      expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared_folder_nolevel");
      await setLocale("vi");
      expect(sentence(n)).toBe('An đã chia sẻ 3 tài liệu trong thư mục "Hợp đồng" với bạn.');
      await setLocale("en");
      expect(sentence(n)).toBe('An shared 3 documents in folder "Hợp đồng" with you.');
      expect(sentence(folderShare({ ...params, count: "1" }))).toBe('An shared 1 document in folder "Hợp đồng" with you.');
    }
  });

  it("names no folder when the title is missing or blank", async () => {
    const level = t("documents.share.level_view");
    for (const document of ["", "   "]) {
      const n = folderShare({ document, level: "view", count: "12" });
      expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared_folder_untitled");
      await setLocale("vi");
      expect(sentence(n)).toBe(`An đã chia sẻ 12 tài liệu trong một thư mục với bạn. Quyền: ${level}.`);
      await setLocale("en");
      const enLevel = t("documents.share.level_view");
      expect(sentence(n)).toBe(`An shared 12 documents in a folder with you (${enLevel}).`);
      expect(sentence(folderShare({ document, level: "view", count: "1" }))).toBe(`An shared 1 document in a folder with you (${enLevel}).`);
    }
  });

  it("combines the title-less and level-less variants", async () => {
    const n = folderShare({ document: " ", level: "nope", count: "5" });
    expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared_folder_untitled_nolevel");
    await setLocale("vi");
    expect(sentence(n)).toBe("An đã chia sẻ 5 tài liệu trong một thư mục với bạn.");
    await setLocale("en");
    expect(sentence(n)).toBe("An shared 5 documents in a folder with you.");
    expect(sentence(folderShare({ document: " ", level: "nope", count: "1" }))).toBe("An shared 1 document in a folder with you.");
  });

  it.each(["0", "abc", "", "-2", "1.5", "NaN", "12abc"])("falls back to the single-document sentence for count %j", async (count) => {
    const n = folderShare({ count });
    expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared");
    const level = t("documents.share.level_edit");
    await setLocale("vi");
    expect(sentence(n)).toBe(`An đã chia sẻ tài liệu "Hợp đồng" với bạn. Quyền: ${level}.`);
    await setLocale("en");
    const text = sentence(n);
    expect(text).toBe(`An shared "Hợp đồng" with you (${t("documents.share.level_edit")}).`);
    expect(text).not.toMatch(/NaN|\b0 documents|\{\{|notifications\.kind/);
  });

  it("keeps a plain single-document share (no count) on the single sentence", () => {
    const { count: _omit, ...params } = folderShare().params;
    const n = { ...folderShare(), params };
    expect(notificationTitleKey(n)).toBe("notifications.kind.document_shared");
  });

  it("opens the folder: the row links to the folder id, which the document page hands to the folder view", () => {
    const n = folderShare();
    const href = resourceHref(n, workspace, [workspace]);
    expect(href).toBe("/acme/team/documents/fld1");
    render(
      wrapWithNav(
        <WorkspaceProvider
          workspace={workspace}
          user={{
            id: "u1",
            email: "a@b.c",
            display_name: "Người nhận",
            onboarded_at: "2026-08-25T00:00:00Z",
            email_verified_at: "2026-08-25T00:00:00Z",
            onboarding_questionnaire: {},
            locale: "vi",
          }}
        >
          <ul>
            <NotificationRow notification={n} href={href} onOpen={() => {}} />
          </ul>
        </WorkspaceProvider>,
      ),
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/acme/team/documents/fld1");
    expect(link).toHaveTextContent(`An đã chia sẻ 12 tài liệu trong thư mục "Hợp đồng" với bạn. Quyền: ${t("documents.share.level_edit")}.`);
  });
});
