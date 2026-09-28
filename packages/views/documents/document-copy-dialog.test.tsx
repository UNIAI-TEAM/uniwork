import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentCopyDialog } from "./document-copy-dialog";

const { t } = initI18n();
const WS = "ws1";

function narrowDocument(parsed: ReturnType<typeof DocumentSchema.parse>): Document {
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
  };
}

function documentFixture(over: Record<string, unknown> = {}): Document {
  return narrowDocument(
    DocumentSchema.parse({
      id: "d1",
      workspace_id: WS,
      kind: "file",
      title: "Báo cáo Q4",
      revision: "3",
      current_version: 1,
      my_level: "edit",
      file: {
        file_id: "f1",
        version_id: "v1",
        version: 1,
        filename: "bao-cao.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        checksum_sha256: "a".repeat(64),
      },
      ...over,
    }),
  );
}

function renderDialog(over: { onCopied?: (d: Document) => void; onUnavailable?: () => void } = {}) {
  return render(
    wrap(
      <DocumentCopyDialog
        open
        onOpenChange={() => undefined}
        wsId={WS}
        doc={documentFixture()}
        onCopied={over.onCopied}
        onUnavailable={over.onUnavailable}
      />,
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentCopyDialog", () => {
  it("will not copy without explicit consent", () => {
    requestMock.mockReset();
    renderDialog();

    const submit = screen.getByRole("button", { name: t("documents.copy.submit") });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: t("documents.copy.consent_label") }));
    expect(submit).toBeEnabled();
  });

  it("posts consent, the title and one key, then reports the copy", async () => {
    const posts: { body?: unknown; key?: string }[] = [];
    requestMock.mockReset();
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      if (path === "/api/v1/documents/d1/copies" && opts?.method === "POST") {
        posts.push({ body: opts.body, key: opts.headers?.["Idempotency-Key"] });
        return Promise.resolve({ document: documentFixture({ id: "d2", title: "Bản sao" }) });
      }
      return Promise.resolve({});
    });
    const onCopied = vi.fn();
    renderDialog({ onCopied });

    fireEvent.change(screen.getByLabelText(t("documents.copy.title_label")), {
      target: { value: "Bản sao Q4" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.body).toEqual({ consent: "copy", title: "Bản sao Q4" });
    expect(posts[0]?.key).toBeTruthy();
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" })));
  });

  it("names the consent refusal instead of pretending it copied", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation(() =>
      Promise.reject(new ApiError("consent", "copy_consent_required", 409)),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.copy.consent_required"));
  });

  it("reports an owned document by name", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation(() =>
      Promise.reject(new ApiError("owned", "owner_requires_copy", 409)),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.copy.owner_requires_copy"));
  });

  it("hides itself when the deployment has no copy route yet", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => Promise.reject(new ApiError("missing", "not_found", 404)));
    const onUnavailable = vi.fn();
    renderDialog({ onUnavailable });

    fireEvent.click(screen.getByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.copy.unavailable"));
    expect(onUnavailable).toHaveBeenCalled();
  });
});
