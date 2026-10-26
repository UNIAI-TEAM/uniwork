// A send that fails while its room is open (use-send-failure-feedback.ts) is
// felt and said once; one already failed when the room opened, a retry that
// is still going, and a send that went say nothing.
import { AccessibilityInfo } from "react-native";
import * as Haptics from "expo-haptics";
import type { PendingSend } from "@/lib/send-pipeline";
import type { TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { useSendFailureFeedback } from "./use-send-failure-feedback";

const local = (id: string, status: PendingSend["status"]): TimelineMessage => ({
  id: `pending:${id}`,
  sender: "ME",
  body: "x",
  ts: 1,
  clientMsgId: id,
  pending: { workspaceId: "w1", roomId: "r1", senderId: "ME", clientMsgId: id, body: "x", createdAt: 1, status },
});
const sent: TimelineMessage = { id: "m1", sender: "ME", body: "y", ts: 2 };

function Probe({ messages }: { messages: TimelineMessage[] }) {
  useSendFailureFeedback(messages);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("useSendFailureFeedback", () => {
  it("feels and says a send that fails while the room is open, once", async () => {
    const { rerender } = await render(<Probe messages={[sent, local("c1", "sending")]} />);
    await rerender(<Probe messages={[sent, local("c1", "failed")]} />);
    await rerender(<Probe messages={[sent, local("c1", "failed")]} />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(viText("chat.send_failed"));
  });

  it("says nothing of a send failed before the room opened, a retry under way, or one that went", async () => {
    const { rerender } = await render(<Probe messages={[local("c1", "failed"), local("c2", "queued")]} />);
    await rerender(<Probe messages={[local("c1", "sending"), local("c2", "sending")]} />);
    await rerender(<Probe messages={[sent]} />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });
});
