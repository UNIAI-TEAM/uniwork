import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getMeetingEvidence } from "./meeting-evidence";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const segment = {
  kind: "segment",
  id: "g1",
  author: "Lan",
  text: "Chốt thứ Sáu",
  at: "2026-10-20T02:15:00Z",
};

describe("meeting evidence endpoint", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("asks for the references in one query and reads the cited lines", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [segment] }));
    const got = await getMeetingEvidence("m1", [
      { kind: "segment", id: "g1" },
      { kind: "note", id: "n 1" },
    ]);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/meetings/m1/evidence?refs=segment%3Ag1%2Cnote%3An%201",
    );
    expect(got).toEqual([segment]);
  });

  it("drops a malformed line and degrades to none", async () => {
    const refs = [{ kind: "segment", id: "g1" }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [{ id: 3 }, { ...segment, author: null, at: null }] }));
    expect(await getMeetingEvidence("m1", refs)).toEqual([{ ...segment, author: null, at: null }]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    expect(await getMeetingEvidence("m1", refs)).toEqual([]);
  });
});
