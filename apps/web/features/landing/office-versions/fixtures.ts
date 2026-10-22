/**
 * DESIGN-ONLY (UNI-2098 Step 1): a fixture of the release manifest, schema v1,
 * and the `?state=` switch that screenshots use. Step 2 deletes this file and
 * `manifest-source.ts` reads `/downloads/office/releases.json` instead.
 */
import type { Release, ReleaseAsset, ReleasesManifest } from "./manifest";

export type DesignState = "loading" | "error" | "empty" | "update";

/** Read in an effect only, so the server's HTML and the first client render agree. */
export function readDesignState(): DesignState | null {
  const value = new URLSearchParams(window.location.search).get("state");
  return value === "loading" || value === "error" || value === "empty" || value === "update" ? value : null;
}

const BASE = "https://uniworkos.com/downloads/office";
/** A stable-looking 64 hex digits per seed: enough for a layout, never a real checksum. */
function hex(seed: string): string {
  let state = 2166136261;
  let out = "";
  while (out.length < 64) {
    for (const char of seed + out.length) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    out += state.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

function assets(version: string, channel: string): ReleaseAsset[] {
  const asset = (platform: ReleaseAsset["platform"], arch: ReleaseAsset["arch"], kind: ReleaseAsset["kind"], file: string, mb: number, signed: boolean): ReleaseAsset =>
    ({ platform, arch, kind, file, url: `${BASE}/${channel}/${version}/${file}`, size: Math.round(mb * 1048576), sha256: hex(file), signed });
  return [
    asset("win32", "x64", "nsis", `UniWork-Office-${version}-x64.exe`, 94.8, false),
    asset("darwin", "arm64", "dmg", `UniWork-Office-${version}-arm64.dmg`, 108.2, true),
    asset("darwin", "x64", "dmg", `UniWork-Office-${version}-x64.dmg`, 112.4, true),
    asset("linux", "x64", "deb", `uniwork-office_${version}_amd64.deb`, 82.6, true),
    asset("linux", "x64", "appimage", `UniWork-Office-${version}-x64.AppImage`, 118.3, true),
    asset("all", "all", "checksums", "SHA256SUMS", 0.001, false),
  ];
}

const NOTES = {
  vi: {
    a: "### Mới\n- **Tab Phiên bản** trong trình soạn thảo: xem, so sánh và khôi phục bản cũ của tài liệu.\n- Mở file `.xlsx` lớn nhanh hơn, không còn khựng khi cuộn.\n\n### Đã sửa\n- Lưu lại tài liệu DOCX không còn mất định dạng bảng lồng nhau.\n- Chữ ký PDF hiện đúng tên người ký.\n\nChi tiết xem tại [trang Phiên bản](/apps/office/versions).",
    b: "### Mới\n- Bảng tính: lọc theo nhiều điều kiện cùng lúc.\n\n### Đã sửa\n- Sửa lỗi đóng ứng dụng khi mở PDF có mật khẩu.",
    c: "### Mới\n- Thanh trạng thái hiển thị tiến độ đồng bộ với workspace.\n- Thêm phím tắt `Ctrl+Shift+V` để dán không định dạng.",
    d: "### Mới\n1. Trợ lý AI nhớ ngữ cảnh của tài liệu đang mở.\n2. Xuất DOCX sang PDF qua dịch vụ Office của UniWork.\n\n### Đã sửa\n- Con trỏ nhảy về đầu dòng khi gõ tiếng Việt có dấu.",
  },
  en: {
    a: "### New\n- **Versions tab** in the editors: see, compare and restore earlier versions of a document.\n- Large `.xlsx` files open faster and no longer stutter while scrolling.\n\n### Fixed\n- Saving a DOCX no longer drops the formatting of nested tables.\n- PDF signatures show the signer's name correctly.\n\nSee the [Versions page](/apps/office/versions) for the full list.",
    b: "### New\n- Spreadsheets: filter by several conditions at once.\n\n### Fixed\n- Fixed a crash when opening a password-protected PDF.",
    c: "### New\n- The status bar shows workspace sync progress.\n- New `Ctrl+Shift+V` shortcut to paste without formatting.",
    d: "### New\n1. The AI assistant remembers the context of the open document.\n2. Export DOCX to PDF through the UniWork Office service.\n\n### Fixed\n- The caret no longer jumps to the line start while typing accented Vietnamese.",
  },
} as const;

function release(version: string, channel: "dev" | "beta", published: string, sha: string, notes: string | null): Release {
  return {
    version, channel, tag: `office-v${version}`, published_at: published, git_sha: sha, notes_markdown: notes, notes_url: null,
    signed: { windows: false, macos: true, linux: true },
    apt: { suite: channel, package: "uniwork-office", version: `${version}-1` },
    assets: assets(version, channel),
  };
}

/** dev: three releases; beta: one; stable: absent. `newer` adds the release a re-check discovers. */
export function fixtureManifest(locale: "vi" | "en", newer = false): ReleasesManifest {
  const notes = NOTES[locale];
  const dev = [
    release("0.9.4-dev.12", "dev", "2026-10-22T03:40:00Z", "a71c2657c90d1f3b", notes.a),
    release("0.9.4-dev.11", "dev", "2026-10-20T09:12:00Z", "bd62328c15e07a42", notes.b),
    release("0.9.4-dev.9", "dev", "2026-10-16T14:05:00Z", "838d735e4ab9c601", notes.c),
  ];
  if (newer) dev.unshift(release("0.9.4-dev.13", "dev", "2026-10-22T11:30:00Z", "c3e90a1b7f2d4488", notes.b));
  return {
    schema: 1, generated_at: newer ? "2026-10-22T11:31:00Z" : "2026-10-22T03:41:00Z", base_url: BASE,
    channels: {
      dev: { latest: dev[0]!.version, apt_suite: "dev", releases: dev },
      beta: { latest: "0.9.3-beta.2", apt_suite: "beta", releases: [release("0.9.3-beta.2", "beta", "2026-10-14T08:30:00Z", "6f21b8d09e3c5a17", notes.d)] },
    },
  };
}
