// The tasks a message was turned into (task-card.tsx): each a link named by its id, title and status in the tasks'
// own words, opened on the web; a task not read yet shows its short id and a loading title.
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

describe("TaskCards", () => {
  it("names each task by its id, title and status, and opens it on the web", async () => {
    jest.spyOn(chatApi, "getTask").mockResolvedValue({ id: "t1", identifier: "UNI-7", title: "Ship it", status: "in_progress" } as never);
    await render(<TaskCards ctx={ctx} taskIds={["t1"]} own />);
    const link = await screen.findByRole("link", {
      name: `${viText("chat.link.open_task", { identifier: "UNI-7", title: "Ship it" })}, ${viText("tasks.status_in_progress")}`,
    });
    await fireEvent.press(link);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/app\.example\/acme\/hq\/.+t1/));
  });

  it("shows a task not read yet by its short id and a loading title", async () => {
    jest.spyOn(chatApi, "getTask").mockReturnValue(new Promise(() => undefined));
    await render(<TaskCards ctx={ctx} taskIds={["01J8X4TASKLONGID"]} own={false} />);
    expect(screen.getByRole("link", { name: viText("chat.link.open_task", { identifier: "01J8X4TA", title: viText("chat.link.task_loading") }) })).toBeOnTheScreen();
  });
});
