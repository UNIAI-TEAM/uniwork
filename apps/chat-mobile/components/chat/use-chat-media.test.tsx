// Signed media URLs on screen: a fresh one is used as is; an expired one asks
// once (with the room's other asks) for fresh ones; a photo keeps drawing from
// its cache meanwhile, a voice message waits; a tap signs one now.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { refreshMessageMedia } from "@/data/chat-cache";
import { requestMediaRefresh } from "@/data/media-refresh";
import { useChatImageSrc, useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media";

jest.mock("@/data/media-refresh", () => ({ requestMediaRefresh: jest.fn() }));
jest.mock("@/data/chat-cache", () => ({ refreshMessageMedia: jest.fn() }));

const FRESH = new Date(Date.now() + 60 * 60_000).toISOString();
const EXPIRED = new Date(Date.now() - 60_000).toISOString();

const qc = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => jest.clearAllMocks());

type Args = { url: string | undefined; expiresAt: string | undefined };

describe("useChatMediaSrc (voice, files)", () => {
  it("uses a fresh URL as is, and waits on an expired one, asking for it once", async () => {
    const hook = await renderHook(({ url, expiresAt }: Args) => useChatMediaSrc("w1", "r1", "m1", url, expiresAt), {
      wrapper,
      initialProps: { url: "https://s/a", expiresAt: FRESH },
    });
    expect(hook.result.current).toBe("https://s/a");
    expect(requestMediaRefresh).not.toHaveBeenCalled();
    await hook.rerender({ url: "https://s/a", expiresAt: EXPIRED });
    expect(hook.result.current).toBeNull();
    await hook.rerender({ url: "https://s/a", expiresAt: EXPIRED });
    expect(requestMediaRefresh).toHaveBeenCalledTimes(1);
    expect(requestMediaRefresh).toHaveBeenCalledWith(qc, "w1", "r1", "m1");
  });

  it("has nothing to show and nothing to ask without a URL", async () => {
    const hook = await renderHook(() => useChatMediaSrc("w1", "r1", "m1", undefined, undefined), { wrapper });
    expect(hook.result.current).toBeNull();
    expect(requestMediaRefresh).not.toHaveBeenCalled();
  });
});

describe("useChatImageSrc (photos)", () => {
  it("keeps drawing an expired photo (its cache key finds it on disk) while the room asks for fresh URLs", async () => {
    const hook = await renderHook(({ url, expiresAt }: Args) => useChatImageSrc("w1", "r1", "p1", url, expiresAt), {
      wrapper,
      initialProps: { url: "https://s/p", expiresAt: EXPIRED },
    });
    expect(hook.result.current).toBe("https://s/p");
    expect(requestMediaRefresh).toHaveBeenCalledWith(qc, "w1", "r1", "p1");
    await hook.rerender({ url: undefined, expiresAt: undefined });
    expect(hook.result.current).toBeNull();
  });
});

describe("useFreshChatMediaUrl (a tap)", () => {
  it("opens a fresh URL as it is, and signs an expired one now; nothing signed is an error", async () => {
    const hook = await renderHook(() => useFreshChatMediaUrl("w1", "r1"), { wrapper });
    const pick = (message: { file?: { url?: string } }) => message.file?.url;
    await expect(hook.result.current("m1", { url: "https://s/a", expiresAt: FRESH }, pick)).resolves.toBe("https://s/a");
    jest.mocked(refreshMessageMedia).mockResolvedValueOnce({ file: { url: "https://s/new" } } as never);
    await expect(hook.result.current("m1", { url: "https://s/a", expiresAt: EXPIRED }, pick)).resolves.toBe("https://s/new");
    jest.mocked(refreshMessageMedia).mockResolvedValueOnce(null);
    await expect(hook.result.current("m1", { url: undefined, expiresAt: undefined }, pick)).rejects.toThrow("unavailable");
  });
});
