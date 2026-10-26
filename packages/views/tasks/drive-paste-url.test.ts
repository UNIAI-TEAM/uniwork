import { describe, expect, it } from "vitest";
import {
  extractDriveFileIdsFromPaste,
  parseDriveFileUrl,
} from "./drive-paste-url";

describe("parseDriveFileUrl", () => {
  it("parses Google Docs, Sheets, and Slides URLs with https", () => {
    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123-456/edit",
      ),
    ).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz_0123-456");

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/spreadsheets/d/1SheetId_1234567890_abcdef/edit?usp=sharing#gid=0",
      ),
    ).toBe("1SheetId_1234567890_abcdef");

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/presentation/d/1Slide-Id-999-AbCdEfGhIjKl/view",
      ),
    ).toBe("1Slide-Id-999-AbCdEfGhIjKl");
  });

  it("parses drive.google.com/file/d/<id> URLs", () => {
    expect(
      parseDriveFileUrl(
        "https://drive.google.com/file/d/1xYzFileId_42_AbCdEfGhIj/view?usp=drive_link",
      ),
    ).toBe("1xYzFileId_42_AbCdEfGhIj");
  });

  it("handles scheme-less URLs, /u/0/ user indices, trailing slashes, queries, and hashes", () => {
    expect(
      parseDriveFileUrl("docs.google.com/document/d/1DocNoScheme_0123456789"),
    ).toBe("1DocNoScheme_0123456789");

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/u/0/d/1DocU0_AbCdEfGhIjKlMnOp/edit?tab=t.0#heading=h.123",
      ),
    ).toBe("1DocU0_AbCdEfGhIjKlMnOp");

    expect(
      parseDriveFileUrl(
        "https://drive.google.com/file/u/2/d/1FileU2_AbCdEfGhIjKlMnOp/preview",
      ),
    ).toBe("1FileU2_AbCdEfGhIjKlMnOp");

    expect(
      parseDriveFileUrl(
        "drive.google.com/u/1/file/d/1FileU1Prefix_0123456789/",
      ),
    ).toBe("1FileU1Prefix_0123456789");
  });

  it("returns null for folders, open?id=, other Google paths, and other hosts", () => {
    expect(
      parseDriveFileUrl(
        "https://drive.google.com/drive/folders/1FolderIdHere?usp=sharing",
      ),
    ).toBeNull();

    expect(
      parseDriveFileUrl("https://drive.google.com/drive/u/0/folders/1FolderId"),
    ).toBeNull();

    expect(
      parseDriveFileUrl("https://drive.google.com/open?id=1OpenId"),
    ).toBeNull();

    expect(
      parseDriveFileUrl("https://docs.google.com/forms/d/1FormId/viewform"),
    ).toBeNull();

    expect(
      parseDriveFileUrl(
        "https://evil.example.com/https://docs.google.com/document/d/1FakeId/edit",
      ),
    ).toBeNull();

    expect(
      parseDriveFileUrl(
        "https://docs.google.com.evil.com/document/d/1FakeId/edit",
      ),
    ).toBeNull();

    expect(
      parseDriveFileUrl("ftp://docs.google.com/document/d/1FakeId/edit"),
    ).toBeNull();

    expect(parseDriveFileUrl("https://docs.google.com/document/d/")).toBeNull();
    expect(parseDriveFileUrl("")).toBeNull();
    expect(parseDriveFileUrl("not a url at all")).toBeNull();
  });

  it("rejects published-to-web URLs (/d/e/<pubId>/pub), short IDs (< 20 chars), userinfo URLs, and overlong tokens", () => {
    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/d/e/2PACX-1vSomePublishedIdHere1234567890/pub",
      ),
    ).toBeNull();

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vPublishedSheetId1234567890/pubhtml",
      ),
    ).toBeNull();

    // ID shorter than 20 characters (19 chars) is rejected; 20 characters is accepted
    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/d/1234567890123456789/edit",
      ),
    ).toBeNull();
    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/d/12345678901234567890/edit",
      ),
    ).toBe("12345678901234567890");

    // Userinfo host spoofing (`docs.google.com@evil.com/...`)
    expect(
      parseDriveFileUrl(
        "https://docs.google.com@evil.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
      ),
    ).toBeNull();

    // Overlong candidate (> 2048 chars)
    expect(
      parseDriveFileUrl(
        `https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit?pad=${"a".repeat(2500)}`,
      ),
    ).toBeNull();
  });
});

describe("extractDriveFileIdsFromPaste", () => {
  it("extracts distinct Drive file IDs in order from plain text and HTML", () => {
    const text = [
      "Check https://docs.google.com/document/d/1DocAlpha_0123456789abcd/edit,",
      "and (drive.google.com/file/d/1FileBeta_0123456789abcd/view?usp=sharing).",
      "Duplicate: https://docs.google.com/document/u/0/d/1DocAlpha_0123456789abcd/preview",
      "Published ignored: https://docs.google.com/document/d/e/2PACX-1vSomePublishedIdHere1234567890/pub",
      "Folder ignored: https://drive.google.com/drive/folders/1FolderId_0123456789abcd",
    ].join(" ");
    const html =
      '<p>Also <a href="https://docs.google.com/spreadsheets/d/1SheetGamma_0123456789ab/edit">budget</a></p>';

    expect(extractDriveFileIdsFromPaste(text, html)).toEqual([
      "1DocAlpha_0123456789abcd",
      "1FileBeta_0123456789abcd",
      "1SheetGamma_0123456789ab",
    ]);
  });

  it("returns empty array when no Drive file URLs are present", () => {
    expect(
      extractDriveFileIdsFromPaste(
        "Just https://example.com and https://drive.google.com/drive/folders/abc",
        '<a href="https://github.com/org/repo">repo</a>',
      ),
    ).toEqual([]);
  });

  it("parses a 100k-character pathological punctuation token in < 200 ms without quadratic backtracking", () => {
    const pathological = `https://docs.google.com/${".".repeat(100_000)}x https://docs.google.com/document/d/1ValidAfterPathological_01/edit`;
    const start = performance.now();
    const ids = extractDriveFileIdsFromPaste(pathological);
    const elapsedMs = performance.now() - start;

    expect(ids).toEqual(["1ValidAfterPathological_01"]);
    expect(elapsedMs).toBeLessThan(200);
  });
});
