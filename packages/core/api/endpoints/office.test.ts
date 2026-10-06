import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  cancelOfficeJob,
  copyDocument,
  createPreviewScope,
  createBlankDocumentFile,
  getOfficeCapabilities,
  getOfficeJob,
  startOfficeJob,
} from "./office";
import { isOfficeTooLarge } from "../../office";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const capabilitiesBody = (over: Record<string, unknown> = {}) => ({
  document_id: "d1",
  format: "md",
  engine_version: "genoffice@09485f88+uniwork-office.0",
  operations: [
    {
      operation: "serialize",
      runtime: "internal_service",
      evidence_level: "pending",
      engine_bound: true,
      supported: false,
      reason: "bound in the engine service",
    },
    {
      operation: "create_blank",
      runtime: "internal_service",
      evidence_level: "proven",
      engine_bound: true,
      supported: true,
    },
  ],
  ...over,
});

const jobBody = (over: Record<string, unknown> = {}) => ({
  job_id: "j1",
  document_id: "d1",
  operation: "serialize",
  format: "md",
  state: "completed",
  base_revision: "41",
  base_version_id: "v1",
  output_file_id: "f1",
  output_checksum_sha256: "abc",
  output_length: 12,
  error: null,
  engine_name: "genoffice",
  engine_version: "genoffice@09485f88+uniwork-office.0",
  contract_version: "uniwork-office-engine-contract/1",
  protocol_version: "1",
  committed_version_id: null,
  deadline_at: "2026-09-28T09:00:00Z",
  created_at: "2026-09-28T08:59:00Z",
  updated_at: "2026-09-28T08:59:07Z",
  ...over,
});

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d2",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Ghi chú",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-28T09:00:00Z",
  updated_at: "2026-09-28T09:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { operations: "x" }, null, [], "str"];

