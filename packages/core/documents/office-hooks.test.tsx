import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeJob } from "../api/endpoints/office";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  isLiveOfficeJob,
  isCompletedOfficeConversion,
  officeKeys,
  useCreateBlankDocumentFile,
  useOfficeCapabilities,
  useOfficeJob,
} from "./office-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const capabilities = {
  document_id: "d1",
  format: "md",
  engine_version: "genoffice@09485f88+uniwork-office.0",
  operations: [
    {
      operation: "create_blank",
      runtime: "internal_service",
      evidence_level: "proven",
      engine_bound: true,
      supported: true,
    },
  ],
};

// The wire shape the endpoint narrows; the test drives the hooks through the
// real schema so a drift in either side fails here.
const wireJob = (over: Record<string, unknown> = {}) => ({
  job_id: "j1",
  document_id: "d1",
  operation: "serialize",
  format: "md",
  state: "running",
  base_revision: "1",
  base_version_id: "v1",
  output_file_id: null,
  output_checksum_sha256: null,
  output_length: null,
  error: null,
  engine_name: "genoffice",
  engine_version: "genoffice@09485f88+uniwork-office.0",
  contract_version: "uniwork-office-engine-contract/1",
  protocol_version: "1",
  committed_version_id: null,
  deadline_at: "2026-09-28T09:00:00Z",
  created_at: "2026-09-28T08:59:00Z",
  updated_at: "2026-09-28T08:59:01Z",
  ...over,
});

const narrowJob = (state: OfficeJob["state"]): OfficeJob => ({
  jobId: "j1",
  documentId: "d1",
  operation: "serialize",
  format: "md",
  state,
  baseRevision: "1",
  baseVersionId: "v1",
  outputFileId: null,
  outputChecksum: null,
  outputLength: null,
  targetFormat: null,
  result: null,
  error: null,
  engineName: "genoffice",
  engineVersion: "x",
  contractVersion: "y",
  protocolVersion: "1",
  committedVersionId: null,
  deadlineAt: "z",
  createdAt: "c",
  updatedAt: "u",
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("office hooks", () => {
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

  it("keys capabilities by workspace and document and keeps supported separate", async () => {
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json(capabilities));
    const { result } = renderHook(() => useOfficeCapabilities("w1", "d1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.operations[0]?.supported).toBe(true);
    expect(qc.getQueryData(officeKeys.capabilities("w1", "d1"))).toBeDefined();
    expect(officeKeys.capabilities("w1", "d1")).not.toEqual(officeKeys.capabilities("w2", "d1"));
  });

  it("reads a job and stops polling once it settles", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json(wireJob({ state: "completed" })));
    const { result } = renderHook(() => useOfficeJob("w1", "d1", "j1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.jobId).toBe("j1");
    expect(isLiveOfficeJob(result.current.data)).toBe(false);
    expect(isLiveOfficeJob(narrowJob("running"))).toBe(true);
    expect(isLiveOfficeJob(narrowJob("timed_out"))).toBe(false);
    expect(isCompletedOfficeConversion({ ...narrowJob("completed"), operation: "convert", targetFormat: "xlsx", result: {
      sourceFormat: "xls",
      targetFormat: "xlsx",
      fidelity: { level: "limited", lost: [] },
      content: { sheets: [], cells: {}, paragraphs: [] },
    } })).toBe(true);
  });

  it("refuses an unverifiable blank create and never writes a fake document", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { result } = renderHook(() => useCreateBlankDocumentFile("w1"), { wrapper });
    result.current.mutate({ format: "md", title: "t" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toContain("verifiable");
  });
});
