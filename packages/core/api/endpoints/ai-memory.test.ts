import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  applyAiMemoryProposal,
  clearAiMemory,
  createAiMemory,
  deleteAiMemory,
  editAiMemoryProposal,
  importAiMemory,
  listAiMemory,
  memoryProposalRowsOfError,
  rejectAiMemoryProposal,
  setAskUniMemory,
  splitAiMemoryImport,
  undoAiMemoryProposal,
  updateAiMemory,
} from "./ai-memory";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const entry = { id: "e1", kind: "preference", text: "Trả lời ngắn", source: "manual", created_at: "t", updated_at: "t" };
const list = { entries: [entry], on: true, limit: 50, remaining: 49 };
const prop = {
  id: "mp1", message_id: "m1", position: 1, action: "remember", memory_id: "", kind: "fact", text: "Tôi là PM",
  before_kind: "", before_text: "", status: "pending", expires_at: "t",
};
const lastCall = () => vi.mocked(fetch).mock.calls.at(-1)!;

describe("ai memory endpoints", () => {
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

  it("lists entries and lets an unknown kind through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...list, entries: [{ ...entry, kind: "newkind" }] }));
    const out = await listAiMemory("acme");
    expect(lastCall()[0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory");
    expect(out).toMatchObject({ on: true, limit: 50, remaining: 49, entries: [{ id: "e1", kind: "newkind" }] });
  });

  it("a malformed list reads as empty, on, with the default limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ entries: "x", on: 3 }));
    expect(await listAiMemory("acme")).toEqual({ entries: [], on: true, limit: 50, remaining: 50 });
  });

  it("create, update, delete, clear call their routes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(entry));
    expect((await createAiMemory("acme", { kind: "preference", text: "x" })).id).toBe("e1");
    expect(lastCall()[0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory");
    expect(lastCall()[1]).toMatchObject({ method: "POST", body: JSON.stringify({ kind: "preference", text: "x" }) });
    vi.mocked(fetch).mockResolvedValueOnce(json(entry));
    await updateAiMemory("acme", "e1", { text: "y" });
    expect(lastCall()[0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory/e1");
    expect(lastCall()[1]).toMatchObject({ method: "PATCH" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteAiMemory("acme", "e1");
    expect(lastCall()[1]).toMatchObject({ method: "DELETE" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: 4 }));
    expect(await clearAiMemory("acme")).toBe(4);
  });

  it("malformed entry and clear answers degrade instead of throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    expect((await createAiMemory("acme", { kind: "fact", text: "x" })).id).toBe("");
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 5 }));
    expect((await updateAiMemory("acme", "e1", { text: "x" })).id).toBe("");
    vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: "x" }));
    expect(await clearAiMemory("acme")).toBe(0);
  });

  it("splits an import; a malformed answer is an empty split", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ candidates: [{ text: "a", kind: "weird", instruction_like: true, duplicate: false }], skipped: [{ text: "b", reason: "secret" }] }),
    );
    const out = await splitAiMemoryImport("acme", "a\nb");
    expect(lastCall()[0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory/import/split");
    expect(out).toEqual({
      candidates: [{ text: "a", kind: "weird", instruction_like: true, duplicate: false }],
      skipped: [{ text: "b", reason: "secret" }],
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ candidates: 1 }));
    expect(await splitAiMemoryImport("acme", "x")).toEqual({ candidates: [], skipped: [] });
  });

  it("imports entries and reports skipped duplicates", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...list, skipped_duplicates: 2 }));
    const out = await importAiMemory("acme", [{ kind: "fact", text: "x" }]);
    expect(lastCall()[0]).toBe("http://api.test/api/v1/orgs/acme/ai/memory/import");
    expect(out.skipped_duplicates).toBe(2);
    vi.mocked(fetch).mockResolvedValueOnce(json([]));
    expect(await importAiMemory("acme", [])).toMatchObject({ entries: [], skipped_duplicates: 0 });
  });

  it("sets the memory switch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await setAskUniMemory(false);
    expect(lastCall()[0]).toBe("http://api.test/api/v1/me/ask-uni-memory");
    expect(lastCall()[1]).toMatchObject({ method: "PUT", body: JSON.stringify({ enabled: false }) });
  });

  it("proposal calls answer the row; a malformed answer is an unreadable row with no id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...prop, status: "applied", memory_id: "e9" }));
    expect(await applyAiMemoryProposal("mp1")).toMatchObject({ id: "mp1", status: "applied", memory_id: "e9" });
    expect(lastCall()[0]).toBe("http://api.test/api/v1/ai/memory-proposals/mp1/apply");
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...prop, status: "rejected" }));
    expect((await rejectAiMemoryProposal("mp1")).status).toBe("rejected");
    expect(lastCall()[0]).toContain("/reject");
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...prop, status: "undone" }));
    expect((await undoAiMemoryProposal("mp1")).status).toBe("undone");
    vi.mocked(fetch).mockResolvedValueOnce(json(prop));
    await editAiMemoryProposal("mp1", { text: "z" });
    expect(lastCall()[0]).toBe("http://api.test/api/v1/ai/memory-proposals/mp1");
    expect(lastCall()[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ text: "z" }) });
    vi.mocked(fetch).mockResolvedValueOnce(json([1]));
    expect(await applyAiMemoryProposal("mp1")).toMatchObject({ id: "", status: "unknown" });
  });

  it("reads the row a 409 carries, and none from other errors", () => {
    const conflict = new ApiError("m", "proposal_not_pending", 409, undefined, { proposal: prop });
    expect(memoryProposalRowsOfError(conflict)).toMatchObject([{ id: "mp1" }]);
    expect(memoryProposalRowsOfError(new ApiError("m", "proposal_not_pending", 409, undefined, { proposal: "x" }))).toEqual([]);
    expect(memoryProposalRowsOfError(new ApiError("m", "internal", 500))).toEqual([]);
    expect(memoryProposalRowsOfError(new Error("x"))).toEqual([]);
  });
});
