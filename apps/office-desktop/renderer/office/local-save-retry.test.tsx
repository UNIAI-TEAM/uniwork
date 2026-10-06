/** @vitest-environment jsdom */
// UNI-954 P04 (review-fe-r2 F6 + visual-r1 "Save-time file_locked Retry"): a local
// Save refused with a file_* code names its reason in the status, keeps Save
// (the Retry control of the shell) active, and re-runs the same bytes once the
// cause clears. Real byte session and real OfficeShell; only the main-process
// answers are scripted.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18n from "i18next";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { createByteDocumentSession } from "./session";
import { createByteTestEditor } from "../../test/byte-editor";

const checksum = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const handle = `file_${"r".repeat(40)}`;
const opened = { format: "docx" as const, data: new TextEncoder().encode("hello"), checksum, localHandle: handle };
const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: handle, generation: 1, baseRevision: "0", baseVersionId: "v0" };
const saved = { opened: true, metadata: { handle, name: "Local.docx", byteLength: 5, modifiedAtMs: 10, checksum } };

beforeAll(async () => { initI18n(); await setLocale("en"); });
beforeEach(async () => { await setLocale("en"); });
afterEach(cleanup);

async function openSession(answer: (channel: string) => unknown) {
  const call = vi.fn(async (channel: string) => answer(channel));
  const session = createByteDocumentSession({ call: call as never }, identity, opened, { createEditor: createByteTestEditor });
  await session.openEditor();
  return { session, call, saves: () => call.mock.calls.filter(([channel]) => channel === "desktop:file-save").length };
}

it("keeps Save active after a file_locked Save, says why, and saves the same bytes once the lock clears", async () => {
  let locked = true;
  const { session, saves } = await openSession(() => (locked ? { opened: false, code: "file_locked" } : saved));
  render(<OfficeShell title="Local.docx" editor={<div />} saveCoordinator={session.coordinator} editorReady saveDestination="local" />);
  act(() => session.coordinator.markDirty(1));
  const save = () => screen.getByRole("button", { name: /save/i });
  fireEvent.click(save());
  // The coordinator retries a locked file on its own (3 attempts), then stops on the error.
  const alert = await screen.findByRole("alert", undefined, { timeout: 10_000 });
  expect(alert).toHaveTextContent(i18n.t("office.save.reason.file_locked"));
  expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_locked", action: "retry", retryable: true } });
  expect(saves()).toBe(3);
  // Retry is offered: Save is not quiet or disabled in the error state.
  expect(save()).not.toBeDisabled();
  expect(save()).not.toHaveAttribute("aria-disabled", "true");

  locked = false;
  fireEvent.click(save());
  // A local save settles on "ready" (nothing left to save), not on an error.
  await waitFor(() => expect(session.coordinator.getState().state).toBe("ready"));
  expect(session.coordinator.getState().lastSavedGeneration).toBe(session.coordinator.getState().dirtyGeneration);
  expect(saves()).toBe(4);
  expect(screen.queryByRole("alert")).toBeNull();
}, 30_000);

it("names a failed draft checkpoint, and a later Save still runs", async () => {
  let refused = true;
  const { session } = await openSession(() => (refused ? { opened: false, code: "file_checkpoint_failed" } : saved));
  session.coordinator.markDirty(1);
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "error" });
  expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_checkpoint_failed", action: "retry" } });
  refused = false;
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
}, 30_000);

it("keeps the draft and the pending intent when this computer runs out of memory for a Save", async () => {
  const { session } = await openSession(() => ({ opened: false, code: "file_insufficient_memory" }));
  render(<OfficeShell title="Local.docx" editor={<div />} saveCoordinator={session.coordinator} editorReady saveDestination="local" />);
  act(() => session.coordinator.markDirty(1));
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "error" });
  expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_insufficient_memory", action: "keep_draft", retryable: false } });
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("office.save.reason.file_insufficient_memory"));
});

it("routes a refused context rebind after a confirmed local Save into the error state, without losing the receipt or rejecting", async () => {
  let confirmed = false;
  let rebindRefused = true;
  const { session } = await openSession((channel) => {
    if (channel === "desktop:file-open") return confirmed && rebindRefused ? { opened: false, code: "file_locked" } : saved;
    if (channel === "desktop:file-save") { confirmed = true; return saved; }
    return { drafts: [] };
  });
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  render(<OfficeShell title="Local.docx" editor={<div />} saveCoordinator={session.coordinator} editorReady saveDestination="local" />);
  act(() => session.coordinator.markDirty(1));
  // The write is confirmed even though the read-only context refresh was refused.
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  act(() => session.coordinator.markDirty(2));
  // The next Save does not reject: the coded refusal lands in the coordinator state the shell shows.
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "error" });
  expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_locked", action: "retry", retryable: true } });
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("office.save.reason.file_locked"));
  // Save (the shell's retry control) goes through once the context rebind succeeds.
  rebindRefused = false;
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  expect(session.coordinator.getState().error).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", unhandled);
  expect(unhandled).not.toHaveBeenCalled();
}, 30_000);

it("retires the coded refusal when a checkpoint's rebind succeeds first, so a later Save shows no stale error", async () => {
  let confirmed = false;
  let rebindRefused = true;
  const { session, saves } = await openSession((channel) => {
    if (channel === "desktop:file-open") return confirmed && rebindRefused ? { opened: false, code: "file_locked" } : saved;
    if (channel === "desktop:file-save") { confirmed = true; return saved; }
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: 3 };
    return { drafts: [] };
  });
  render(<OfficeShell title="Local.docx" editor={<div />} saveCoordinator={session.coordinator} editorReady saveDestination="local" />);
  act(() => session.coordinator.markDirty(1));
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  act(() => session.coordinator.markDirty(2));
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "error" });
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("office.save.reason.file_locked"));
  // The lock clears and a checkpoint (not a Save) is the first to rebind the context.
  rebindRefused = false;
  await act(async () => { await session.coordinator.checkpoint(); });
  expect(session.coordinator.getState().error).toBeNull();
  expect(session.coordinator.getState().state).not.toBe("error");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  // The next Save skips the rebind block; it must still settle without the old error.
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  expect(session.coordinator.getState()).toMatchObject({ state: "ready", error: null });
  expect(saves()).toBe(2);
  expect(screen.queryByRole("alert")).toBeNull();
}, 30_000);
