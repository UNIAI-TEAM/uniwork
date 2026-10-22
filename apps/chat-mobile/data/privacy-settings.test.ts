import { describe, expect, it, vi } from "vitest";
import { installReportSink } from "./report";
import { PRIVACY_READ_CAP_MS, createPrivacySettings } from "./privacy-settings";

const ON = { appLock: true, relockAfterMs: 0, screenSecurity: true, usageStats: false } as const;
const OFF = { appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true } as const;

function deps(saved: Promise<string | null>) {
  return {
    read: vi.fn(() => saved),
    write: vi.fn(async (_value: string) => undefined),
    apply: vi.fn(async () => undefined),
    wait: vi.fn((_ms: number) => new Promise<void>(() => undefined)),
  };
}

describe("createPrivacySettings", () => {
  it("reads the saved choices once per launch, applies them and says they are known", async () => {
    const d = deps(Promise.resolve(JSON.stringify(ON)));
    const privacy = createPrivacySettings(d);
    expect(privacy.store.getState()).toEqual({ settings: OFF, loaded: false, restored: false });
    await Promise.all([privacy.load(), privacy.load()]);
    expect(d.read).toHaveBeenCalledTimes(1);
    expect(privacy.store.getState()).toEqual({ settings: ON, loaded: true, restored: true });
    expect(d.apply).toHaveBeenCalledExactlyOnceWith(ON);
  });

  it("reads both off for nothing saved, a read that fails, or a Keychain that never answers, and is known all the same", async () => {
    const breadcrumbs: string[] = [];
    installReportSink({ captureException: () => undefined, addBreadcrumb: (b) => void breadcrumbs.push(String(b.message)), setUser: () => undefined, setTag: () => undefined });
    try {
      const none = createPrivacySettings(deps(Promise.resolve(null)));
      await none.load();
      expect(none.store.getState()).toEqual({ settings: OFF, loaded: true, restored: true });

      const failed = createPrivacySettings(deps(Promise.reject(new Error("keychain"))));
      await failed.load();
      expect(failed.store.getState()).toEqual({ settings: OFF, loaded: true, restored: false });

      const hung = deps(new Promise(() => undefined));
      hung.wait.mockImplementation(async (ms: number) => {
        expect(ms).toBe(PRIVACY_READ_CAP_MS);
      });
      const stuck = createPrivacySettings(hung);
      await stuck.load();
      expect(stuck.store.getState()).toEqual({ settings: OFF, loaded: true, restored: false });
      expect(breadcrumbs.filter((m) => m.includes("not read"))).toHaveLength(2);
    } finally {
      installReportSink(null);
    }
  });

  it("applies and saves a choice at once, keeps the rest, and a choice made during the read wins", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    const privacy = createPrivacySettings(d);
    const loaded = privacy.load();
    privacy.update({ screenSecurity: true });
    const expected = { ...OFF, screenSecurity: true };
    expect(privacy.store.getState()).toEqual({ settings: expected, loaded: true, restored: false });
    expect(d.apply).toHaveBeenLastCalledWith(expected);
    expect(d.write).toHaveBeenCalledWith(JSON.stringify(expected));
    answer(JSON.stringify(ON));
    await loaded;
    expect(privacy.store.getState()).toEqual({ settings: expected, loaded: true, restored: false });
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  it("a read that answers after the cap still lands: a slow Keychain does not turn the lock off for the launch", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    d.wait.mockImplementation(async () => undefined);
    const privacy = createPrivacySettings(d);
    await privacy.load();
    expect(privacy.store.getState()).toEqual({ settings: OFF, loaded: true, restored: false });
    expect(d.apply).not.toHaveBeenCalled();
    answer(JSON.stringify(ON));
    await vi.waitFor(() => expect(privacy.store.getState()).toEqual({ settings: ON, loaded: true, restored: true }));
    expect(d.apply).toHaveBeenCalledExactlyOnceWith(ON);
  });

  it("a choice made after the cap wins over a read that answers later", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    d.wait.mockImplementation(async () => undefined);
    const privacy = createPrivacySettings(d);
    await privacy.load();
    privacy.update({ screenSecurity: true });
    answer(JSON.stringify(ON));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(privacy.store.getState()).toEqual({ settings: { ...OFF, screenSecurity: true }, loaded: true, restored: false });
  });

  it("a platform that refuses, or a write that fails, keeps the choice for this launch and is reported", async () => {
    const reported: unknown[] = [];
    installReportSink({ captureException: (error) => void reported.push(error), addBreadcrumb: () => undefined, setUser: () => undefined, setTag: () => undefined });
    try {
      const d = deps(Promise.resolve(null));
      d.apply.mockRejectedValueOnce(new Error("no activity"));
      d.write.mockRejectedValueOnce(new Error("keychain"));
      const privacy = createPrivacySettings(d);
      privacy.update({ appLock: true });
      await vi.waitFor(() => expect(reported).toHaveLength(2));
      expect(privacy.store.getState().settings.appLock).toBe(true);
    } finally {
      installReportSink(null);
    }
  });

  it("caps the read with a real timer when none is given", async () => {
    vi.useFakeTimers();
    try {
      const privacy = createPrivacySettings({ read: () => new Promise(() => undefined), write: async () => undefined, apply: async () => undefined });
      const loaded = privacy.load();
      await vi.advanceTimersByTimeAsync(PRIVACY_READ_CAP_MS);
      await loaded;
      expect(privacy.store.getState().loaded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
