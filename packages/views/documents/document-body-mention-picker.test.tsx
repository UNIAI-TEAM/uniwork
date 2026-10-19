import type { Editor } from "@tiptap/core";
import type { PluginKey } from "@tiptap/pm/state";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { MentionList, type MentionItem } from "../editor/extensions/mention-suggestion";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";
import { K } from "./document-comments-keys";

// UNI-1971: the body "@" picker lists the comment picker's people and draws the same rows.
const { t } = initI18n();
const ALICE = "01JAAAAAAAAAAAAAAAAAAAAAAA";
const BINH = "01JBBBBBBBBBBBBBBBBBBBBBBB";
const candidates = [
  { user_id: ALICE, display_name: "Alice", email: "alice@example.test", avatar_url: "https://img.test/alice.png", can_view: true },
  { user_id: BINH, display_name: "Binh", email: "binh@example.test", can_view: false },
];

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser({ id: ALICE, email: "alice@example.test", name: "Alice" } as never);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/me")) {
      return Promise.resolve({ membership: { workspace_id: "ws1", user_id: ALICE, role: "member", source: "membership" } });
    }
    if (!path.includes("mention-candidates")) {
      return Promise.resolve({ members: [{ workspace_id: "ws1", user_id: ALICE, role: "member", email: "alice@example.test", display_name: "Alice" }] });
    }
    const q = new URL(path, "http://x").searchParams.get("q")?.toLowerCase() ?? "";
    return Promise.resolve({ candidates: candidates.filter((c) => c.display_name.toLowerCase().includes(q)) });
  });
});

async function mount() {
  const content = { type: "doc", content: [{ type: "paragraph" }] };
  render(wrap(<DocumentEditor wsId="ws1" documentId="doc1" initialContent={content} content={content}
    contentRevision="1" dirty={false} editable onChange={vi.fn()} onUploadAsset={vi.fn()} />));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  await act(async () => { editor.commands.focus("end"); });
  // The no-access rule follows the caller's membership: wait until the members list has landed.
  await waitFor(async () => {
    const items = (await editor.extensionManager.extensions.find((e) => e.name === "mention")!
      .options.suggestion.items({ query: "" })) as MentionItem[];
    expect(items.map((item) => item.id)).toContain(BINH);
  });
  return editor;
}

const suggestion = (editor: Editor) =>
  editor.extensionManager.extensions.find((extension) => extension.name === "mention")!.options.suggestion;

it("renders avatar, email and the no-access badge like the comment picker", async () => {
  const editor = await mount();
  const items = (await suggestion(editor).items({ query: "" })) as MentionItem[];
  render(<MentionList items={items} query="" command={vi.fn()} />);
  expect(document.querySelector('img[src="https://img.test/alice.png"]')).not.toBeNull();
  expect(screen.getByText("alice@example.test")).toBeTruthy();
  expect(screen.getByText("binh@example.test")).toBeTruthy();
  expect(screen.getByTestId(`mention-candidate-no-access-${BINH}`)).toHaveTextContent(t(K.collabMentionNoAccessBadge));
  expect(screen.queryByTestId(`mention-candidate-no-access-${ALICE}`)).toBeNull();
});

it("lets the email shrink before the name so a narrow row keeps the name", async () => {
  const editor = await mount();
  const items = (await suggestion(editor).items({ query: "" })) as MentionItem[];
  render(<MentionList items={items} query="" command={vi.fn()} />);
  expect(screen.getByText("Alice").className).toContain("shrink-0");
  expect(screen.getByText("alice@example.test").className).toContain("flex-1");
  expect(screen.getByText("alice@example.test").className).not.toContain("shrink-0");
});

it("filters by what was typed and picking inserts the same mention node", async () => {
  const editor = await mount();
  const items = (await suggestion(editor).items({ query: "bin" })) as MentionItem[];
  expect(items.map((item) => item.label)).toEqual(["Binh"]);
  const key = suggestion(editor).pluginKey as PluginKey;
  await act(async () => { editor.commands.insertContent("@"); });
  const range = (key.getState(editor.state) as { range?: { from: number; to: number } }).range ?? { from: 1, to: 2 };
  await act(async () => { suggestion(editor).command({ editor, range, props: items[0] }); });
  expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
    type: "mention", attrs: { id: BINH, label: "Binh", kind: "user" },
  });
});
