// UNI-927 W1 (visual-END B1) - the desktop renderer imports the PPTX panels
// before i18n is initialized; registration must never run (or throw) at import.
// react-i18next is externalized, so its shared instance survives resetModules:
// the test replaces getI18n with a controllable stand-in instead.
import { afterEach, describe, expect, it, vi } from "vitest";

const MODULES = [
  { name: "animations", load: () => import("./animations/animations-i18n"), pick: (m: Record<string, unknown>) => m["ensurePptxAnimationsI18n"], section: "animations" },
  { name: "charts", load: () => import("./charts/charts-i18n"), pick: (m: Record<string, unknown>) => m["ensurePptxChartsI18n"], section: "charts" },
  { name: "transitions", load: () => import("./transitions/transitions-i18n"), pick: (m: Record<string, unknown>) => m["ensurePptxTransitionsI18n"], section: "transitions" },
] as const;

interface FakeI18n {
  isInitialized: boolean;
  handlers: Map<string, Array<() => void>>;
  on: (event: string, handler: () => void) => void;
  hasResourceBundle: (locale: string) => boolean;
  addResourceBundle: ReturnType<typeof vi.fn>;
}

function fakeI18n(): FakeI18n {
  const handlers = new Map<string, Array<() => void>>();
  return {
    isInitialized: false,
    handlers,
    on: (event, handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    hasResourceBundle: () => true,
    addResourceBundle: vi.fn(),
  };
}

function emit(i18n: FakeI18n, event: string): void {
  for (const handler of i18n.handlers.get(event) ?? []) handler();
}

afterEach(() => {
  vi.doUnmock("react-i18next");
  vi.resetModules();
});

describe.each(MODULES)("$name i18n registration", ({ load, pick, section }) => {
  async function setup() {
    vi.resetModules();
    let current: FakeI18n | undefined;
    vi.doMock("react-i18next", async (original) => ({
      ...(await original<typeof import("react-i18next")>()),
      getI18n: () => current,
    }));
    // Importing with no instance at all is the desktop renderer's start-up state.
    const mod = (await load()) as Record<string, unknown>;
    const ensure = pick(mod) as () => void;
    return { ensure, setInstance: (next: FakeI18n) => { current = next; } };
  }

  it("imports and renders before an i18n instance exists without throwing", async () => {
    const { ensure } = await setup();
    expect(typeof ensure).toBe("function");
    expect(() => ensure()).not.toThrow();
  });

  it("waits for initialization, then registers once and again on a language change", async () => {
    const { ensure, setInstance } = await setup();
    const i18n = fakeI18n();
    setInstance(i18n);

    ensure();
    // Instance exists but is not initialized: nothing registered yet, listeners wired once.
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
    ensure();
    expect(i18n.handlers.get("initialized")).toHaveLength(1);
    expect(i18n.handlers.get("languageChanged")).toHaveLength(1);

    i18n.isInitialized = true;
    emit(i18n, "initialized");
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(2); // en + vi
    const [locale, namespace, resources, deep, overwrite] = i18n.addResourceBundle.mock.calls[0] as [string, string, { office: { pptx: Record<string, unknown> } }, boolean, boolean];
    expect([locale, namespace, deep, overwrite]).toEqual(["en", "translation", true, false]);
    expect(resources.office.pptx[section]).toBeTruthy();

    // A later render does not re-merge; a language change does.
    ensure();
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(2);
    emit(i18n, "languageChanged");
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(4);
  });

  it("wires and registers a replaced instance afresh", async () => {
    const { ensure, setInstance } = await setup();
    const first = fakeI18n();
    first.isInitialized = true;
    setInstance(first);
    ensure();
    expect(first.addResourceBundle).toHaveBeenCalledTimes(2);

    const second = fakeI18n();
    second.isInitialized = true;
    setInstance(second);
    ensure();
    expect(second.addResourceBundle).toHaveBeenCalledTimes(2);
    emit(second, "languageChanged");
    expect(second.addResourceBundle).toHaveBeenCalledTimes(4);
  });

  it("keeps retrying while no locale bundle exists yet", async () => {
    const { ensure, setInstance } = await setup();
    const i18n = fakeI18n();
    i18n.isInitialized = true;
    let bundles = false;
    i18n.hasResourceBundle = () => bundles;
    setInstance(i18n);
    ensure();
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
    bundles = true;
    ensure();
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(2);
  });

  it("does not attach the initialized listener to an already initialized instance", async () => {
    const { ensure, setInstance } = await setup();
    const i18n = fakeI18n();
    i18n.isInitialized = true;
    setInstance(i18n);
    ensure();
    expect(i18n.handlers.get("initialized")).toBeUndefined();
    expect(i18n.handlers.get("languageChanged")).toHaveLength(1);
  });

  it("registers on the first render when the instance is already initialized", async () => {
    const { ensure, setInstance } = await setup();
    const i18n = fakeI18n();
    i18n.isInitialized = true;
    setInstance(i18n);
    ensure();
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(2);
  });
});
