# 0006 — Một bộ luật cho người và mọi agent

**Trạng thái:** accepted (2026-08-29)

## Bối cảnh

Mỗi công cụ tìm file của riêng nó: Claude đọc `CLAUDE.md`, Codex/Cursor/
Copilot đọc `AGENTS.md`, Cursor còn đọc `.cursor/rules/`. Khi `AGENTS.md` là
bản rút gọn, agent vào qua đường đó bỏ lỡ nửa luật. Khi `.cursor/` là một bộ
framework generic (Angular, Django, Flutter…) cài sẵn, agent nhận một bộ luật
thứ hai không nói gì về UniWork và đôi khi ngược với bộ thứ nhất.

## Quyết định

`AGENTS.md` là symlink tới `CLAUDE.md`. Không có cây rule riêng cho editor
nào. Hook chỉ chứa thứ cụ thể cho repo này (`.githooks/`, `.claude/hooks/`).
Mọi luật trong `CLAUDE.md` có tên một test/lint/lệnh đứng cạnh, và
`scripts/governance.test.mjs` kiểm tra chính bộ luật (symlink, hook được
nối, path còn tồn tại, danh sách module mồ côi, prefix commit).

## Hệ quả

- Thêm luật = thêm thứ enforce nó, hoặc không thêm.
- Cần rule cho editor mới → viết vào `CLAUDE.md`; đừng tạo file thứ ba.
- Escape hatch `--no-verify` dành cho người; agent bị chặn ở `.claude/hooks`.
