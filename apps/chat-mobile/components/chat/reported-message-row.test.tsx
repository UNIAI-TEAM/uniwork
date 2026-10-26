import { act, fireEvent, screen } from "@testing-library/react-native";
import { useReportedMessagesStore } from "@/data/stores/reported-messages-store";
import { render, viText } from "@/test/render";
import { ReportedMessageRow, useReportedHidden } from "./reported-message-row";

function Probe({ id }: { id: string }) {
  return useReportedHidden(id) ? <ReportedMessageRow messageId={id} /> : null;
}

afterEach(() => useReportedMessagesStore.getState().clearAll());

describe("ReportedMessageRow", () => {
  it("stands in for a message this person reported until they choose to see it", async () => {
    await render(<Probe id="m1" />);
    expect(screen.queryByTestId("reported-message-m1")).toBeNull();
    await act(() => useReportedMessagesStore.getState().hide("m1"));
    expect(screen.getByText(viText("mobile.report.hidden"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.report.show") }));
    expect(screen.queryByTestId("reported-message-m1")).toBeNull();
    expect(useReportedMessagesStore.getState().revealed).toEqual({ m1: true });
  });
});
