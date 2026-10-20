import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatTypingBubble } from "./native-chat-typing-bubble";

beforeAll(() => {
  initI18n();
});

const NAMES = [{ user_id: "01abc", display_name: "Võ Minh" }];

describe("ChatTypingBubble", () => {
  it("draws nothing while nobody types", () => {
    const { container } = render(wrap(<ChatTypingBubble userIds={[]} nameContext={NAMES} />));
    expect(container).toBeEmptyDOMElement();
  });

  it("names the typer from the upper-cased typing id and shows their face", () => {
    render(wrap(<ChatTypingBubble userIds={["01ABC"]} nameContext={NAMES} />));
    expect(screen.getByText("Võ Minh đang nhập…")).toBeInTheDocument();
    expect(screen.getByText("VM")).toBeInTheDocument();
  });
});
