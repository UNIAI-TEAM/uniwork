// The app's language reaches the server (audit P2 i18n): pushes, emails and
// the web read users.locale, which defaults to English, while the phone
// speaks the person's choice or the phone's language.
import type { User } from "@uniwork/core/types/user";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDeviceStore, type DeviceStore } from "./storage/device-store";
import { startLocaleSync, type LocaleSyncDeps } from "./locale-sync";
import type { SupportedLocale } from "@/lib/i18n/singleton";

const person = (id: string, locale: string): User => ({ id, locale }) as User;

function harness(initial: { user: User | null; locale: SupportedLocale }) {
  let user = initial.user;
  let locale = initial.locale;
  const userListeners = new Set<() => void>();
  const localeListeners = new Set<() => void>();
  const store: DeviceStore = memoryDeviceStore();
  const deps: LocaleSyncDeps = {
    getUser: () => user,
    subscribeUser: (listener) => {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    getLocale: () => locale,
    subscribeLocale: (listener) => {
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
    patchLocale: vi.fn(async (next: SupportedLocale) => (user ? { ...user, locale: next } : null)),
    setUser: vi.fn((next: User) => {
      user = next;
      userListeners.forEach((listener) => listener());
    }),
    openStore: async () => store,
  };
  return {
    deps,
    store,
    setUser(next: User | null) {
      user = next;
      userListeners.forEach((listener) => listener());
    },
    setLocale(next: SupportedLocale) {
      locale = next;
      localeListeners.forEach((listener) => listener());
    },
    listeners: () => userListeners.size + localeListeners.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startLocaleSync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tells the server the app's language at the first sign-in on this phone, then remembers it", async () => {
    const h = harness({ user: person("u1", "en"), locale: "vi" });
    startLocaleSync(h.deps);
    await settle();
    expect(h.deps.patchLocale).toHaveBeenCalledWith("vi");
    expect(h.deps.setUser).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", locale: "vi" }));
    expect(h.store.getString("locale_synced:u1")).toBe("vi");
    expect(h.deps.patchLocale).toHaveBeenCalledTimes(1);
  });

  it("only remembers when the server already has that language", async () => {
    const h = harness({ user: person("u1", "vi"), locale: "vi" });
    startLocaleSync(h.deps);
    await settle();
    expect(h.deps.patchLocale).not.toHaveBeenCalled();
    expect(h.store.getString("locale_synced:u1")).toBe("vi");
  });

  it("sends a language changed in Settings", async () => {
    const h = harness({ user: person("u1", "vi"), locale: "vi" });
    startLocaleSync(h.deps);
    await settle();
    h.setLocale("en");
    await settle();
    expect(h.deps.patchLocale).toHaveBeenCalledWith("en");
    expect(h.store.getString("locale_synced:u1")).toBe("en");
  });

  it("leaves a language chosen later on the web alone while the phone's own choice has not changed", async () => {
    const h = harness({ user: person("u1", "vi"), locale: "vi" });
    startLocaleSync(h.deps);
    await settle();
    h.setUser(person("u1", "en"));
    await settle();
    expect(h.deps.patchLocale).not.toHaveBeenCalled();
  });

  it("waits for a person to be signed in, and syncs each account on its own", async () => {
    const h = harness({ user: null, locale: "en" });
    startLocaleSync(h.deps);
    await settle();
    expect(h.deps.patchLocale).not.toHaveBeenCalled();
    h.setUser(person("u2", "vi"));
    await settle();
    expect(h.deps.patchLocale).toHaveBeenCalledWith("en");
    expect(h.store.getString("locale_synced:u2")).toBe("en");
  });

  it("tries again on the next change after a failure (offline, 5xx)", async () => {
    const h = harness({ user: person("u1", "en"), locale: "vi" });
    vi.mocked(h.deps.patchLocale).mockRejectedValueOnce(new Error("offline"));
    startLocaleSync(h.deps);
    await settle();
    expect(h.store.getString("locale_synced:u1")).toBeUndefined();
    // The next /me revalidation (a launch, a foreground) hands the same user back.
    h.setUser(person("u1", "en"));
    await settle();
    expect(h.deps.patchLocale).toHaveBeenCalledTimes(2);
    expect(h.store.getString("locale_synced:u1")).toBe("vi");
  });

  it("runs one request at a time and follows with the latest language", async () => {
    const h = harness({ user: person("u1", "en"), locale: "vi" });
    let release!: () => void;
    vi.mocked(h.deps.patchLocale).mockImplementationOnce(
      (next) =>
        new Promise((resolve) => {
          release = () => resolve({ ...person("u1", "en"), locale: next });
        }),
    );
    startLocaleSync(h.deps);
    await settle();
    h.setLocale("en");
    h.setLocale("vi");
    h.setLocale("en");
    expect(h.deps.patchLocale).toHaveBeenCalledTimes(1);
    release();
    await settle();
    await settle();
    // The server got vi, the app now says en: one more request, for en.
    expect(h.deps.patchLocale).toHaveBeenLastCalledWith("en");
    expect(h.deps.patchLocale).toHaveBeenCalledTimes(2);
    expect(h.store.getString("locale_synced:u1")).toBe("en");
  });

  it("does not hand an answer for one account to the next", async () => {
    const h = harness({ user: person("u1", "en"), locale: "vi" });
    let release!: () => void;
    vi.mocked(h.deps.patchLocale).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(person("u1", "vi"));
        }),
    );
    startLocaleSync(h.deps);
    await settle();
    h.setUser(null);
    release();
    await settle();
    expect(h.deps.setUser).not.toHaveBeenCalled();
    expect(h.store.getString("locale_synced:u1")).toBe("vi");
  });

  it("keeps the user it has when the answer drifted", async () => {
    const h = harness({ user: person("u1", "en"), locale: "vi" });
    vi.mocked(h.deps.patchLocale).mockResolvedValueOnce(null);
    startLocaleSync(h.deps);
    await settle();
    expect(h.deps.setUser).not.toHaveBeenCalled();
    expect(h.store.getString("locale_synced:u1")).toBe("vi");
  });

  it("stops listening when stopped", async () => {
    const h = harness({ user: person("u1", "vi"), locale: "vi" });
    const stop = startLocaleSync(h.deps);
    await settle();
    stop();
    expect(h.listeners()).toBe(0);
  });
});
