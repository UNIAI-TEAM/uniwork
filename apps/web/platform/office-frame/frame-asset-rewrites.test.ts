import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { officeFrameAssetRewrites } from "./frame-asset-rewrites.mjs";

/**
 * The matcher Next's own router builds for a rewrite's `source`
 * (`getPathMatch`, next/dist/shared/lib/router/utils/path-match), with the
 * options Next passes when it checks rewrites
 * (`next/dist/server/server-utils.js` checkRewrite and
 * `next/dist/shared/lib/router/utils/resolve-rewrites.js`): `strict: true`
 * (no optional trailing delimiter — this config sets no `trailingSlash`, so
 * Next appends no `(/)?`), `removeUnnamedParams: true` (the numbered groups
 * the `:param(regex)` syntax adds do not leak into `params`), and
 * `sensitive` from `experimental.caseSensitiveRoutes` — unset here, so the
 * match is case-insensitive exactly as the app's router is. A match returns
 * the captured params object; a miss returns `false`.
 */
function routeMatcher(source: string) {
  return getPathMatch(source, { strict: true, removeUnnamedParams: true });
}

const DOC = "01M4KH88167D722JAC9EAPKN33";

function aiRule() {
  const rule = officeFrameAssetRewrites("https://api.example.test").find((r) => r.source.includes("/ai/"));
  expect(rule, "no rewrite maps the frame AI path to the API origin").toBeDefined();
  return routeMatcher(rule!.source);
}

describe("officeFrameAssetRewrites", () => {
  it("proxies the signed asset, linked and frame AI routes to the API origin", () => {
    const rules = officeFrameAssetRewrites("https://api.example.test/some/path");
    expect(rules).toEqual([
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/assets/:assetId([0-9A-HJKMNP-TV-Z]{26})",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/assets/:assetId",
      },
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/linked/:linkedId([0-9A-HJKMNP-TV-Z]{26})",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/linked/:linkedId",
      },
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/ai/:aiPath*",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/ai/:aiPath*",
      },
    ]);
  });

  it("proxies the frame AI routes, so the frame's same-origin POST reaches the API on a split-origin setup", () => {
    const matcher = aiRule();
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/uniwork/chat/completions`)).toEqual({
      documentId: DOC,
      aiPath: ["uniwork", "chat", "completions"],
    });
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/cloud`)).toEqual({ documentId: DOC, aiPath: ["cloud"] });
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/byok/openai/chat/completions`)).toEqual({
      documentId: DOC,
      aiPath: ["byok", "openai", "chat", "completions"],
    });
  });

  it("the frame AI rewrite matches ULID ids only, never a non-ULID document id or a non-frame path", () => {
    const matcher = aiRule();
    expect(matcher("/api/v1/office-frame/documents/not-a-ulid/ai/cloud")).toBe(false);
    expect(matcher("/api/v1/office-frame/documents/01M4KH88167D722JAC9EAPKN3I/ai/cloud")).toBe(false);
    expect(matcher("/api/v1/documents/01M4KH88167D722JAC9EAPKN33/ai/uniwork/chat/completions")).toBe(false);
    expect(matcher("/api/v1/documents/01M4KH88167D722JAC9EAPKN33/ai/cloud")).toBe(false);
  });

  it("routes exactly what Next routes: the previous hand-made RegExp disagreed with Next on these paths", () => {
    const matcher = aiRule();
    // The old `sourceMatcher` (`:aiPath*` -> `(.*)` under `^...$`, case-sensitive)
    // returned the quoted boolean; Next's `getPathMatch` is authoritative.
    // old: false — `(.*)` could not match without the `/` after `ai`.
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai`)).toEqual({ documentId: DOC });
    // old: true — `(.*)` matched the empty tail; `strict: true` rejects it.
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/`)).toBe(false);
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/cloud/`)).toBe(false);
    // old: false — the hand regex was case-sensitive; Next routes it (caseSensitiveRoutes unset).
    expect(matcher("/api/v1/office-frame/documents/01m4kh88167d722jac9eapkn33/ai/cloud")).toEqual({
      documentId: "01m4kh88167d722jac9eapkn33",
      aiPath: ["cloud"],
    });
    // Extra segments stay under the catch-all; a doubled slash never matches.
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai/cloud/extra`)).toEqual({
      documentId: DOC,
      aiPath: ["cloud", "extra"],
    });
    expect(matcher(`/api/v1/office-frame/documents/${DOC}/ai//cloud`)).toBe(false);
  });

  it("matches ULIDs only, so no other frame route (sign, open, content) goes through the app", () => {
    const [assets, linked] = officeFrameAssetRewrites("http://localhost:8080");
    expect(routeMatcher(assets!.source)(`/api/v1/office-frame/documents/${DOC}/assets/01M4KH881EA6RCD6K40C56YBTF`)).toEqual({
      documentId: DOC,
      assetId: "01M4KH881EA6RCD6K40C56YBTF",
    });
    expect(routeMatcher(assets!.source)(`/api/v1/office-frame/documents/${DOC}/assets/sign`)).toBe(false);
    expect(routeMatcher(assets!.source)(`/api/v1/office-frame/documents/${DOC}/content`)).toBe(false);
    expect(routeMatcher(linked!.source)(`/api/v1/office-frame/documents/${DOC}/linked/01M4KH881EA6RCD6K40C56YBTF`)).toEqual({
      documentId: DOC,
      linkedId: "01M4KH881EA6RCD6K40C56YBTF",
    });
    expect(routeMatcher(linked!.source)(`/api/v1/office-frame/documents/${DOC}/linked/not-a-ulid`)).toBe(false);
  });

  it("adds nothing for an unusable API URL", () => {
    expect(officeFrameAssetRewrites("not a url")).toEqual([]);
    expect(officeFrameAssetRewrites("")).toEqual([]);
  });
});
