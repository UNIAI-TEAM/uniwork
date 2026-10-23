import { describe, expect, it } from "vitest";
import { AUTOSTART_BRANDS, AUTOSTART_HINT_KEYS, backgroundCallsAdvice } from "./background-delivery";

describe("backgroundCallsAdvice", () => {
  it("asks for the battery page when Android optimizes or restricts UniChat", () => {
    expect(backgroundCallsAdvice({ batteryOptimized: true, backgroundRestricted: false, autostartBrand: "" })).toEqual({ battery: true, autostart: null });
    expect(backgroundCallsAdvice({ batteryOptimized: false, backgroundRestricted: true, autostartBrand: "" }).battery).toBe(true);
    expect(backgroundCallsAdvice({ batteryOptimized: false, backgroundRestricted: false, autostartBrand: "" })).toEqual({ battery: false, autostart: null });
  });

  it("names a vendor with an autostart switch, and nothing for any other brand or a report it cannot read", () => {
    for (const brand of AUTOSTART_BRANDS) expect(backgroundCallsAdvice({ autostartBrand: brand }).autostart).toBe(brand);
    expect(backgroundCallsAdvice({ autostartBrand: "samsung" }).autostart).toBeNull();
    expect(backgroundCallsAdvice(null)).toEqual({ battery: false, autostart: null });
    expect(backgroundCallsAdvice({ batteryOptimized: "yes" }).battery).toBe(false);
  });

  it("has the vendor's own steps for every brand", () => {
    expect(Object.keys(AUTOSTART_HINT_KEYS).sort()).toEqual([...AUTOSTART_BRANDS].sort());
  });
});
