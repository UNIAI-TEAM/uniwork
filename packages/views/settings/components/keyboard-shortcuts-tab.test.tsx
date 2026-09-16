import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import {
  SHORTCUT_ACTIONS,
  configureShortcutPlatform,
  configureShortcutRuntime,
  createShortcutChord,
  getShortcut,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import type { User, Workspace } from "@uniwork/core/types";
import { GlobalShortcuts } from "../../layout/global-shortcuts";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
import { requestMock, wrap, wrapWithNav } from "../../test/api-mock";
import { KeyboardShortcutsTab, SHORTCUT_ACTION_I18N_KEYS } from "./keyboard-shortcuts-tab";
import { SettingsPage } from "./settings-page";

const i18n = initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

function nav(search = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/team/settings",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function recorder(label: string) {
  return screen.getByRole("button", { name: `Đổi phím tắt cho ${label}` });
}

beforeEach(() => {
  configureShortcutPlatform("windows");
  configureShortcutRuntime("web");
  useShortcutStore.getState().resetAll();
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

afterEach(() => {
  configureShortcutPlatform(null);
  configureShortcutRuntime(null);
  useShortcutStore.getState().resetAll();
});

describe("KeyboardShortcutsTab labels", () => {
  it("maps every action id to a dot-free i18n key present in both vi and en", () => {
    const enActions = (en as { settings: { shortcuts: { actions: Record<string, { label?: string; description?: string }> } } })
      .settings.shortcuts.actions;
    for (const action of SHORTCUT_ACTIONS) {
      const key = SHORTCUT_ACTION_I18N_KEYS[action.id];
      expect(key, action.id).toMatch(/^[a-z_]+$/);
      expect(enActions[key!]?.label, `en label ${action.id}`).toBeTruthy();
      expect(enActions[key!]?.description, `en description ${action.id}`).toBeTruthy();
      for (const field of ["label", "description"]) {
        expect(i18n.exists(`settings.shortcuts.actions.${key}.${field}`, { lng: "vi" }), `vi ${field} ${action.id}`).toBe(true);
      }
    }
  });

  it("renders one recorder per action with its effective chord, or unassigned", () => {
    render(wrap(<KeyboardShortcutsTab />));
    expect(screen.getAllByRole("button", { name: /^Đổi phím tắt cho / })).toHaveLength(SHORTCUT_ACTIONS.length);

    const search = recorder("Mở tìm kiếm");
    expect(within(search).getByTitle("Ctrl")).toBeInTheDocument();
    expect(within(search).getByTitle("K")).toBeInTheDocument();
    expect(recorder("Tới Hộp việc")).toHaveTextContent("Chưa gán");
    expect(recorder("Hỏi UNI")).toBeInTheDocument();
  });

  it("filters rows by translated label and description", () => {
    render(wrap(<KeyboardShortcutsTab />));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm thao tác…" }), { target: { value: "cuộc họp" } });
    expect(screen.getAllByRole("button", { name: /^Đổi phím tắt cho / })).toHaveLength(1);
    expect(recorder("Tới Cuộc họp")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm thao tác…" }), { target: { value: "zzz" } });
    expect(screen.getByText("Không có thao tác nào khớp.")).toBeInTheDocument();
  });
});

describe("KeyboardShortcutsTab recording", () => {
  it("records a valid chord and applies it", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "n" });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("N"));
    expect(within(button).getByTitle("N")).toBeInTheDocument();
  });

  it("only captures keys while the recorder is active", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    button.focus();
    fireEvent.keyDown(button, { key: "n" });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
  });

  it("refuses a chord another action owns, keeps recording, then saves a free one", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "k", ctrlKey: true });

    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
    expect(getShortcut("openSearch")).toEqual(createShortcutChord("K", { primary: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Đã dùng cho Mở tìm kiếm.");
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(button, { key: "n" });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("N"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses primary+B, which the sidebar primitive owns", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "b", ctrlKey: true });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
    expect(screen.getByRole("alert")).toHaveTextContent("Phím này thuộc về trình duyệt, hệ điều hành hoặc thanh bên.");
  });

  it("refuses Ctrl+F for any action but find in task, since chat message search also answers it", () => {
    render(wrap(<KeyboardShortcutsTab />));
    // Free the chord first, so the refusal cannot come from the conflict rule.
    fireEvent.click(screen.getByRole("button", { name: "Gỡ phím tắt Tìm trong việc" }));
    expect(getShortcut("findInTask")).toBeNull();

    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "f", ctrlKey: true });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
    expect(screen.getByRole("alert")).toHaveTextContent("Ctrl/⌘+F chỉ dùng cho Tìm trong việc và tìm tin nhắn.");

    const find = recorder("Tìm trong việc");
    fireEvent.click(find);
    fireEvent.keyDown(find, { key: "f", ctrlKey: true });
    expect(getShortcut("findInTask")).toEqual(createShortcutChord("F", { primary: true }));
  });

  it("refuses a browser-reserved chord such as Ctrl+W", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "w", ctrlKey: true });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
    expect(screen.getByRole("alert")).toHaveTextContent("Phím này thuộc về trình duyệt");
  });

  it("refuses a plain letter for an editor action and anything but Enter variants for send", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const search = recorder("Mở tìm kiếm");
    fireEvent.click(search);
    fireEvent.keyDown(search, { key: "j" });
    expect(screen.getByRole("alert")).toHaveTextContent("Phím này sẽ cản việc gõ chữ");

    const send = recorder("Gửi");
    fireEvent.click(send);
    fireEvent.keyDown(send, { key: "Enter", shiftKey: true });
    expect(getShortcut("send")).toEqual(createShortcutChord("Enter", { primary: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Gửi chỉ dùng được Enter hoặc Ctrl/⌘+Enter.");
  });

  it("cancels on Escape without saving", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
  });

  it("clears the binding on Backspace or Delete", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Backspace" });
    expect(getShortcut("createTask")).toBeNull();
    expect(button).toHaveTextContent("Chưa gán");

    const search = recorder("Mở tìm kiếm");
    fireEvent.click(search);
    fireEvent.keyDown(search, { key: "Delete" });
    expect(getShortcut("openSearch")).toBeNull();
  });

  it("ignores auto-repeat and IME composition while recording", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "n", repeat: true });
    fireEvent.keyDown(button, { key: "n", isComposing: true });
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
  });

  it("does not let the global dispatcher run C while C is being recorded", () => {
    const onCreateTask = vi.fn();
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <GlobalShortcuts onCreateTask={onCreateTask} />
          <KeyboardShortcutsTab />
        </WorkspaceProvider>,
        nav(),
      ),
    );
    const button = recorder("Tạo việc");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "c" });
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("stops the recorded key reaching window listeners that ignore defaultPrevented", () => {
    // The sidebar primitive is such a listener; preventDefault alone does not stop it.
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      render(wrap(<KeyboardShortcutsTab />));
      const button = recorder("Tạo việc");
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: "n" });
      expect(seen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", seen);
    }
  });
});

