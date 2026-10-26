// The long-press action sheet (action-sheet.tsx): its rows sit in a body that
// scrolls only when they outgrow the capped sheet, and then the sheet drags
// from its grabber so a drag on the rows scrolls them.
import { fireEvent, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { render, viText } from "@/test/render";
import { ActionSheet, type SheetAction } from "./action-sheet";
import { BottomSheet } from "./bottom-sheet";

jest.mock("./bottom-sheet", () => {
  const actual = jest.requireActual<typeof import("./bottom-sheet")>("./bottom-sheet");
  return { BottomSheet: jest.fn(actual.BottomSheet) };
});

const actions = (onPress = jest.fn()): SheetAction[] =>
  Array.from({ length: 8 }, (_, index) => ({ key: `a${index}`, label: `Hàng ${index}`, icon: "pin-outline", onPress, destructive: index === 7 }));

const lastSheetProps = () => jest.mocked(BottomSheet).mock.calls.at(-1)?.[0];
const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
  jest.mocked(BottomSheet).mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe("ActionSheet", () => {
  it("caps the sheet below the top of the screen and drags it from anywhere while its rows fit", async () => {
    await render(<ActionSheet visible onClose={jest.fn()} title="Phòng" actions={actions()} />);
    expect(screen.getByRole("header")).toHaveTextContent("Phòng");
    const body = screen.getByTestId("action-sheet-body");
    await fireEvent(body, "layout", layout(400));
    await fireEvent(body, "contentSizeChange", 390, 400);
    expect(screen.getByTestId("action-sheet-body").props.scrollEnabled).toBe(false);
    expect(lastSheetProps()).toEqual(expect.objectContaining({ sizeClassName: "max-h-[85%]", dragFrom: "panel" }));
  });

  it("scrolls rows that outgrow the sheet, every one still reachable, and hands the drag to the grabber", async () => {
    await render(<ActionSheet visible onClose={jest.fn()} actions={actions()} />);
    await fireEvent(screen.getByTestId("action-sheet-body"), "layout", layout(300));
    await fireEvent(screen.getByTestId("action-sheet-body"), "contentSizeChange", 390, 416);
    expect(screen.getByTestId("action-sheet-body").props.scrollEnabled).toBe(true);
    expect(lastSheetProps()).toEqual(expect.objectContaining({ dragFrom: "handle" }));
    expect(screen.getByRole("button", { name: "Hàng 7" })).toBeOnTheScreen();
  });

  it("closes, then runs a row's action (Android runs it at once)", async () => {
    const onPress = jest.fn();
    const onClose = jest.fn();
    await render(<ActionSheet visible onClose={onClose} actions={actions(onPress)} />);
    await fireEvent.press(screen.getByRole("button", { name: "Hàng 2" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("waits on iOS until the sheet is gone before it runs the action", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const onPress = jest.fn();
    await render(<ActionSheet visible onClose={jest.fn()} actions={actions(onPress)} />);
    await fireEvent.press(screen.getByRole("button", { name: "Hàng 1" }));
    expect(onPress).not.toHaveBeenCalled();
    lastSheetProps()?.onDismiss?.();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("draws round tiles in the tiles layout, inside the same body", async () => {
    const onPress = jest.fn();
    const tiles: SheetAction[] = [
      { key: "photo", label: "Ảnh", onPress, tint: "green", icon: "image" },
      { key: "file", label: "Tệp", onPress },
    ];
    await render(<ActionSheet visible onClose={jest.fn()} label="Đính kèm" layout="tiles" actions={tiles} />);
    await fireEvent.press(screen.getByRole("button", { name: "Tệp" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("action-sheet-body")).toBeOnTheScreen();
  });
});
