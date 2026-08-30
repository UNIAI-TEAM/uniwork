import { MsgType, type MatrixClient } from "matrix-js-sdk";
import { isServerMatrixEventId } from "./matrix-unread";

type SendCustomMatrixEvent = (
  roomId: string,
  type: string,
  content: Record<string, unknown>,
) => ReturnType<MatrixClient["sendEvent"]>;

export const DEFAULT_QUICK_REACTION = "👍";

export async function sendMatrixTextReply(
  client: MatrixClient,
  roomId: string,
  text: string,
  replyToEventId: string,
): Promise<void> {
  if (!isServerMatrixEventId(replyToEventId)) return;
  await client.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body: text,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: replyToEventId,
      },
    },
  });
}

export async function sendMatrixReaction(
  client: MatrixClient,
  roomId: string,
  targetEventId: string,
  emoji: string = DEFAULT_QUICK_REACTION,
): Promise<void> {
  if (!isServerMatrixEventId(targetEventId)) return;
  await (client.sendEvent as SendCustomMatrixEvent)(roomId, "m.reaction", {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: targetEventId,
      key: emoji,
    },
  });
}
