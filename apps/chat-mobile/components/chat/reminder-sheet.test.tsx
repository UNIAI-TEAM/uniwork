// Creating a reminder from the composer (reminder-sheet.tsx): nothing to send
// until there is something to be reminded of; a quick time and a repeat are one
// pick each; creating hands the body, the moment worked out at the tap and the
// repeat to the room, then clears and closes.
import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { ReminderSheet } from "./reminder-sheet";

const NOW = new Date("2026-10-22T02:00:00Z").getTime();

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
});
afterEach(() => {
  jest.useRealTimers();
});

async function open() {
  const onClose = jest.fn();
  const onCreate = jest.fn();
  await render(<ReminderSheet visible onClose={onClose} onCreate={onCreate} />);
  return { onClose, onCreate };
}

const submit = () => screen.getByTestId("reminder-create");

describe("ReminderSheet", () => {
  it("cannot create a reminder of nothing", async () => {
    const { onCreate } = await open();
    expect(submit().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(submit());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("creates in 30 minutes, once, by default; then clears and closes", async () => {
    const { onCreate, onClose } = await open();
    expect(screen.getByRole("radio", { name: viText("chat.reminder_preset_30m") }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.changeText(screen.getByLabelText(viText("chat.reminder_body_label")), "Gọi khách");
    await fireEvent.press(submit());
    expect(onCreate).toHaveBeenCalledWith({ body: "Gọi khách", remindAt: new Date(NOW + 30 * 60_000), repeat: "none" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(viText("chat.reminder_body_label")).props.value).toBe("");
  });

  it("takes another quick time and a repeat, one pick each", async () => {
    const { onCreate } = await open();
    await fireEvent.changeText(screen.getByLabelText(viText("chat.reminder_body_label")), "Standup");
    await fireEvent.press(screen.getByRole("radio", { name: viText("chat.reminder_preset_15m") }));
    await fireEvent.press(screen.getByRole("radio", { name: viText("chat.reminder_repeat_weekly") }));
    expect(screen.getByRole("radio", { name: viText("chat.reminder_preset_30m") }).props.accessibilityState).toEqual({ selected: false });
    await fireEvent.press(submit());
    expect(onCreate).toHaveBeenCalledWith({ body: "Standup", remindAt: new Date(NOW + 15 * 60_000), repeat: "weekly" });
  });

  it("closes from its close button without creating anything", async () => {
    const { onClose, onCreate } = await open();
    // The sheet's backdrop is a close button too; this is the one in the head.
    const close = screen.getAllByRole("button", { name: viText("common.close") }).at(-1);
    if (!close) throw new Error("no close button");
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
