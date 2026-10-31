// The create-from-message sheet follows the web composer: the room sits ahead
// of the heading, priority starts at none, and a pill opens a list rather
// than creating the task on its own.
import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { CreateTaskSheet } from "./create-task-sheet";

async function open() {
  const onClose = jest.fn();
  const onCreate = jest.fn(async () => undefined);
  await render(
    <CreateTaskSheet
      visible
      messageId="m1"
      title="Đăng nhập"
      description="Làm form"
      count={1}
      context="longdev"
      onClose={onClose}
      onCreate={onCreate}
    />,
  );
  return { onClose, onCreate };
}

describe("CreateTaskSheet", () => {
  it("names the room and the heading, and starts with no priority", async () => {
    await open();
    expect(screen.getByText("longdev")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.link.create_task_title"))).toBeOnTheScreen();
    expect(screen.getByLabelText(viText("tasks.create.title_placeholder")).props.value).toBe("Đăng nhập");
    expect(screen.getByRole("button", { name: viText("tasks.priority_none") })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: viText("tasks.status_todo") })).toBeOnTheScreen();
  });

  it("sends the priority picked from the list, with status still to do", async () => {
    const { onCreate, onClose } = await open();
    await fireEvent.press(screen.getByRole("button", { name: viText("tasks.priority_none") }));
    await fireEvent.press(screen.getByRole("radio", { name: viText("tasks.priority_high") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("common.create") }));
    expect(onCreate).toHaveBeenCalledWith({
      title: "Đăng nhập",
      description: "Làm form",
      priority: "high",
      status: "todo",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
