// The sticker and GIF picker (expression-sheet.tsx): stickers first; a search
// asks once per pause in typing, not per letter; a tap closes the sheet and
// sends the pick as the body the web sends; the GIF tab has its own empty line;
// nothing is asked while the sheet is closed.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { chatApi } from "@/data/chat-api";
import { render, viText } from "@/test/render";
import { ExpressionSheet } from "./expression-sheet";

jest.mock("@/data/chat-api", () => ({ chatApi: { listExpressions: jest.fn() } }));

const wave = { id: "s1", label: "wave", url: "https://media.tenor.com/w.gif", previewUrl: "https://media.tenor.com/w-small.gif" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(chatApi.listExpressions).mockImplementation(async (_ws, kind) => (kind === "stickers" ? [wave] : []));
});

describe("ExpressionSheet", () => {
  it("asks for nothing while closed", async () => {
    await render(<ExpressionSheet wsId="w1" visible={false} onClose={jest.fn()} onPick={jest.fn()} />);
    expect(chatApi.listExpressions).not.toHaveBeenCalled();
  });

  it("shows the trending stickers, and a tap closes and sends the sticker body", async () => {
    const onClose = jest.fn();
    const onPick = jest.fn();
    await render(<ExpressionSheet wsId="w1" visible onClose={onClose} onPick={onPick} />);
    expect(screen.getByRole("tab", { name: viText("chat.expression_tab_sticker") }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(await screen.findByRole("button", { name: "wave" }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith("![sticker:wave](https://media.tenor.com/w.gif)");
  });

  it("searches once the typing pauses, and the GIF tab says when nothing matches", async () => {
    jest.useFakeTimers();
    try {
      await render(<ExpressionSheet wsId="w1" visible onClose={jest.fn()} onPick={jest.fn()} />);
      const field = screen.getByLabelText(viText("chat.expression_search_stickers"));
      await fireEvent.changeText(field, "h");
      await fireEvent.changeText(field, "hi");
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => expect(chatApi.listExpressions).toHaveBeenCalledWith("w1", "stickers", "hi"));
      expect(chatApi.listExpressions).not.toHaveBeenCalledWith("w1", "stickers", "h");
      await fireEvent.press(screen.getByRole("tab", { name: viText("chat.expression_tab_gif") }));
      expect(await screen.findByText(viText("chat.expression_gifs_empty"))).toBeOnTheScreen();
      expect(screen.getByLabelText(viText("chat.expression_search_gifs"))).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows a spinner while the first page is on its way, and the sticker empty line after", async () => {
    let answer: (items: never[]) => void = () => undefined;
    jest.mocked(chatApi.listExpressions).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<ExpressionSheet wsId="w1" visible onClose={jest.fn()} onPick={jest.fn()} />);
    expect(screen.getByLabelText(viText("common.loading"))).toBeOnTheScreen();
    await act(async () => answer([]));
    expect(await screen.findByText(viText("chat.expression_stickers_empty"))).toBeOnTheScreen();
  });

  it("sends a GIF as a GIF", async () => {
    jest.mocked(chatApi.listExpressions).mockResolvedValue([{ ...wave, id: "g1", label: "dance" }]);
    const onPick = jest.fn();
    await render(<ExpressionSheet wsId="w1" visible onClose={jest.fn()} onPick={onPick} />);
    await fireEvent.press(screen.getByRole("tab", { name: viText("chat.expression_tab_gif") }));
    await fireEvent.press(await screen.findByRole("button", { name: "dance" }));
    expect(onPick).toHaveBeenCalledWith("![gif:dance](https://media.tenor.com/w.gif)");
  });
});
