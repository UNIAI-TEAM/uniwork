import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectUserMentionIds,
  collectUserMentions,
  DEFAULT_SANITIZE_LIMITS,
  DocumentContentError,
  sanitizePageContent,
  type SanitizeLimits,
} from "./schema";

// Parity test (C-01 §7.1; UNI-675): every fixture case in
// docs/parity/document-schema.json must produce identical results in the Go
// sanitizer (server/internal/document) and this mirror.

type FixtureLimits = Partial<SanitizeLimits>;

interface FixtureCase {
  name: string;
  input?: unknown;
  input_json?: string;
  options?: FixtureLimits;
  expect: { content?: unknown; text?: string; error?: string };
}

interface FixtureFile {
  defaults: SanitizeLimits;
  cases: FixtureCase[];
}

// vitest runs with cwd = packages/core.
const fixturePath = resolve(process.cwd(), "../../docs/parity/document-schema.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;

const mergeLimits = (defaults: SanitizeLimits, opt?: FixtureLimits): SanitizeLimits => ({
  maxInputBytes: opt?.maxInputBytes ?? defaults.maxInputBytes,
  maxBytes: opt?.maxBytes ?? defaults.maxBytes,
  maxDepth: opt?.maxDepth ?? defaults.maxDepth,
  maxNodes: opt?.maxNodes ?? defaults.maxNodes,
  maxTableRows: opt?.maxTableRows ?? defaults.maxTableRows,
  maxTableCols: opt?.maxTableCols ?? defaults.maxTableCols,
});

describe("document schema parity", () => {
  it("has fixture cases", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const limits = mergeLimits(fixture.defaults, c.options);
      const input = c.input_json !== undefined ? c.input_json : JSON.stringify(c.input);

      if (c.expect.error) {
        let thrown: unknown;
        try {
          sanitizePageContent(input, limits);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(DocumentContentError);
        expect((thrown as DocumentContentError).code).toBe(c.expect.error);
        return;
      }

      const result = sanitizePageContent(input, limits);
      expect(result.content).toEqual(c.expect.content);
      expect(result.text).toBe(c.expect.text);
    });
  }

  it("DEFAULT_SANITIZE_LIMITS matches the contract bounds", () => {
    expect(DEFAULT_SANITIZE_LIMITS).toEqual({
      maxInputBytes: 8 << 20,
      maxBytes: 2 << 20,
      maxDepth: 50,
      maxNodes: 50000,
      maxTableRows: 200,
      maxTableCols: 20,
    });
  });
});

describe("collectUserMentionIds (UNI-1968)", () => {
  const page = (mentions: { id: string; type?: string; kind?: string; label?: string }[]) => ({
    type: "doc",
    content: mentions.map((m) => ({
      type: "paragraph",
      content: [{ type: "mention", attrs: m }],
    })),
  });

  it("skips agent mentions on both attr vocabularies", () => {
    // attrs.type is the editor's spelling; attrs.kind is the legacy one. An
    // agent never notifies a person, so neither counts as a new mention.
    const ids = collectUserMentionIds(
      page([
        { id: "u-1", type: "agent", label: "Bot" },
        { id: "u-2", kind: "agent", label: "Bot" },
        { id: "u-3", type: "member", label: "An" },
      ]),
    );
    expect([...ids].sort()).toEqual(["u-3"]);
  });

  it("skips mentions without an id and ids dedupe", () => {
    const ids = collectUserMentionIds(page([{ id: "u-1", type: "member" }, { id: "u-1", type: "member" }, { id: "", type: "member" }]));
    expect([...ids]).toEqual(["u-1"]);
  });

  it("collectUserMentions maps id to the mention label", () => {
    const map = collectUserMentions(
      page([
        { id: "u-1", type: "member", label: "Bình" },
        { id: "u-2", type: "agent", label: "Bot" },
      ]),
    );
    expect(map.get("u-1")).toBe("Bình");
    expect(map.has("u-2")).toBe(false);
  });
});
