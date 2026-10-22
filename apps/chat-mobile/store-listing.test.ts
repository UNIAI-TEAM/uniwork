// store/listing.md is what review is answered from, app.config.ts what the binary carries: the two
// may not drift (audit "listing-permissions-drift", "ios-privacy-manifest"). The permission strings
// quoted for review are the ones the app shows, and the iOS privacy manifest declares exactly the
// data types the App Privacy column of the privacy table lists. The Android side of the permission
// table is held against the release manifest in android-manifest.test.ts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConfigContext } from "expo/config";
import createConfig, { IOS_PRIVACY_MANIFEST, USAGE_EN, USAGE_VI } from "./app.config";
import { PERSISTED_ROOM_TIMELINES, PERSISTED_THREAD_TIMELINES } from "./data/query-persister";

const listing = fs.readFileSync(path.join(__dirname, "store/listing.md"), "utf8");

/** The body rows of the first table after `heading`, split into trimmed cells. */
function tableRows(heading: string): string[][] {
  const section = listing.slice(listing.indexOf(heading));
  const start = section.indexOf("\n|") + 1;
  const end = section.indexOf("\n\n", start);
  return section
    .slice(start, end)
    .split("\n")
    .slice(2)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

describe("the listing's permission strings", () => {
  const rows = tableRows("## Quyền và chuỗi xin quyền");

  it("quote, for every iOS usage string, the Vietnamese and English text the app ships", () => {
    const quoted = new Map<string, string>();
    for (const [, platforms, , , strings] of rows) {
      const key = platforms?.match(/\b(NS\w+UsageDescription)\b/)?.[1];
      if (key) quoted.set(key, strings!);
    }
    expect([...quoted.keys()].sort()).toEqual(Object.keys(USAGE_VI).sort());
    for (const key of Object.keys(USAGE_VI) as (keyof typeof USAGE_VI)[]) {
      expect(quoted.get(key), key).toBe(`${USAGE_VI[key]} / ${USAGE_EN[key]}`);
    }
  });
});

// Apple's App Privacy names (the listing's column) → the privacy manifest's data type keys.
const APPLE_DATA_TYPES: Record<string, string> = {
  Name: "Name",
  "Email Address": "EmailAddress",
  "Emails or Text Messages": "EmailsOrTextMessages",
  "Photos or Videos": "PhotosorVideos",
  "Audio Data": "AudioData",
  "Other User Content": "OtherUserContent",
  "Device ID": "DeviceID",
  "Crash Data": "CrashData",
  "Performance Data": "PerformanceData",
  "User ID": "UserID",
  "Product Interaction": "ProductInteraction",
};

describe("the iOS privacy manifest", () => {
  it("is what the iOS build carries, and tracks nobody", () => {
    const config = createConfig({ config: {} } as ConfigContext);
    expect(config.ios?.privacyManifests).toBe(IOS_PRIVACY_MANIFEST);
    expect(IOS_PRIVACY_MANIFEST.NSPrivacyTracking).toBe(false);
    expect(IOS_PRIVACY_MANIFEST.NSPrivacyTrackingDomains).toEqual([]);
    expect(IOS_PRIVACY_MANIFEST.NSPrivacyCollectedDataTypes.every((entry) => !entry.NSPrivacyCollectedDataTypeTracking)).toBe(true);
  });

  // ITMS-91053: every required-reason API category with an approved reason code.
  it("gives a reason for each required-reason API category the app's own code and the manifest-less libraries touch", () => {
    expect(Object.fromEntries(IOS_PRIVACY_MANIFEST.NSPrivacyAccessedAPITypes.map((entry) => [entry.NSPrivacyAccessedAPIType, entry.NSPrivacyAccessedAPITypeReasons]))).toEqual({
      NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
      NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1", "3B52.1"],
      NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1"],
      NSPrivacyAccessedAPICategoryDiskSpace: ["E174.1"],
    });
  });

  it("collects what the listing's App Privacy column declares, linked and for the purpose it says", () => {
    const expected = new Map<string, { linked: boolean; purpose: string }>();
    for (const [, , apple] of tableRows("## Quyền riêng tư")) {
      const linked = !/Not Linked/.test(apple!);
      const purpose = /Analytics/.test(apple!) ? "Analytics" : "AppFunctionality";
      for (const [name, key] of Object.entries(APPLE_DATA_TYPES)) {
        if (!new RegExp(`\\b${name}\\b`).test(apple!)) continue;
        const seen = expected.get(key);
        // A type two rows declare must be declared the same way in both.
        if (seen) expect({ key, ...seen }).toEqual({ key, linked, purpose });
        expected.set(key, { linked, purpose });
      }
    }
    const declared = new Map(
      IOS_PRIVACY_MANIFEST.NSPrivacyCollectedDataTypes.map((entry) => [
        entry.NSPrivacyCollectedDataType.replace("NSPrivacyCollectedDataType", ""),
        { linked: entry.NSPrivacyCollectedDataTypeLinked, purpose: entry.NSPrivacyCollectedDataTypePurposes.map((p) => p.replace("NSPrivacyCollectedDataTypePurpose", "")).join() },
      ]),
    );
    expect(Object.fromEntries(declared)).toEqual(Object.fromEntries(expected));
  });
});

// Store metadata as code (scripts/store-metadata.mjs): generated from listing.md, never edited by hand.
describe("the generated store metadata", () => {
  it("is what scripts/store-metadata.mjs makes of listing.md", () => {
    expect(() => execFileSync(process.execPath, [path.join(__dirname, "scripts/store-metadata.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("is what EAS submits for the App Store, and says nothing of calls while iPhone has none", () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, "eas.json"), "utf8")) as { submit: Record<string, { ios?: { metadataPath?: string } }> };
    const metadataPath = eas.submit.production?.ios?.metadataPath ?? "";
    const apple = JSON.parse(fs.readFileSync(path.join(__dirname, metadataPath), "utf8")) as { apple: { info: Record<string, { subtitle: string; description: string; keywords: string[] }>; review: { notes: string } } };
    expect(Object.keys(apple.apple.info)).toEqual(["vi", "en-US"]);
    for (const info of Object.values(apple.apple.info)) {
      expect(`${info.subtitle}\n${info.description}\n${info.keywords.join(",")}`).not.toMatch(/gọi|call/i);
    }
    expect(apple.apple.review.notes).toContain("terms#acceptable-use");
    expect(apple.apple.review.notes).not.toMatch(/password: /i);
  });

  it("refuses copy over a store's limit", async () => {
    const { storeMetadata } = (await import("./scripts/store-metadata.mjs")) as { storeMetadata: (listing: string) => unknown };
    const long = listing.replace(/(\*\*en — subtitle:\*\*) .*/, "$1 A subtitle far longer than thirty characters");
    expect(() => storeMetadata(long)).toThrow(/en subtitle is \d+ characters, the store takes 30/);
    expect(() => storeMetadata(listing.replace("**en — description:**", "**en — nothing:**"))).toThrow(/no "\*\*en — description/);
  });
});

// Review is answered from this file (Apple 1.2: act on a report by removing the content and ejecting the user). Only
// the sender deletes a chat message (ChatService.DeleteChatMessage), and deactivating a member keeps everything they
// wrote visible (the F-03 lifecycle), so the listing may not offer deactivation as a way to take content down.
describe("the listing's moderation paragraph", () => {
  const moderation = listing.slice(listing.indexOf("Điều khoản sử dụng (`/terms`"), listing.indexOf("## Quyền và chuỗi xin quyền"));

  it("says deactivating the poster stops them but leaves their messages, and only a suspension hides content", () => {
    expect(moderation).not.toMatch(/gỡ nội dung nghĩa là vô hiệu hoá/);
    expect(moderation).toMatch(/vô hiệu hoá người đăng chặn họ lại nhưng tin họ đã gửi vẫn hiện/);
    expect(moderation).toMatch(/chỉ tạm ngưng tổ chức mới ẩn nội dung/);
  });
});

// The Data safety and App Privacy answers rest on the "Lưu trên máy" paragraph: it named 12 conversations after the
// persister kept 24, and left out the offline threads, queued edits and deletes, and drafts (review P2).
describe("the listing's on-device paragraph", () => {
  const onDevice = listing.slice(listing.indexOf("**Lưu trên máy"), listing.indexOf("Dữ liệu này không rời máy")).replace(/\s+/g, " ");

  it("names what the device keeps, with the persister's own numbers", () => {
    expect(onDevice).toContain(`trang tin mới nhất của ${PERSISTED_ROOM_TIMELINES} cuộc trò chuyện`);
    expect(onDevice).toContain(`${PERSISTED_THREAD_TIMELINES} chủ đề đọc gần nhất`);
    for (const kept of ["lượt đọc", "biểu cảm", "bình chọn", "sửa", "xoá tin", "bản nháp"]) expect(onDevice, kept).toContain(kept);
  });
});
