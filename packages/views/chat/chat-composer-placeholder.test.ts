import { describe, expect, it } from "vitest";
import { chatComposerBlockProps } from "./chat-composer-placeholder";

const t = (key: string) => key;
const open = { dmBlocked: false, chatSendMutedByModerator: false, chatSendRestricted: false };

describe("chatComposerBlockProps", () => {
  it("has no read-only reason while sending is open", () => {
    expect(chatComposerBlockProps(t, open)).toEqual({ placeholder: "chat.message_placeholder" });
  });

  it("names the same reason as the placeholder, block first", () => {
    expect(chatComposerBlockProps(t, { ...open, dmBlocked: true, chatSendRestricted: true })).toEqual({
      placeholder: "chat.block_composer_placeholder",
      readOnlyReason: "blocked",
    });
    expect(chatComposerBlockProps(t, { ...open, chatSendMutedByModerator: true, chatSendRestricted: true })).toEqual({
      placeholder: "chat.mute_composer_placeholder",
      readOnlyReason: "muted",
    });
    expect(chatComposerBlockProps(t, { ...open, chatSendRestricted: true })).toEqual({
      placeholder: "chat.room_send_forbidden_placeholder",
      readOnlyReason: "restricted",
    });
  });
});
