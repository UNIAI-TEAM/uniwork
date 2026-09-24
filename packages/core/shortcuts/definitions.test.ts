import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTION_BY_ID,
  createShortcutChord,
  isPortalLayerShortcutTarget,
  isReservedShortcut,
  isShortcutAllowedForAction,
  shouldIgnoreGlobalShortcutEvent,
} from "./definitions";
import { configureShortcutPlatform } from "./platform";

beforeEach(() => {
  configureShortcutPlatform("macos");
});

afterEach(() => {
  configureShortcutPlatform(null);
  document.body.innerHTML = "";
});

describe("UniWork shortcut actions", () => {
  it("declares send as primary+Enter, allowed in editors", () => {
    const send = SHORTCUT_ACTION_BY_ID.send;
    expect(send?.defaultShortcut).toEqual(createShortcutChord("Enter", { primary: true }));
    expect(send?.allowInEditable).toBe(true);
  });

  it("creates a task with plain C, never inside an editor", () => {
    const create = SHORTCUT_ACTION_BY_ID.createTask;
    expect(create?.defaultShortcut).toEqual(createShortcutChord("C"));
    expect(create?.allowInEditable).toBe(false);
  });

  it("opens search with primary+K from anywhere", () => {
    expect(SHORTCUT_ACTION_BY_ID.openSearch?.defaultShortcut).toEqual(
      createShortcutChord("K", { primary: true }),
    );
    expect(SHORTCUT_ACTION_BY_ID.openSearch?.allowInEditable).toBe(true);
  });

  it("opens thread navigation with primary+shift+O from anywhere, including editors", () => {
    expect(SHORTCUT_ACTION_BY_ID.openThreadNav?.defaultShortcut).toEqual(
      createShortcutChord("O", { primary: true, shift: true }),
    );
    expect(SHORTCUT_ACTION_BY_ID.openThreadNav?.allowInEditable).toBe(true);
  });

  it("leaves navigation actions unbound by default", () => {
    for (const id of ["goInbox", "goTasks", "goMyTasks", "goProjects", "goMeetings", "goChat", "goPeople", "goSettings"]) {
      expect(SHORTCUT_ACTION_BY_ID[id], id).toBeDefined();
      expect(SHORTCUT_ACTION_BY_ID[id]?.defaultShortcut, id).toBeNull();
    }
  });

  it("refuses a plain letter for an action allowed in editors", () => {
    expect(isShortcutAllowedForAction("findInTask", createShortcutChord("F"), "macos", "web")).toBe(false);
  });

  it("keeps every shipped default inside the action safety policy on macOS and Windows web", () => {
    const bound = SHORTCUT_ACTIONS.filter((action) => action.defaultShortcut !== null);
    expect(bound.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "ai.askUni",
        "openSearch",
        "createTask",
        "findInTask",
        "openThreadNav",
        "send",
        "goBack",
        "goForward",
      ]),
    );
    for (const platform of ["macos", "windows"] as const) {
      for (const action of bound) {
        expect(
          isShortcutAllowedForAction(action.id, action.defaultShortcut!, platform, "web"),
          `${action.id} on ${platform}`,
        ).toBe(true);
      }
    }
  });
});

describe("isReservedShortcut", () => {
  it("reserves primary+B for the sidebar primitive on every platform and runtime", () => {
    for (const platform of ["macos", "windows", "linux"] as const) {
      for (const runtime of ["web", "desktop"] as const) {
        expect(
          isReservedShortcut(createShortcutChord("B", { primary: true }), platform, runtime),
          `${platform}/${runtime}`,
        ).toBe(true);
      }
    }
    // Extra modifiers do not escape it: the primitive only checks meta/ctrl.
    expect(isReservedShortcut(createShortcutChord("B", { primary: true, shift: true }), "windows", "web")).toBe(true);
  });

  it("reserves literal Control+B on macOS, which the sidebar primitive also matches", () => {
    expect(isReservedShortcut(createShortcutChord("B", { control: true }), "macos", "web")).toBe(true);
    expect(isReservedShortcut(createShortcutChord("B", { control: true }), "macos", "desktop")).toBe(true);
  });

  it("leaves plain B unreserved", () => {
    expect(isReservedShortcut(createShortcutChord("B"), "macos", "web")).toBe(false);
  });
});

describe("Cmd/Ctrl+F reservation", () => {
  // The chat page opens message search on Cmd/Ctrl+F from a window listener
  // that ignores defaultPrevented, so only findInTask may hold the chord.
  it("refuses primary+F for every action except findInTask, extra modifiers included", () => {
    const chords = [
      createShortcutChord("F", { primary: true }),
      createShortcutChord("F", { primary: true, shift: true }),
    ];
    for (const platform of ["macos", "windows", "linux"] as const) {
      for (const runtime of ["web", "desktop"] as const) {
        for (const chord of chords) {
          for (const action of SHORTCUT_ACTIONS) {
            expect(
              isShortcutAllowedForAction(action.id, chord, platform, runtime),
              `${action.id} ${JSON.stringify(chord.modifiers)} ${platform}/${runtime}`,
            ).toBe(action.id === "findInTask");
          }
        }
      }
    }
  });

  it("refuses literal Control+F on macOS for other actions, which the chat listener also matches", () => {
    const chord = createShortcutChord("F", { control: true });
    expect(isShortcutAllowedForAction("createTask", chord, "macos", "web")).toBe(false);
    expect(isShortcutAllowedForAction("goInbox", chord, "macos", "desktop")).toBe(false);
    expect(isShortcutAllowedForAction("findInTask", chord, "macos", "web")).toBe(true);
  });

  it("leaves F without Cmd/Ctrl bindable for other actions", () => {
    expect(isShortcutAllowedForAction("createTask", createShortcutChord("F"), "macos", "web")).toBe(true);
    expect(isShortcutAllowedForAction("createTask", createShortcutChord("F", { alt: true }), "windows", "web")).toBe(true);
  });
});

describe("isPortalLayerShortcutTarget", () => {
  it("is true inside an open menu", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    menu.append(item);
    document.body.append(menu);
    expect(isPortalLayerShortcutTarget(item)).toBe(true);
  });

  it("is true while any Base UI inert layer is present", () => {
    const inert = document.createElement("div");
    inert.setAttribute("data-base-ui-inert", "");
    document.body.append(inert);
    expect(isPortalLayerShortcutTarget(document.body)).toBe(true);
  });

  it("is false for a plain page element", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(isPortalLayerShortcutTarget(div)).toBe(false);
  });
});

describe("shouldIgnoreGlobalShortcutEvent", () => {
  it("ignores repeats and already handled events", () => {
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "c", repeat: true }))).toBe(true);
    const handled = new KeyboardEvent("keydown", { key: "c", cancelable: true });
    handled.preventDefault();
    expect(shouldIgnoreGlobalShortcutEvent(handled)).toBe(true);
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "c" }))).toBe(false);
  });

  it("ignores a key pressed while an IME is composing", () => {
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "c", isComposing: true }))).toBe(true);
    // Safari clears isComposing on the keydown that ends composition; keyCode 229 still marks it.
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }))).toBe(true);
  });
});
