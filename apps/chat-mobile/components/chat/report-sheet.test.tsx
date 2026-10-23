import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { safetyApi } from "@/data/safety-api";
import { useReportedMessagesStore } from "@/data/stores/reported-messages-store";
import { useToastStore } from "@/data/stores/toast-store";
import { i18n } from "@/lib/i18n/singleton";
import { render, viText } from "@/test/render";
import { ReportSheet } from "./report-sheet";

jest.mock("@/data/safety-api", () => ({ safetyApi: { report: jest.fn(), block: jest.fn(), unblock: jest.fn(), blockStatus: jest.fn() } }));

const report = jest.mocked(safetyApi.report);
const block = jest.mocked(safetyApi.block);
const messages = () => useToastStore.getState().toasts.map((t) => t.message);
const message = { kind: "message" as const, messageId: "m1", name: "Bình" };

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  report.mockResolvedValue({ id: "rep1", status: "open" });
  block.mockResolvedValue(true);
});
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
  useReportedMessagesStore.getState().clearAll();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("ReportSheet", () => {
  it("asks for a reason before it sends anything", async () => {
    await render(<ReportSheet wsId="w1" target={message} onClose={jest.fn()} />);
    expect(screen.getByRole("header", { name: viText("mobile.report.title_message") })).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.report.body", { name: "Bình" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.report.pick_reason"));
    expect(report).not.toHaveBeenCalled();
    // Picking a reason clears the prompt.
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_spam") }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The server's audit row names the reporter and every owner and admin reads
  // the activity log, so the sheet may not promise the reporter is hidden from
  // the person reported (who may be an owner or admin).
  it("says owners and admins see who sent the report, in both languages", () => {
    const vi = viText("mobile.report.body", { name: "Bình" });
    const en = i18n.getFixedT("en")("mobile.report.body", { name: "Bình" });
    expect(vi).toContain("Chủ sở hữu và quản trị viên");
    expect(vi).toContain("kể cả ai đã gửi");
    expect(vi).not.toContain("không biết ai đã báo cáo");
    expect(en).toContain("owners and admins");
    expect(en).toContain("including who sent it");
    expect(en).not.toContain("won't know who reported");
  });

  it("sends the message, the reason and the words, then thanks the reporter", async () => {
    const onClose = jest.fn();
    const onReported = jest.fn();
    await render(<ReportSheet wsId="w1" target={message} blockUserId="u2" onClose={onClose} onReported={onReported} />);
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_harassment") }));
    expect(screen.getByRole("radio", { name: viText("mobile.report.reason_harassment") })).toBeChecked();
    await fireEvent.changeText(screen.getByLabelText(viText("mobile.report.details_label")), "  nhắn nhiều lần  ");
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(report).toHaveBeenCalledWith("w1", { message_id: "m1", reason: "harassment", details: "nhắn nhiều lần" });
    expect(block).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReported).toHaveBeenCalledWith(false);
    expect(messages()).toEqual([viText("mobile.report.sent")]);
    // The reporter stops seeing the message at once (Apple 1.2).
    expect(Object.keys(useReportedMessagesStore.getState().reported)).toEqual(["m1"]);
  });

  it("blocks the person in the same step when asked", async () => {
    const onReported = jest.fn();
    await render(<ReportSheet wsId="w1" target={{ kind: "user", userId: "u2", name: "Bình" }} blockUserId="u2" onClose={jest.fn()} onReported={onReported} />);
    expect(screen.getByRole("header", { name: viText("mobile.report.title_user", { name: "Bình" }) })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_spam") }));
    await fireEvent(screen.getByRole("switch", { name: viText("mobile.report.also_block", { name: "Bình" }) }), "valueChange", true);
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(report).toHaveBeenCalledWith("w1", { user_id: "u2", reason: "spam" });
    expect(block).toHaveBeenCalledWith("w1", "u2");
    expect(onReported).toHaveBeenCalledWith(true);
    expect(messages()).toEqual([viText("mobile.report.sent_blocked", { name: "Bình" })]);
  });

  it("a failed block still leaves the report sent", async () => {
    block.mockResolvedValueOnce(false);
    const onReported = jest.fn();
    await render(<ReportSheet wsId="w1" target={message} blockUserId="u2" onClose={jest.fn()} onReported={onReported} />);
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_other") }));
    await fireEvent(screen.getByRole("switch"), "valueChange", true);
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(onReported).toHaveBeenCalledWith(false);
    expect(messages()).toEqual([viText("mobile.report.sent")]);
  });

  it("keeps the sheet and says so when the report does not go", async () => {
    report.mockRejectedValueOnce(new Error("offline"));
    const onClose = jest.fn();
    await render(<ReportSheet wsId="w1" target={message} onClose={onClose} />);
    expect(screen.queryByRole("switch")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_violence") }));
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("mobile.report.failed"));
    expect(onClose).not.toHaveBeenCalled();
    // A report that did not go hides nothing.
    expect(useReportedMessagesStore.getState().reported).toEqual({});
  });

  it("ignores taps while sending, and cancel forgets the choice", async () => {
    let finish: () => void = () => {};
    report.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({ id: "r", status: "open" }))));
    const onClose = jest.fn();
    await render(<ReportSheet wsId="w1" target={message} onClose={onClose} />);
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_hate") }));
    await fireEvent.press(screen.getByTestId("report-submit"));
    await fireEvent.press(screen.getByTestId("report-submit"));
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(report).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel closes and the next report starts empty; no target shows nothing", async () => {
    const onClose = jest.fn();
    const view = await render(<ReportSheet wsId="w1" target={message} onClose={onClose} />);
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_sexual") }));
    await fireEvent.press(screen.getByRole("button", { name: viText("common.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: viText("mobile.report.reason_sexual") })).not.toBeChecked();
    await view.rerender(<ReportSheet wsId="w1" target={null} onClose={onClose} />);
    expect(screen.queryByTestId("report-submit")).toBeNull();
  });
});
