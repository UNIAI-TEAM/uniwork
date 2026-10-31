// The tasks a message was turned into (task-card.tsx): the board card — id, title and assignee — opened on the web.
// A task not read yet shows its short id and a loading title, and no assignee line.
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { fireEvent, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { chatApi } from "@/data/chat-api";
import { render, viText } from "@/test/render";
import type { MessageCardContext } from "./message-cards";
import { TaskCards } from "./task-card";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

const ctx = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", roomId: "r1", userId: "u1" } as MessageCardContext;

beforeEach(() => configureRuntime({ appUrl: "https://app.example" }));
afterEach(() => {
  resetRuntimeConfig();
  jest.restoreAllMocks();
});

const created = (taskId: string, linkId = "l1") => ({ taskId, linkId, relation: "created_from" });

describe("TaskCards", () => {
  it("shows the board card — id, title and assignee — and opens the task on the web", async () => {
    jest.spyOn(chatApi, "getTask").mockResolvedValue({
      id: "t1",
      identifier: "UNI-7",
      title: "Ship it",
      status: "in_progress",
      priority: "medium",
      assignee: { display_name: "Lan" },
    } as never);
    await render(<TaskCards ctx={ctx} links={[created("t1")]} own messageId="m1" />);
    expect(screen.getByText(viText("chat.link.card_created_from_yours"))).toBeOnTheScreen();
    const link = await screen.findByRole("link", { name: viText("chat.link.open_task", { identifier: "UNI-7", title: "Ship it" }) });
    expect(screen.getByText("UNI-7")).toBeOnTheScreen();
    expect(screen.getByText("Ship it")).toBeOnTheScreen();
    expect(screen.getByText("Lan")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: viText("chat.message_list.unlink_named", { identifier: "UNI-7", title: "Ship it" }) })).toBeOnTheScreen();
    expect(screen.queryByText(viText("tasks.status_in_progress"))).toBeNull();
    await fireEvent.press(link);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/app\.example\/acme\/hq\/.+t1/));
  });

  it("says the task is unassigned when nobody holds it", async () => {
    jest.spyOn(chatApi, "getTask").mockResolvedValue({ id: "t1", identifier: "ORI-3", title: "Hh", status: "todo", priority: "medium" } as never);
    await render(<TaskCards ctx={ctx} links={[created("t1")]} own={false} messageId="m1" />);
    expect(await screen.findByText(viText("tasks.unassigned"))).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.link.card_created_from_this"))).toBeOnTheScreen();
    expect(screen.queryByText(viText("tasks.status_todo"))).toBeNull();
  });

  it("shows a task not read yet by its short id and a loading title", async () => {
    jest.spyOn(chatApi, "getTask").mockReturnValue(new Promise(() => undefined));
    await render(<TaskCards ctx={ctx} links={[created("01J8X4TASKLONGID")]} own={false} messageId="m1" />);
    expect(screen.getByRole("link", { name: viText("chat.link.open_task", { identifier: "01J8X4TA", title: viText("chat.link.task_loading") }) })).toBeOnTheScreen();
    expect(screen.queryByText(viText("tasks.unassigned"))).toBeNull();
  });
});
