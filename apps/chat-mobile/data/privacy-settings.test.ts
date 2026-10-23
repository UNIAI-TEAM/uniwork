import { describe, expect, it, vi } from "vitest";
import { installReportSink } from "./report";
import { PRIVACY_READ_CAP_MS, createPrivacySettings, savedAppLockOn } from "./privacy-settings";

const ON = { appLock: true, relockAfterMs: 0, screenSecurity: true, usageStats: false } as const;
const OFF = { appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true } as const;
const NONE = { appLock: false, screenSecurity: false } as const;

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
    expect(privacy.store.getState()).toEqual({ settings: OFF, floor: NONE, loaded: false, restored: false });
    await Promise.all([privacy.load(), privacy.load()]);
    expect(d.read).toHaveBeenCalledTimes(1);
    expect(privacy.store.getState()).toEqual({ settings: ON, floor: NONE, loaded: true, restored: true });
    expect(d.apply).toHaveBeenCalledExactlyOnceWith(ON);
  });

  it("reads both off for nothing saved, a read that fails, or a Keychain that never answers, and is known all the same", async () => {
    const breadcrumbs: string[] = [];
    installReportSink({ captureException: () => undefined, addBreadcrumb: (b) => void breadcrumbs.push(String(b.message)), setUser: () => undefined, setTag: () => undefined });
    try {
      const none = createPrivacySettings(deps(Promise.resolve(null)));
      await none.load();
      expect(none.store.getState()).toEqual({ settings: OFF, floor: NONE, loaded: true, restored: true });

      const failed = createPrivacySettings(deps(Promise.reject(new Error("keychain"))));
      await failed.load();
      expect(failed.store.getState()).toEqual({ settings: OFF, floor: NONE, loaded: true, restored: false });

      const hung = deps(new Promise(() => undefined));
      hung.wait.mockImplementation(async (ms: number) => {
        expect(ms).toBe(PRIVACY_READ_CAP_MS);
      });
      const stuck = createPrivacySettings(hung);
      await stuck.load();
      expect(stuck.store.getState()).toEqual({ settings: OFF, floor: NONE, loaded: true, restored: false });
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
    expect(privacy.store.getState()).toEqual({ settings: expected, floor: NONE, loaded: true, restored: false });
    expect(d.apply).toHaveBeenLastCalledWith(expected);
    expect(d.write).toHaveBeenCalledWith(JSON.stringify({ ...expected, floor: NONE }));
    answer(JSON.stringify(ON));
    await loaded;
    expect(privacy.store.getState()).toEqual({ settings: expected, floor: NONE, loaded: true, restored: false });
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  it("a read that answers after the cap still lands: a slow Keychain does not turn the lock off for the launch", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    d.wait.mockImplementation(async () => undefined);
    const privacy = createPrivacySettings(d);
    await privacy.load();
    expect(privacy.store.getState()).toEqual({ settings: OFF, floor: NONE, loaded: true, restored: false });
    expect(d.apply).not.toHaveBeenCalled();
    answer(JSON.stringify(ON));
    await vi.waitFor(() => expect(privacy.store.getState()).toEqual({ settings: ON, floor: NONE, loaded: true, restored: true }));
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
    expect(privacy.store.getState()).toEqual({ settings: { ...OFF, screenSecurity: true }, floor: NONE, loaded: true, restored: false });
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

  // Audit "Security & privacy", privacy-defaults-off: the organization's requirements are a floor the person cannot
  // lower; the platform and the guard get the choices raised to it, and the floor is saved with them.
  describe("the organization's floor", () => {
    const LOCK = { appLock: true, screenSecurity: false } as const;

    it("is read back with the choices at a cold start and applied before the network answers", async () => {
      const d = deps(Promise.resolve(JSON.stringify({ ...OFF, floor: LOCK })));
      const privacy = createPrivacySettings(d);
      await privacy.load();
      expect(privacy.store.getState()).toEqual({ settings: OFF, floor: LOCK, loaded: true, restored: true });
      expect(d.apply).toHaveBeenCalledExactlyOnceWith({ ...OFF, appLock: true });
    });

    it("raises what is applied, is saved with the choices, and a repeat changes nothing", async () => {
      const d = deps(Promise.resolve(JSON.stringify(OFF)));
      const privacy = createPrivacySettings(d);
      await privacy.load();
      privacy.setFloor({ appLock: false, screenSecurity: true });
      expect(privacy.store.getState().floor).toEqual({ appLock: false, screenSecurity: true });
      expect(d.apply).toHaveBeenLastCalledWith({ ...OFF, screenSecurity: true });
      expect(d.write).toHaveBeenLastCalledWith(JSON.stringify({ ...OFF, floor: { appLock: false, screenSecurity: true } }));
      privacy.setFloor({ appLock: false, screenSecurity: true });
      expect(d.write).toHaveBeenCalledTimes(1);
      // A choice keeps the floor, in what is applied and in what is saved.
      privacy.update({ relockAfterMs: 0 });
      expect(d.apply).toHaveBeenLastCalledWith({ ...OFF, relockAfterMs: 0, screenSecurity: true });
      expect(d.write).toHaveBeenLastCalledWith(JSON.stringify({ ...OFF, relockAfterMs: 0, floor: { appLock: false, screenSecurity: true } }));
      // Lifted, the person's own choices are what is left.
      privacy.setFloor(NONE);
      expect(d.apply).toHaveBeenLastCalledWith({ ...OFF, relockAfterMs: 0 });
    });

    it("heard while the saved choices are still being read, waits for them before it is saved, and outranks the saved floor", async () => {
      let answer: (value: string) => void = () => undefined;
      const d = deps(new Promise((resolve) => (answer = resolve)));
      const privacy = createPrivacySettings(d);
      const loaded = privacy.load();
      privacy.setFloor(LOCK);
      expect(d.write).not.toHaveBeenCalled();
      expect(d.apply).toHaveBeenLastCalledWith({ ...OFF, appLock: true });
      answer(JSON.stringify({ ...ON, floor: NONE }));
      await loaded;
      expect(privacy.store.getState()).toEqual({ settings: ON, floor: LOCK, loaded: true, restored: true });
      expect(d.write).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ ...ON, floor: LOCK }));
    });

    it("heard after a read that never answered stays for the launch without overwriting what is saved", async () => {
      const d = deps(Promise.reject(new Error("keychain")));
      const privacy = createPrivacySettings(d);
      await privacy.load();
      privacy.setFloor(LOCK);
      expect(privacy.store.getState().floor).toEqual(LOCK);
      expect(d.write).not.toHaveBeenCalled();
    });
  });
});

