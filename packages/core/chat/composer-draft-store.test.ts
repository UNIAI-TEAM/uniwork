import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import { resetRegisteredDraftsInMemory } from "../drafts/cleanup-registry";
import type { User } from "../types/user";
import { readChatComposerDraft, useChatComposerDraftStore } from "./composer-draft-store";

function user(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    display_name: id,
    onboarded_at: null,
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  };
}

beforeEach(() => {
  setSessionUser(user("u1"));
});

afterEach(() => {
  resetRegisteredDraftsInMemory();
  resetAuthStoreForTests();
});

describe("chat composer draft store", () => {
  it("keeps one draft per conversation and drops blank ones", () => {
    const { setDraft } = useChatComposerDraftStore.getState();
    setDraft("ws:dm:a", "chào");
    setDraft("ws:channel:c", "họp lúc 3h");
    expect(readChatComposerDraft("ws:dm:a")).toBe("chào");
    expect(readChatComposerDraft("ws:channel:c")).toBe("họp lúc 3h");
    setDraft("ws:dm:a", "");
    expect(useChatComposerDraftStore.getState().drafts).not.toHaveProperty("ws:dm:a");
  });

  it("refuses writes while signed out and forgets drafts when someone else signs in", () => {
    useChatComposerDraftStore.getState().setDraft("ws:workspace", "bí mật");
    setSessionUser(user("u2"));
    expect(readChatComposerDraft("ws:workspace")).toBe("");

    resetAuthStoreForTests();
    useChatComposerDraftStore.getState().setDraft("ws:workspace", "khi đã thoát");
    expect(readChatComposerDraft("ws:workspace")).toBe("");
  });
});
