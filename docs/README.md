# Tài liệu UniWork — mục lục

Đọc theo thứ tự nếu bạn mới vào: `PRODUCT.md` → `docs/vision/PROJECT_VISION.md` →
`docs/roadmap/FEATURE_ROADMAP.md` → `CLAUDE.md` → spec của việc bạn nhận.

## Định hướng

| Tài liệu | Trả lời câu hỏi |
| --- | --- |
| [`../PRODUCT.md`](../PRODUCT.md) | Sản phẩm này cho ai, nguyên tắc thiết kế và agent |
| [`vision/PROJECT_VISION.md`](vision/PROJECT_VISION.md) | Vì sao xây lại, tầm nhìn, thanh chất lượng "chuẩn thế giới", lộ trình 4 giai đoạn |
| [`vision/KEY_POINTS.md`](vision/KEY_POINTS.md) | 11 key point sản phẩm và chỗ hiện thực từng điểm trong roadmap |
| [`roadmap/FEATURE_ROADMAP.md`](roadmap/FEATURE_ROADMAP.md) | Danh sách tính năng, trạng thái thật, spec để bám theo, thứ tự làm |
| [`roadmap/LEGACY_REFERENCE_MAP.md`](roadmap/LEGACY_REFERENCE_MAP.md) | Xem hành vi bản cũ ở đâu, và cái gì không được mang sang |
| [`roadmap/OPEN_QUESTIONS.md`](roadmap/OPEN_QUESTIONS.md) | Câu hỏi chờ chủ sở hữu sản phẩm quyết trước khi duyệt spec |

## Luật và quy trình

| Tài liệu | Trả lời câu hỏi |
| --- | --- |
| [`../CLAUDE.md`](../CLAUDE.md) | Luật kỹ thuật, mỗi luật có test/lint giữ |
| [`adr/README.md`](adr/README.md) | Vì sao có từng luật; ADR 0007–0011 (chấp nhận 2026-09-04) định hình Giai đoạn F và mobile |
| [`conventions.md`](conventions.md) | Đặt tên, glossary vi–en, giọng văn tiếng Việt |
| [`api-sdi-sdo.md`](api-sdi-sdo.md) | Viết HTTP API và Swagger |
| [`engineering/FEATURE_WORKFLOW.md`](engineering/FEATURE_WORKFLOW.md) | Một tính năng đi từ roadmap đến release như thế nào |
| [`engineering/DEFINITION_OF_DONE.md`](engineering/DEFINITION_OF_DONE.md) | Checklist dán vào PR; thiếu là chặn merge |
| [`engineering/GATE_LEVELS.md`](engineering/GATE_LEVELS.md) | Nới hay siết quy trình theo giai đoạn: `GATE_LEVEL` = `fast` / `standard` / `strict` |
| [`engineering/UNIAI_TRACKING.md`](engineering/UNIAI_TRACKING.md) | Gắn việc với UniAI qua `uniai` CLI: issue, nhánh, PR, trạng thái, `make issue-*` |

## Spec và plan

- `superpowers/specs/` — thiết kế từng tính năng (tiếng Việt). Trạng thái ghi ở header.
- `superpowers/plans/` — kế hoạch triển khai theo task, có `> **Trạng thái:**`.
- 8 spec `2026-09-04-*-design.md` cho Giai đoạn F đã duyệt ngày 2026-09-04 (UNI-421).

## Vận hành và kiến trúc meeting

- `meeting-livekit-architecture-diagrams.md`, `meeting-livekit-implementation-plan.md`,
  `meeting-scale-upgrade-plan.md`, `meeting-ui-implementation-plan.md`,
  `meeting-d08a-delivery.md`, `meeting-d08b-delivery.md`.
- `ops/` — runbook (sẽ tạo cùng F-11/F-13).