describe("savedAppLockOn", () => {
  const never = () => new Promise<void>(() => undefined);

  it("reads the lock as saved on the phone: the person's choice raised to the organization's floor", async () => {
    expect(await savedAppLockOn(async () => JSON.stringify(ON), never)).toBe(true);
    expect(await savedAppLockOn(async () => JSON.stringify(OFF), never)).toBe(false);
    expect(await savedAppLockOn(async () => null, never)).toBe(false);
    expect(await savedAppLockOn(async () => JSON.stringify({ ...OFF, floor: { appLock: true, screenSecurity: false } }), never)).toBe(true);
    // The capture block alone is no lock.
    expect(await savedAppLockOn(async () => JSON.stringify({ ...OFF, screenSecurity: true, floor: { appLock: false, screenSecurity: true } }), never)).toBe(false);
  });

  it("reads a Keychain that fails or never answers as locked: a reply refused costs less than one sent past the lock", async () => {
    expect(await savedAppLockOn(() => Promise.reject(new Error("keychain")), never)).toBe(true);
    const wait = vi.fn(async (_ms: number) => undefined);
    expect(await savedAppLockOn(() => new Promise<string | null>(() => undefined), wait)).toBe(true);
    expect(wait).toHaveBeenCalledWith(PRIVACY_READ_CAP_MS);
  });
});
