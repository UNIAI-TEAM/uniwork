// C3 (UNI-924): the Protect panel's honest states. The engine hasher is
// mocked here (its algorithm is pinned by the office-engine vector test); the
// point of this file is that a typed password reaches the hasher and nothing
// else — never a callback, never the DOM — and that a refusing hasher blocks
// the change with a reason.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocProtection, WriteProtection } from "@uniwork/office-engine/docx";
import { DocxProtectPanel, type DocxProtectPanelProps } from "./docx-protect-panel";
import type { DocxProtectionSnapshot } from "./docx-protection";

const hashProtectionPassword = vi.fn();
vi.mock("@uniwork/office-engine/docx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/office-engine/docx")>()),
  hashProtectionPassword: (...args: [string, number?]) => hashProtectionPassword(...args),
}));

const EMPTY: DocxProtectionSnapshot = { protection: null, writeProtection: null, pending: false };
const CREDENTIALS = { hash: "aGFzaA==", salt: "c2FsdA==", spinCount: 1000, algorithmSid: 14 };

function renderPanel(state: DocxProtectionSnapshot, overrides: Partial<DocxProtectPanelProps> = {}) {
  const props: DocxProtectPanelProps = {
    open: true,
    onOpenChange: vi.fn(),
    state,
    onSetProtection: vi.fn(() => true),
    onSetWriteProtection: vi.fn(() => true),
    ...overrides,
  };
  render(<DocxProtectPanel {...props} />);
  return props;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("DocxProtectPanel", () => {
  it("hashes a typed restriction password and passes only the verifier on", async () => {
    hashProtectionPassword.mockResolvedValueOnce(CREDENTIALS);
    const props = renderPanel(EMPTY);
    fireEvent.change(screen.getByTestId("docx-protect-restriction-password"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("docx-protect-restriction-apply"));
    await waitFor(() => expect(props.onSetProtection).toHaveBeenCalledTimes(1));
    expect(hashProtectionPassword).toHaveBeenCalledWith("s3cret");
    const sent = (props.onSetProtection as ReturnType<typeof vi.fn>).mock.calls[0]![0] as DocProtection;
    expect(sent).toEqual({ edit: "readOnly", enforced: true, ...CREDENTIALS });
    expect(JSON.stringify(sent)).not.toContain("s3cret");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    // the plaintext does not outlive the action (the dialog stays mounted)
    expect(screen.getByTestId("docx-protect-restriction-password")).toHaveValue("");
  });

  it("hashes a typed password to modify and sends only the verifier", async () => {
    hashProtectionPassword.mockResolvedValueOnce(CREDENTIALS);
    const props = renderPanel(EMPTY);
    fireEvent.change(screen.getByTestId("docx-protect-modify-password"), { target: { value: "m0dify" } });
    fireEvent.click(screen.getByTestId("docx-protect-modify-apply"));
    await waitFor(() => expect(props.onSetWriteProtection).toHaveBeenCalledTimes(1));
    expect(hashProtectionPassword).toHaveBeenCalledWith("m0dify");
    const sent = (props.onSetWriteProtection as ReturnType<typeof vi.fn>).mock.calls[0]![0] as WriteProtection;
    expect(sent).toEqual({ ...CREDENTIALS });
    expect(JSON.stringify(sent)).not.toContain("m0dify");
    expect(screen.getByTestId("docx-protect-modify-password")).toHaveValue("");
  });

  it("sends the recommendation alone when no modify password is typed", async () => {
    const props = renderPanel(EMPTY);
    fireEvent.click(screen.getByTestId("docx-protect-modify-recommended"));
    fireEvent.click(screen.getByTestId("docx-protect-modify-apply"));
    await waitFor(() => expect(props.onSetWriteProtection).toHaveBeenCalledTimes(1));
    expect(props.onSetWriteProtection).toHaveBeenCalledWith({ recommended: true });
    expect(hashProtectionPassword).not.toHaveBeenCalled();
  });

  it("fails closed when the hasher refuses, with nothing recorded", async () => {
    hashProtectionPassword.mockRejectedValueOnce(Object.assign(new Error("no subtle"), { code: "crypto_unavailable" }));
    const props = renderPanel(EMPTY);
    fireEvent.change(screen.getByTestId("docx-protect-restriction-password"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("docx-protect-restriction-apply"));
    await screen.findByTestId("docx-protect-error");
    expect(screen.getByTestId("docx-protect-error")).toHaveTextContent("WebCrypto");
    expect(props.onSetProtection).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("renders the document's real restriction state and the pending line", () => {
    renderPanel({ protection: { edit: "trackedChanges", enforced: false, ...CREDENTIALS }, writeProtection: { hash: CREDENTIALS.hash }, pending: true });
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("chưa bật");
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("mật khẩu");
    expect(screen.getByTestId("docx-protect-modify-state")).toHaveTextContent("mật khẩu");
    expect(screen.getByTestId("docx-protect-pending")).toBeInTheDocument();
  });

  it("blocks removal and apply with a reason while the host is read-only", () => {
    const props = renderPanel(EMPTY, { readOnly: true });
    expect(screen.getByTestId("docx-protect-gate")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-protect-restriction-apply"));
    fireEvent.click(screen.getByTestId("docx-protect-modify-apply"));
    expect(props.onSetProtection).not.toHaveBeenCalled();
    expect(props.onSetWriteProtection).not.toHaveBeenCalled();
  });

  it("discloses that removal does not ask for the password it bypasses", () => {
    renderPanel({ protection: { edit: "readOnly", enforced: true, ...CREDENTIALS }, writeProtection: { hash: CREDENTIALS.hash }, pending: false });
    expect(screen.getByTestId("docx-protect-restriction-remove-note")).toBeInTheDocument();
    expect(screen.getByTestId("docx-protect-modify-remove-note")).toBeInTheDocument();
  });

  it("does not show the removal note when nothing is password-protected", () => {
    renderPanel({ protection: { edit: "readOnly", enforced: true }, writeProtection: { recommended: true }, pending: false });
    expect(screen.queryByTestId("docx-protect-restriction-remove-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docx-protect-modify-remove-note")).not.toBeInTheDocument();
  });

  it("warns before replacing a restriction mode it does not recognize", () => {
    renderPanel({ protection: { edit: "oddball", enforced: true }, writeProtection: null, pending: false });
    expect(screen.getByTestId("docx-protect-restriction-unknown")).toBeInTheDocument();
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("oddball");
  });

  it("does not warn when the restriction mode is recognized", () => {
    renderPanel({ protection: { edit: "comments", enforced: true }, writeProtection: null, pending: false });
    expect(screen.queryByTestId("docx-protect-restriction-unknown")).not.toBeInTheDocument();
  });
});
