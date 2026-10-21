import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { configureShortcutPlatform, type ShortcutPlatform } from "@uniwork/core/shortcuts";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import type { User, Workspace } from "@uniwork/core/types";
import { AskUniButton } from "../ai/ask-uni-button";
import {
  EmailHubThreadToolbar,
  type EmailHubThreadActions,
} from "../email-hub/email-hub-thread-toolbar";
import { SearchTrigger } from "../search/search-trigger";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "./workspace-context";

initI18n();

// An accessible name is the plain command name. The chord belongs in
// aria-keyshortcuts (ARIA syntax), so a screen reader announces it once.
const CHORD_IN_NAME = /⌘|⌃|⌥|⇧|\b(?:Ctrl|Control|Cmd|Meta|Alt|Shift)\b|\([^()]{1,12}\)/i;

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const thread: EmailHubThread = {
  id: "t1", account_id: "acc1", folder: "INBOX", subject: "Hello", snippet: "", from_addr: "a@example.com",
  to_addrs: [], sent_at: "2026-09-24T09:00:00Z", is_read: true, is_starred: false, has_attachments: false,
  body_cached: true, imap_labels: [],
};
const actions = new Proxy({}, { get: () => vi.fn() }) as EmailHubThreadActions;
const pending = { star: false, move: false, markRead: false, snooze: false, download: false };

function mountAskUni() {
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/api/v1/workspaces/ws1/ai/capabilities"
        ? { enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 0, limit_tokens: 500000 } }
        : {},
    ),
  );
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniButton />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  useAiPanelStore.setState({ open: false, conversationId: null, workspaceId: null });
});

afterEach(() => configureShortcutPlatform(null));

const LOCALES = ["vi", "en"] as const;
const PLATFORMS: Array<[ShortcutPlatform, string]> = [
  ["macos", "Meta"],
  ["windows", "Control"],
];

describe("accessible names stay chord-free, the chord rides on aria-keyshortcuts", () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      beforeEach(() => setLocale(locale));

      for (const [platform, modifier] of PLATFORMS) {
        it(`Ask UNI button on ${platform}`, async () => {
          configureShortcutPlatform(platform);
          mountAskUni();
          const button = await screen.findByRole("button", { name: /UNI/ });
          expect(button.getAttribute("aria-label")).not.toMatch(CHORD_IN_NAME);
          expect(button).toHaveAttribute("aria-label", locale === "vi" ? "Hỏi UNI" : "Ask UNI");
          expect(button).toHaveAttribute("aria-keyshortcuts", `${modifier}+J`);
        });

        it(`search trigger on ${platform}`, () => {
          configureShortcutPlatform(platform);
          render(<SearchTrigger />);
          const button = screen.getAllByRole("button")[0]!;
          expect(button.getAttribute("aria-label")).not.toMatch(CHORD_IN_NAME);
          expect(button).toHaveAttribute("aria-keyshortcuts", `${modifier}+K`);
        });
      }

      // The reader's one-key shortcuts (use-email-hub-shortcuts.ts match event.key:
      // Escape, e, #, U). '#' is written as is, not as Shift+3: the handler matches
      // the character the layout produces, and Shift+3 is not '#' on every layout.
      const NAMES = {
        vi: { back: "Quay lại danh sách", archive: "Lưu trữ", trash: "Xóa", unread: "Đánh dấu chưa đọc" },
        en: { back: "Back to list", archive: "Archive", trash: "Delete", unread: "Mark as unread" },
      }[locale];
      const SIBLINGS: Array<[string, string, string]> = [
        ["back to list", NAMES.back, "Escape"],
        ["archive", NAMES.archive, "E"],
        ["delete", NAMES.trash, "#"],
        ["mark as unread", NAMES.unread, "Shift+U"],
      ];
      for (const [what, name, keys] of SIBLINGS) {
        it(`Email Hub ${what} button`, () => {
          render(
            wrapWithNav(
              <EmailHubThreadToolbar thread={thread} browserFolder="INBOX" actions={actions} pending={pending} aiOpen={false} />,
            ),
          );
          const button = screen.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
          expect(button.getAttribute("aria-label")).not.toMatch(CHORD_IN_NAME);
          expect(button).toHaveAttribute("aria-label", name);
          expect(button).toHaveAttribute("aria-keyshortcuts", keys);
        });
      }

      it("Email Hub star button", () => {
        render(
          wrapWithNav(
            <EmailHubThreadToolbar thread={thread} browserFolder="INBOX" actions={actions} pending={pending} aiOpen={false} />,
          ),
        );
        const star = screen.getByRole("button", { name: /^(Gắn sao|Star)/, pressed: false });
        expect(star.getAttribute("aria-label")).not.toMatch(CHORD_IN_NAME);
        expect(star).toHaveAttribute("aria-label", locale === "vi" ? "Gắn sao" : "Star");
        expect(star).toHaveAttribute("aria-keyshortcuts", "S");
      });
    });
  }
});
