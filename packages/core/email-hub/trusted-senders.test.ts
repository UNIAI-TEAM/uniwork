import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultStorage } from "../platform/storage";
import {
  useEmailHubSenderTrust,
  useEmailHubTrustedSenders,
  useEmailHubTrustedSendersStore,
} from "./trusted-senders";

beforeEach(() => {
  useEmailHubTrustedSendersStore.setState({ senders: {} });
  defaultStorage.removeItem("uniwork_email_hub_trusted_senders");
});

describe("email hub trusted senders", () => {
  it("trusts a sender for one mailbox only, ignoring case", () => {
    const a = renderHook(() => useEmailHubSenderTrust("acc-a", "News@Shop.vn"));
    const b = renderHook(() => useEmailHubSenderTrust("acc-b", "news@shop.vn"));
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(a.result.current[0]).toBe(true);
    expect(renderHook(() => useEmailHubSenderTrust("acc-a", " news@shop.vn ")).result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(false);
  });

  it("stops trusting and lists what is left", () => {
    const store = useEmailHubTrustedSendersStore.getState();
    store.setTrusted("acc-a", "a@x.vn", true);
    store.setTrusted("acc-a", "b@x.vn", true);
    store.setTrusted("acc-a", "a@x.vn", true); // no duplicate
    const list = renderHook(() => useEmailHubTrustedSenders("acc-a"));
    expect(list.result.current).toEqual(["a@x.vn", "b@x.vn"]);
    act(() => useEmailHubTrustedSendersStore.getState().setTrusted("acc-a", "A@x.vn", false));
    expect(list.result.current).toEqual(["b@x.vn"]);
  });

  it("never trusts a missing address", () => {
    const trust = renderHook(() => useEmailHubSenderTrust("acc-a", ""));
    act(() => trust.result.current[1](true));
    expect(trust.result.current[0]).toBe(false);
    expect(useEmailHubTrustedSendersStore.getState().senders).toEqual({});
  });

  it("persists through the storage adapter", () => {
    useEmailHubTrustedSendersStore.getState().setTrusted("acc-a", "a@x.vn", true);
    const raw = defaultStorage.getItem("uniwork_email_hub_trusted_senders");
    expect(JSON.parse(raw ?? "{}").state).toEqual({ senders: { "acc-a": ["a@x.vn"] } });
  });
});