describe("KeyboardShortcutsTab reset", () => {
  it("shows a stored override for a newly declared action and resets that row", () => {
    // Overrides persisted before the action list grew now load (store.ts sanitize).
    useShortcutStore.getState().setShortcut("send", createShortcutChord("Enter"));
    render(wrap(<KeyboardShortcutsTab />));

    const send = recorder("Gửi");
    expect(within(send).getByTitle("Enter")).toBeInTheDocument();
    expect(within(send).queryByTitle("Ctrl")).not.toBeInTheDocument();
    const reset = screen.getByRole("button", { name: "Đặt lại Gửi" });
    expect(reset).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(reset);
    expect(getShortcut("send")).toEqual(createShortcutChord("Enter", { primary: true }));
    expect(screen.getByRole("button", { name: "Đặt lại Gửi" })).toHaveAttribute("aria-disabled", "true");
  });

  it("clears one action with its clear button", () => {
    render(wrap(<KeyboardShortcutsTab />));
    fireEvent.click(screen.getByRole("button", { name: "Gỡ phím tắt Tạo việc" }));
    expect(getShortcut("createTask")).toBeNull();
    expect(screen.getByRole("button", { name: "Gỡ phím tắt Tạo việc" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps restore-defaults focusable but inert while nothing is customised", () => {
    render(wrap(<KeyboardShortcutsTab />));
    const resetAll = screen.getByRole("button", { name: "Khôi phục mặc định" });
    expect(resetAll).toHaveAttribute("aria-disabled", "true");
    expect(resetAll).not.toBeDisabled();
    fireEvent.click(resetAll);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirms before restoring every default", () => {
    useShortcutStore.getState().setShortcut("createTask", createShortcutChord("N"));
    render(wrap(<KeyboardShortcutsTab />));

    fireEvent.click(screen.getByRole("button", { name: "Khôi phục mặc định" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Mọi phím tắt bạn đã đổi trên thiết bị này sẽ trở về mặc định.");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(getShortcut("createTask")).toEqual(createShortcutChord("N"));

    fireEvent.click(screen.getByRole("button", { name: "Khôi phục mặc định" }));
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục tất cả" }));
    expect(getShortcut("createTask")).toEqual(createShortcutChord("C"));
  });
});

describe("SettingsPage shortcuts tab", () => {
  it("opens the shortcuts tab from ?tab=shortcuts", async () => {
    await import("./keyboard-shortcuts-tab");
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <SettingsPage />
        </WorkspaceProvider>,
        nav("tab=shortcuts"),
      ),
    );
    expect(await screen.findByRole("tab", { name: "Phím tắt" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Phím tắt", level: 2 })).toBeInTheDocument();
  });
});
