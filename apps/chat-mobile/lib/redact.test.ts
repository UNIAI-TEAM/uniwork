import { describe, expect, it } from "vitest";
import { REDACTED, redactData, redactText, scrubBreadcrumb, scrubEvent, scrubTransaction } from "./redact";

describe("redactText", () => {
  // The cases of packages/core/analytics/redact-exception.test.ts that apply to a phone.
  it("redacts emails, URL queries and long opaque tokens like the web does", () => {
    expect(redactText("invalid email: an@example.com")).toBe(`invalid email: ${REDACTED}`);
    expect(redactText("GET https://api.example/v1/me?token=abc&x=1 failed")).toBe(`GET https://api.example/v1/me?${REDACTED} failed`);
    expect(redactText("jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 rejected")).toBe(`jwt ${REDACTED} rejected`);
    expect(redactText("short ids like room-42 stay")).toBe("short ids like room-42 stay");
  });

  it("redacts what a phone carries: bearer and Expo push tokens, the PKCE callback, socket URLs", () => {
    expect(redactText("Authorization: Bearer at_1.x")).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactText("token ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(`token ExponentPushToken[${REDACTED}]`);
    expect(redactText("uniworkchat://auth/callback?code=abc&state=def")).toBe(`uniworkchat://auth/callback?${REDACTED}`);
    expect(redactText("uniworkchat-dev://open#frag")).toBe(`uniworkchat-dev://open?${REDACTED}`);
    expect(redactText("wss://api.example/api/v1/ws?workspace_slug=a/b")).toBe(`wss://api.example/api/v1/ws?${REDACTED}`);
  });

  it("leaves what is not a non-empty string as it is", () => {
    expect(redactText("")).toBe("");
    expect(redactText(undefined)).toBeUndefined();
    expect(redactText(42)).toBe(42);
  });
});

describe("redactData", () => {
  it("redacts strings, keeps scalars and names objects by type only", () => {
    expect(redactData({ url: "https://a.example/x?y=1", status: 500, ok: false, none: null, body: { a: 1 }, list: [1] })).toEqual({
      url: `https://a.example/x?${REDACTED}`,
      status: 500,
      ok: false,
      none: null,
      body: "[object]",
      list: "[array]",
    });
    expect(redactData(undefined)).toBeUndefined();
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs the message and the data of a fetch breadcrumb", () => {
    expect(scrubBreadcrumb({ category: "fetch", message: "to a@b.co", data: { url: "https://a.example/me?t=1", status_code: 200 } })).toEqual({
      category: "fetch",
      message: `to ${REDACTED}`,
      data: { url: `https://a.example/me?${REDACTED}`, status_code: 200 },
    });
  });
});

describe("scrubEvent", () => {
  it("scrubs messages, exception values, breadcrumbs, the request and extra; the user keeps only the id", () => {
    const event = scrubEvent({
      message: "failed for a@b.co",
      exception: { values: [{ type: "ApiError", value: "GET https://a.example/x?code=1" }, { type: "Error" }] },
      breadcrumbs: [{ message: "Bearer abc" }],
      request: { url: "https://a.example/y?z=1", headers: { Authorization: "Bearer t" }, cookies: "c", data: "d" },
      user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
      extra: { note: "sent to a@b.co", nested: { a: 1 } },
      level: "error",
    });
    expect(event).toEqual({
      message: `failed for ${REDACTED}`,
      exception: { values: [{ type: "ApiError", value: `GET https://a.example/x?${REDACTED}` }, { type: "Error", value: undefined }] },
      breadcrumbs: [{ message: `Bearer ${REDACTED}`, data: undefined }],
      request: { url: `https://a.example/y?${REDACTED}` },
      user: { id: "u1" },
      extra: { note: `sent to ${REDACTED}`, nested: "[object]" },
      level: "error",
    });
  });

  it("drops a user without an id and leaves absent sections absent", () => {
    expect(scrubEvent({ user: { email: "a@b.co" } })).toEqual({ message: undefined, user: {} });
    expect(scrubEvent({ exception: {} })).toEqual({ message: undefined, exception: {} });
  });
});

describe("scrubTransaction", () => {
  it("scrubs a transaction as an event, and each span's description and data", () => {
    const out = scrubTransaction({
      message: "for a@b.co",
      spans: [
        { description: "GET https://api.example.com/api/v1/rooms/r1/search?q=lương", data: { url: "https://api.example.com/x?token=abc", "http.response.status_code": 200 } },
        { description: "ui.load" },
      ],
    });
    expect(out.message).toBe(`for ${REDACTED}`);
    expect(out.spans).toEqual([
      { description: `GET https://api.example.com/api/v1/rooms/r1/search?${REDACTED}`, data: { url: `https://api.example.com/x?${REDACTED}`, "http.response.status_code": 200 } },
      { description: "ui.load", data: undefined },
    ]);
    expect(scrubTransaction({})).toEqual({ message: undefined });
  });
});