describe("office endpoints", () => {
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

  it("getOfficeCapabilities reads the rows and keeps supported separate from engine_bound", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(capabilitiesBody()));
    const caps = await getOfficeCapabilities("d1");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/office/capabilities");
    expect(caps?.format).toBe("md");
    expect(caps?.operations[0]).toMatchObject({ operation: "serialize", engineBound: true, supported: false });
    expect(caps?.operations[1]).toMatchObject({ operation: "create_blank", supported: true, reason: null });
  });

  it("startOfficeJob posts the operation with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(jobBody()));
    const job = await startOfficeJob(
      "d1",
      { operation: "serialize", base_revision: "41", document_model_ref: "v1" },
      { idempotencyKey: "key-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/office/jobs");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "serialize",
      base_revision: "41",
      document_model_ref: "v1",
    });
    expect(job?.state).toBe("completed");
    expect(job?.outputFileId).toBe("f1");
  });

  it("posts XLSX edit operations without narrowing their format-specific payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(jobBody({ operation: "edit", format: "xlsx" })));
    await startOfficeJob(
      "d1",
      { operation: "edit", format: "xlsx", base_revision: "41", edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }] },
      { idempotencyKey: "edit-key" },
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "edit",
      format: "xlsx",
      base_revision: "41",
      edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }],
    });
  });

  it("getOfficeJob and cancelOfficeJob hit the job routes and narrow a settled error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(jobBody({ state: "failed", output_file_id: null, error: { code: "engine_timeout", reason: "deadline_exceeded", kind: "deadline_exceeded", retryable: true } })),
    );
    const failed = await getOfficeJob("d1", "j1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/documents/d1/office/jobs/j1");
    expect(failed?.error).toEqual({ code: "engine_timeout", reason: "deadline_exceeded", kind: "deadline_exceeded", retryable: true });

    vi.mocked(fetch).mockResolvedValueOnce(json(jobBody({ state: "cancelled" })));
    const cancelled = await cancelOfficeJob("d1", "j1");
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/documents/d1/office/jobs/j1/cancel");
    expect(cancelled?.state).toBe("cancelled");
  });

  it("narrows the typed xlsx too-large error and degrades a malformed one", async () => {
    const error = { code: "upload_bounds", reason: "xlsx_open_model_too_large", kind: "byte_bound", retryable: false };
    vi.mocked(fetch).mockResolvedValueOnce(json(jobBody({ state: "failed", output_file_id: null, error })));
    const failed = await getOfficeJob("d1", "j1");
    expect(failed?.error).toEqual(error);
    expect(isOfficeTooLarge(failed?.error)).toBe(true);

    for (const bad of [{ ...error, code: 413 }, { ...error, kind: { byte: true } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(jobBody({ state: "failed", output_file_id: null, error: bad })));
      await expect(getOfficeJob("d1", "j1")).resolves.toBeNull();
    }
  });

  it("keeps the Q7 target and result change list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(jobBody({
        format: "xls",
        target_format: "xlsx",
        result: {
          source_format: "xls",
          target_format: "xlsx",
          fidelity: { level: "limited", lost: ["cell_formatting"] },
          content: { sheets: ["Sheet1"], cells: { "Sheet1!A1": "value" }, paragraphs: [] },
        },
      })),
    );
    const job = await getOfficeJob("d1", "j1");
    expect(job).toMatchObject({
      targetFormat: "xlsx",
      result: {
        sourceFormat: "xls",
        targetFormat: "xlsx",
        fidelity: { level: "limited", lost: ["cell_formatting"] },
      },
    });
  });

  it("createBlankDocumentFile and copyDocument return the created document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    const blank = await createBlankDocumentFile("w1", { format: "md", title: "Ghi chú" }, { idempotencyKey: "k" });
    const [blankUrl, blankInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(blankUrl)).toBe("http://api.test/api/v1/workspaces/w1/documents/files/blank");
    expect(JSON.parse(String(blankInit?.body))).toEqual({ format: "md", title: "Ghi chú" });
    expect(blank?.id).toBe("d2");

    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ id: "d3" }) }));
    const copy = await copyDocument("d1", { consent: "copy", job_id: "j1" });
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/documents/d1/copies");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ consent: "copy", job_id: "j1" });
    expect(copy?.id).toBe("d3");
  });

  it("rejects a malformed conversion result instead of exposing a partial job", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(jobBody({ result: { source_format: "xls", target_format: "xlsx" } })),
    );
    await expect(getOfficeJob("d1", "j1")).resolves.toBeNull();
  });

  it("creates a preview scope and rejects a malformed broker response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      origin: "https://preview.example",
      expires_at: "2026-09-30T12:00:00Z",
      assets: [{ key: "assets/logo.png", asset_id: "a1", url: "https://preview.example/api/v1/preview/assets/c/a1" }],
    }));
    await expect(createPreviewScope("d1", { job_id: "j1", assets: [{ key: "assets/logo.png", asset_id: "a1" }] })).resolves.toEqual({
      origin: "https://preview.example",
      expiresAt: "2026-09-30T12:00:00Z",
      assets: [{ key: "assets/logo.png", assetId: "a1", url: "https://preview.example/api/v1/preview/assets/c/a1" }],
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/documents/d1/preview/scopes");

    vi.mocked(fetch).mockResolvedValueOnce(json({ origin: "not-an-origin" }));
    await expect(createPreviewScope("d1", { job_id: "j1", assets: [] })).resolves.toBeNull();
  });

  it("every office answer degrades to null on a malformed body", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await getOfficeCapabilities("d1")).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await startOfficeJob("d1", { operation: "open" })).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await getOfficeJob("d1", "j1")).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await cancelOfficeJob("d1", "j1")).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await createBlankDocumentFile("w1", { format: "md", title: "t" })).toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await copyDocument("d1", { consent: "copy" })).toBeNull();
    }
  });

  it("a rejected job start surfaces instead of a fabricated job", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "unsupported_operation", message: "not bound", error_class: "incompatible" } }, 501),
    );
    await expect(startOfficeJob("d1", { operation: "convert" })).rejects.toThrow();
  });
});
