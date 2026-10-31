// What each message action does: the command it sends through the mutation
// layer, the sheet it opens instead, and the failure it says.
import { act, renderHook } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { Alert, type AlertButton } from "react-native";
import { useToastStore } from "@/data/stores/toast-store";
import { i18n } from "@/lib/i18n/singleton";
import type { TimelineMessage } from "@/lib/timeline-display";
import { viText } from "@/test/render";
import { useMessageActions } from "./use-message-actions";

const mockCommands = {
  send: jest.fn(),
  retry: jest.fn(),
  discard: jest.fn(),
  edit: jest.fn(async (_input: unknown) => undefined),
  remove: jest.fn(async (_id: string) => undefined),
  pin: jest.fn(async (_id: string) => undefined),
  react: jest.fn(async (_input: unknown) => undefined),
  vote: jest.fn(async (_input: unknown) => undefined),
  followUp: jest.fn(async (_input: unknown) => undefined),
  createTask: jest.fn(async (_input: unknown) => undefined),
  typing: jest.fn(),
};
jest.mock("@/data/mutations/messages", () => ({
  useSendMessage: () => ({ mutate: mockCommands.send }),
  useRetrySend: () => ({ mutate: mockCommands.retry }),
  useDiscardSend: () => mockCommands.discard,
  useEditMessage: () => ({ mutateAsync: mockCommands.edit }),
  useDeleteMessage: () => ({ mutateAsync: mockCommands.remove }),
  useTogglePin: () => ({ mutateAsync: mockCommands.pin }),
  useReact: () => ({ mutateAsync: mockCommands.react }),
  useVotePoll: () => ({ mutateAsync: mockCommands.vote }),
  useFollowUp: () => ({ mutateAsync: mockCommands.followUp }),
  useCreateTask: () => ({ mutateAsync: mockCommands.createTask }),
  useSignalTyping: () => mockCommands.typing,
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const chat = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const message: TimelineMessage = { id: "m1", sender: "U2", body: "Họp [@Lan](mention://member/u3) lúc 3 giờ", ts: 0 };
const pending = { workspaceId: "w1", roomId: "r1", senderId: "ME", clientMsgId: "c1", body: "x", createdAt: 0, status: "failed" as const };

async function setup(followUp: { id: string } | null = null) {
  const sheets = jest.fn();
  const composer = { reply: jest.fn(), edit: jest.fn() };
  const followUpOf = jest.fn(() => (followUp ? { ...followUp, message_id: "m1", note: "", due_at: null, completed_at: null } : null));
  const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
  const hook = await renderHook(() => useMessageActions({ chat, roomId: "r1", followUpOf, senderName: () => "Bình", sheets, composer }), {
    wrapper,
  });
  return { hook, sheets, composer };
}

const lastToast = () => useToastStore.getState().toasts.at(-1)?.message;
const flush = () => act(async () => undefined);

afterEach(() => {
  // Stops the toasts' dismiss timers too, so Jest can exit.
  useToastStore.getState().clear();
  jest.clearAllMocks();
});

describe("useMessageActions", () => {
  it("sends, types, edits, reacts and votes through the mutation layer", async () => {
    const { hook } = await setup();
    const actions = hook.result.current;
    actions.send({ body: "hi" });
    actions.signalTyping();
    actions.saveEdit("m1", "sửa");
    actions.react("m1", "👍");
    actions.votePoll("m1", "o1");
    await flush();
    expect(mockCommands.send).toHaveBeenCalledWith({ body: "hi" });
    expect(mockCommands.typing).toHaveBeenCalled();
    expect(mockCommands.edit).toHaveBeenCalledWith({ messageId: "m1", body: "sửa" });
    expect(mockCommands.react).toHaveBeenCalledWith({ messageId: "m1", emoji: "👍" });
    expect(mockCommands.vote).toHaveBeenCalledWith({ messageId: "m1", optionId: "o1" });
    expect(lastToast()).toBeUndefined();
  });

  it("says each failure in its own words", async () => {
    for (const fn of [mockCommands.edit, mockCommands.react, mockCommands.vote, mockCommands.pin]) {
      fn.mockRejectedValueOnce(new Error("down"));
    }
    const { hook } = await setup();
    const actions = hook.result.current;
    const said: (string | undefined)[] = [];
    const run = async (call: () => void) => {
      call();
      await flush();
      said.push(lastToast());
    };
    await run(() => actions.saveEdit("m1", "x"));
    await run(() => actions.react("m1", "👍"));
    await run(() => actions.votePoll("m1", "o1"));
    await run(() => actions.sheet.onPin(message));
    expect(said).toEqual([
      viText("chat.message_list.edit_failed"),
      viText("chat.message_list.react_failed"),
      viText("chat.message_list.poll_vote_failed"),
      viText("common.error"),
    ]);
  });

  it("copies the body as typed, opens the create-task form filled from it, and opens the thread", async () => {
    const { hook, sheets } = await setup();
    const { sheet } = hook.result.current;
    sheet.onCopy(message);
    sheet.onCreateTask(message);
    sheet.onThread(message);
    sheet.onReact(message, "❤️");
    await flush();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Họp @Lan lúc 3 giờ");
    expect(sheets).toHaveBeenCalledWith({
      type: "open",
      sheet: { kind: "createTask", messageId: "m1", title: "Họp @Lan lúc 3 giờ", description: "Họp @Lan lúc 3 giờ", count: 1 },
    });
    expect(mockCommands.createTask).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining("m1"));
    expect(mockCommands.react).toHaveBeenCalledWith({ messageId: "m1", emoji: "❤️" });
  });

  it("asks before deleting, and deletes only on the destructive answer", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    mockCommands.remove.mockRejectedValueOnce(new Error("down"));
    const { hook } = await setup();
    hook.result.current.sheet.onDelete(message);
    expect(mockCommands.remove).not.toHaveBeenCalled();
    const buttons: AlertButton[] = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((button) => button.style === "destructive")?.onPress?.();
    await flush();
    expect(mockCommands.remove).toHaveBeenCalledWith("m1");
    expect(lastToast()).toBe(viText("chat.message_list.delete_failed"));
  });

  it("sets a follow-up, and completes, converts or removes the open one", async () => {
    const open = await setup({ id: "f1" });
    const { sheet } = open.hook.result.current;
    sheet.onFollowUp(message, "create");
    sheet.onFollowUp(message, "complete");
    sheet.onFollowUp(message, "remove");
    sheet.onFollowUp(message, "convert");
    await flush();
    expect(mockCommands.followUp.mock.calls).toEqual([
      [{ command: "create", id: "m1" }],
      [{ command: "complete", id: "f1" }],
      [{ command: "remove", id: "f1" }],
    ]);
    expect(mockCommands.createTask).toHaveBeenCalledWith({ followUpId: "f1" });
  });

  it("does nothing to a follow-up that is gone, and says a failed one", async () => {
    mockCommands.createTask.mockRejectedValueOnce(new Error("down"));
    const withOne = await setup({ id: "f1" });
    withOne.hook.result.current.sheet.onFollowUp(message, "convert");
    await flush();
    expect(lastToast()).toBe(viText("chat.follow_up.convert_failed"));
    mockCommands.followUp.mockRejectedValueOnce(new Error("down"));
    withOne.hook.result.current.sheet.onFollowUp(message, "complete");
    await flush();
    expect(lastToast()).toBe(viText("chat.follow_up.update_failed"));

    jest.clearAllMocks();
    const none = await setup(null);
    none.hook.result.current.sheet.onFollowUp(message, "complete");
    await flush();
    expect(mockCommands.followUp).not.toHaveBeenCalled();
  });

  it("retries or discards only a pending send", async () => {
    const { hook } = await setup();
    const { sheet } = hook.result.current;
    sheet.onRetry(message);
    sheet.onDiscard(message);
    expect(mockCommands.retry).not.toHaveBeenCalled();
    expect(mockCommands.discard).not.toHaveBeenCalled();
    sheet.onRetry({ ...message, pending });
    sheet.onDiscard({ ...message, pending });
    expect(mockCommands.retry).toHaveBeenCalledWith(pending);
    expect(mockCommands.discard).toHaveBeenCalledWith("c1");
  });

  it("opens the emoji, forward and report sheets, hands quoting and editing to the composer, and closes its own menu", async () => {
    const { hook, sheets, composer } = await setup();
    const { sheet } = hook.result.current;
    sheet.onMoreReactions(message);
    sheet.onForward(message);
    sheet.onReport(message);
    sheet.onClose();
    sheet.onReply(message);
    sheet.onEdit(message);
    expect(sheets.mock.calls).toEqual([
      [{ type: "open", sheet: { kind: "emoji", message } }],
      [{ type: "open", sheet: { kind: "forward", messageId: "m1" } }],
      [{ type: "open", sheet: { kind: "report", messageId: "m1", senderId: "U2", name: "Bình" } }],
      [{ type: "close", kind: "actions" }],
    ]);
    expect(composer.reply).toHaveBeenCalledWith(message);
    expect(composer.edit).toHaveBeenCalledWith(message);
  });

  it("says a copy that failed", async () => {
    jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
    const { hook } = await setup();
    hook.result.current.sheet.onCopy(message);
    await flush();
    expect(lastToast()).toBe(viText("common.error"));
  });
});
