import { describe, expect, it } from "vitest";
import { runtimeFromExtra } from "./runtime-extra";

describe("runtimeFromExtra", () => {
  it("derives the ws(s) origin from the api origin and names the mobile platform", () => {
    expect(runtimeFromExtra({ apiUrl: "https://api.example", appUrl: "https://app.example" })).toEqual({
      apiUrl: "https://api.example",
      appUrl: "https://app.example",
      wsUrl: "wss://api.example",
      clientPlatform: "mobile",
    });
    expect(runtimeFromExtra({ apiUrl: "http://192.168.1.20:8080", appUrl: "http://192.168.1.20:3000" }).wsUrl).toBe(
      "ws://192.168.1.20:8080",
    );
  });

  it("falls back to the dev servers when extra is missing or malformed", () => {
    expect(runtimeFromExtra(undefined)).toMatchObject({ apiUrl: "http://localhost:8080", appUrl: "http://localhost:3000" });
    expect(runtimeFromExtra({ apiUrl: 42 })).toMatchObject({ apiUrl: "http://localhost:8080", wsUrl: "ws://localhost:8080" });
  });
});
