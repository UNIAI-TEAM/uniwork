import { describe, expect, it } from "vitest";
import type { ChatContact } from "./contacts-store";
import { dedupeDmContacts, mergeActiveDmContact } from "./hooks";

describe("dm contact dedupe", () => {
  const peer: ChatContact = {
    user_id: "01M14FBNCQ6BDQB5TRKJX35ESG",
    email: "longthl5@gmail.com",
    display_name: "tran hoang long",
    dm_room_id: "ROOM1",
  };

  it("dedupes contacts that only differ by missing email", () => {
    const sparse: ChatContact = {
      user_id: peer.user_id,
      email: "",
      display_name: peer.display_name,
      dm_room_id: peer.dm_room_id,
    };
    const out = dedupeDmContacts([sparse, peer]);
    expect(out).toHaveLength(1);
    expect(out[0]?.email).toBe(peer.email);
  });

  it("mergeActiveDmContact does not append a second row for the same peer", () => {
    const sparse: ChatContact = {
      user_id: peer.user_id,
      email: "",
      display_name: peer.display_name,
      dm_room_id: peer.dm_room_id,
    };
    const out = mergeActiveDmContact([sparse], peer, peer.dm_room_id ?? null);
    expect(out).toHaveLength(1);
    expect(out[0]?.email).toBe(peer.email);
  });
});
