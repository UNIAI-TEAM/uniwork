import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { forgetHeldEditLock, registerHeldEditLock } from "@uniwork/core/documents/edit-lock-registry";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { onWriteRefused } from "./edit-lock-refusal";
import { useDocumentVersionUpload, type DocumentVersionUploadOptions } from "./use-document-version-upload";

const { t } = initI18n();

const THRESHOLD = 10;

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  commit: vi.fn(),
  chunkedStart: vi.fn(),
  getLock: vi.fn(),
}));

vi.mock("@uniwork/core/documents/hooks", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/documents/hooks")>()),
  useDocumentLimits: () => ({ upload_max_bytes: 200 * 1024 * 1024, chunked_upload_threshold_bytes: THRESHOLD }),
  useUploadDocumentFile: () => ({ mutateAsync: mocks.upload, isPending: false }),
  useChunkedDocumentUpload: () => ({
    start: mocks.chunkedStart,
    progress: null,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    hasResumable: () => false,
  }),
}));
vi.mock("@uniwork/core/documents/hooks-versions", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/documents/hooks-versions")>()),
  useCommitDocumentVersion: () => ({ mutateAsync: mocks.commit, isPending: false }),
}));
vi.mock("@uniwork/core/api/endpoints/documents-edit-lock", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/documents-edit-lock")>()),
  getDocumentEditLock: (...a: unknown[]) => mocks.getLock(...a),
}));

const PDF = "application/pdf";
const small = () => new File(["abc"], "v4.pdf", { type: PDF });
const large = () => new File(["x".repeat(THRESHOLD + 5)], "big.pdf", { type: PDF });

function Harness(props: Partial<DocumentVersionUploadOptions>) {
  const upload = useDocumentVersionUpload({ wsId: "ws1", documentId: "d1", revision: "42", ...props });
  return (
    <>
      <button type="button" onClick={upload.open}>
        open
      </button>
      {upload.dialog}
    </>
  );
}

async function pickAndSubmit(file: File) {
  fireEvent.click(screen.getByRole("button", { name: "open" }));
  fireEvent.change(await screen.findByLabelText(t("documents.upload.pick")), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
}

describe("useDocumentVersionUpload", () => {
  beforeEach(() => {
    mocks.upload.mockReset().mockResolvedValue({ upload_id: "up-1" });
    mocks.commit.mockReset().mockResolvedValue({ version: { id: "v5" } });
    mocks.chunkedStart.mockReset().mockResolvedValue({ kind: "upload", upload: { upload_id: "up-chunk" } });
    mocks.getLock.mockReset().mockResolvedValue({ lock: null });
  });
  afterEach(() => {
    forgetHeldEditLock("L1");
  });

  it("stages a small file in one request and commits on the given revision, naming the chat room", async () => {
    const onCommitted = vi.fn();
    render(wrap(<Harness chatRoomId="room1" onCommitted={onCommitted} />));
    await pickAndSubmit(small());

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    expect(mocks.chunkedStart).not.toHaveBeenCalled();
    const key = mocks.upload.mock.calls[0]![0].idempotencyKey;
    expect(mocks.commit).toHaveBeenCalledWith({
      upload_id: "up-1",
      base_revision: "42",
      chat_room_id: "room1",
      idempotencyKey: key,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("names the lock this tab holds on the commit", async () => {
    registerHeldEditLock("d1", "L1");
    render(wrap(<Harness />));
    await pickAndSubmit(small());
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(mocks.commit.mock.calls[0]![0]).toMatchObject({ edit_lock_id: "L1", base_revision: "42" });
    expect(mocks.commit.mock.calls[0]![0]).not.toHaveProperty("chat_room_id");
  });

  it("sends a file above the threshold through an upload session after checking the lock", async () => {
    render(wrap(<Harness chatRoomId="room1" />));
    await pickAndSubmit(large());

    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(mocks.getLock).toHaveBeenCalledWith("d1", expect.anything());
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.chunkedStart).toHaveBeenCalledWith(expect.objectContaining({ filename: "big.pdf" }));
    expect(mocks.commit.mock.calls[0]![0]).toMatchObject({ upload_id: "up-chunk", chat_room_id: "room1" });
  });

  it("refuses a large file before sending a byte when someone else holds the lock, and tells the page", async () => {
    mocks.getLock.mockResolvedValue({ lock: { holder_id: "u2", holder_name: "Bình", held_by_me: false } });
    const refused = vi.fn();
    const off = onWriteRefused("d1", refused);
    const onFailed = vi.fn();
    try {
      render(wrap(<Harness onFailed={onFailed} />));
      await pickAndSubmit(large());

      expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.upload.document_locked"));
      expect(mocks.chunkedStart).not.toHaveBeenCalled();
      expect(mocks.commit).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledWith(expect.objectContaining({ holder_name: "Bình", held_by_me: false }), undefined);
      expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ code: "document_locked", status: 423 }));
    } finally {
      off();
    }
  });

  it("maps a 423 from the commit through the caller's sentence and shows its way out", async () => {
    mocks.commit.mockRejectedValue(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }));
    render(
      wrap(
        <Harness
          describeError={(err) => (err instanceof ApiError && err.fields?.held_by_me === true ? "own hold" : null)}
          errorAction={(err) => (err instanceof ApiError && err.status === 423 ? <button type="button">go</button> : null)}
        />,
      ),
    );
    await pickAndSubmit(small());

    expect(await screen.findByRole("alert")).toHaveTextContent("own hold");
    expect(screen.getByRole("button", { name: "go" })).toBeInTheDocument();
  });

  it("keeps the documents copy for a 423 when the caller has none, and mints a new key for the retry", async () => {
    mocks.commit
      .mockRejectedValueOnce(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }))
      .mockResolvedValueOnce({ version: { id: "v5" } });
    render(wrap(<Harness />));
    await pickAndSubmit(small());

    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.upload.document_locked_by_me"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit.mock.calls[1]![0].idempotencyKey).not.toBe(mocks.commit.mock.calls[0]![0].idempotencyKey);
  });

  it("reports a 409 on a stale revision to the caller and keeps the dialog open", async () => {
    const conflict = new ApiError("conflict", "document_version_conflict", 409);
    mocks.commit.mockRejectedValue(conflict);
    const onFailed = vi.fn();
    const onCommitted = vi.fn();
    render(wrap(<Harness revision="41" onFailed={onFailed} onCommitted={onCommitted} describeError={() => "stale"} />));
    await pickAndSubmit(small());

    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
    expect(mocks.commit.mock.calls[0]![0]).toMatchObject({ base_revision: "41" });
    expect(onFailed).toHaveBeenCalledWith(conflict);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says nothing changed when identical bytes answer the version the document already carries", async () => {
    const { toast } = await import("sonner");
    const message = vi.spyOn(toast, "message");
    mocks.commit.mockResolvedValue({ version: { id: "v4" } });
    render(wrap(<Harness versionIdBefore="v4" />));
    await pickAndSubmit(small());
    await waitFor(() => expect(message).toHaveBeenCalledWith(t("documents.upload.no_change")));
  });
});
