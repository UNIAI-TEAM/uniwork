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
        "https://docs.google.com/spreadsheets/d/sheet_id_123/edit?usp=sharing#gid=0",
      ),
    ).toBe("sheet_id_123");

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/presentation/d/slide-id-999/view",
      ),
    ).toBe("slide-id-999");
  });

  it("parses drive.google.com/file/d/<id> URLs", () => {
    expect(
      parseDriveFileUrl(
        "https://drive.google.com/file/d/1xYzFileId_42/view?usp=drive_link",
      ),
    ).toBe("1xYzFileId_42");
  });

  it("handles scheme-less URLs, /u/0/ user indices, trailing slashes, queries, and hashes", () => {
    expect(
      parseDriveFileUrl("docs.google.com/document/d/doc_no_scheme"),
    ).toBe("doc_no_scheme");

    expect(
      parseDriveFileUrl(
        "https://docs.google.com/document/u/0/d/doc_u0/edit?tab=t.0#heading=h.123",
      ),
    ).toBe("doc_u0");

    expect(
      parseDriveFileUrl(
        "https://drive.google.com/file/u/2/d/file_u2/preview",
      ),
    ).toBe("file_u2");

    expect(
      parseDriveFileUrl("drive.google.com/u/1/file/d/file_u1_prefix/"),
    ).toBe("file_u1_prefix");
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
});

describe("extractDriveFileIdsFromPaste", () => {
  it("extracts distinct Drive file IDs in order from plain text and HTML", () => {
    const text = [
      "Check https://docs.google.com/document/d/doc_alpha/edit,",
      "and (drive.google.com/file/d/file_beta/view?usp=sharing).",
      "Duplicate: https://docs.google.com/document/u/0/d/doc_alpha/preview",
      "Folder ignored: https://drive.google.com/drive/folders/folder_123",
    ].join(" ");
    const html =
      '<p>Also <a href="https://docs.google.com/spreadsheets/d/sheet_gamma/edit">budget</a></p>';

    expect(extractDriveFileIdsFromPaste(text, html)).toEqual([
      "doc_alpha",
      "file_beta",
      "sheet_gamma",
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
});
