import { describe, expect, it, vi } from "vitest";
import { createThemePreference } from "./theme-preference";

const deps = (saved: Promise<string | null>) => ({ read: vi.fn(() => saved), write: vi.fn(async () => {}), apply: vi.fn() });

describe("createThemePreference", () => {
  it("reads the saved choice once per launch and applies it", async () => {
    const d = deps(Promise.resolve("dark"));
    const theme = createThemePreference(d);
    expect(theme.store.getState().preference).toBe("system");
    await Promise.all([theme.load(), theme.load()]);
    await theme.load();
    expect(d.read).toHaveBeenCalledTimes(1);
    expect(d.apply).toHaveBeenCalledExactlyOnceWith("dark");
    expect(theme.store.getState().preference).toBe("dark");
  });

  it("keeps system for nothing saved, a value it does not know, or a read that fails", async () => {
    for (const saved of [Promise.resolve(null), Promise.resolve("sepia"), Promise.reject(new Error("keychain"))]) {
      const d = deps(saved);
      const theme = createThemePreference(d);
      await theme.load();
      expect(theme.store.getState().preference).toBe("system");
      expect(d.apply).not.toHaveBeenCalled();
    }
  });

  it("applies and saves a choice at once, and a choice made during the read wins over the saved one", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    const theme = createThemePreference(d);
    const loaded = theme.load();
    theme.set("light");
    expect(d.apply).toHaveBeenLastCalledWith("light");
    expect(d.write).toHaveBeenCalledWith("light");
    answer("dark");
    await loaded;
    expect(theme.store.getState().preference).toBe("light");
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  it("keeps a choice for this launch when it cannot be saved", async () => {
    const d = { ...deps(Promise.resolve(null)), write: vi.fn(() => Promise.reject(new Error("full"))) };
    const theme = createThemePreference(d);
    theme.set("dark");
    await Promise.resolve();
    expect(theme.store.getState().preference).toBe("dark");
  });
});
