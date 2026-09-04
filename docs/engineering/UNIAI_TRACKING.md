# Quy tắc phát triển gắn với UniAI (quản lý dự án qua `uniai` CLI)

> **Trạng thái:** shipped · **Áp dụng từ:** 2026-09-04 · **Dự án UniAI:** UniWork (workspace `uni2026`) · **Cho:** mọi người và mọi agent lập trình (ADR 0006)

UniAI là nơi duy nhất trả lời "ai đang làm gì, đến đâu, bằng chứng ở đâu". Repo giữ mã
và tài liệu; UniAI giữ trạng thái công việc. Hai nơi nối với nhau bằng **mã issue
`UNI-nnn`** xuất hiện trong tên nhánh, commit, PR và bình luận. Không có mã, không có
việc.

## 1. Năm luật

| # | Luật | Ép bằng |
| --- | --- | --- |
| 1 | **Không issue, không code.** Mọi thay đổi mã hoặc tài liệu bắt đầu từ một issue UniAI thuộc dự án UniWork, ở đúng epic giai đoạn (F/C/A/E) và mang Roadmap ID. Việc phát sinh thì tạo issue trước (`make issue-new`), không sửa "tiện tay". | `uniai-link` workflow chặn PR không có `UNI-nnn` |
| 2 | **Nhánh mang mã issue.** `feature/UNI-423-audit-outbox`, `fix/UNI-431-people-csv`, `docs/UNI-422-…`. Một issue có thể nhiều nhánh; một nhánh chỉ một issue. | `make issue-start` tạo nhánh đúng dạng; `prepare-commit-msg` đọc mã từ tên nhánh |
| 3 | **Trạng thái do người làm cập nhật, đúng lúc.** `todo → in_progress` khi bắt đầu; `in_review` khi mở PR; `done` khi PR merge **và** DoD đủ; `blocked` ngay khi kẹt, kèm bình luận nói kẹt vì gì. Không có trạng thái "làm gần xong" trong đầu ai. | `make issue-start` / `issue-pr` / `issue-done` đổi trạng thái; review chặn merge nếu issue chưa `in_review` |
| 4 | **Bằng chứng nằm trong bình luận issue.** PR URL, lệnh đã chạy thật, ảnh chụp, số liệu k6, quyết định nhỏ. Bình luận là nhật ký; tiêu đề và mô tả issue là hợp đồng, không sửa lịch sử. | `make issue-pr` tự ghi PR URL; DoD §7 |
| 5 | **Plan = sub-issue.** Khi viết plan (`docs/superpowers/plans/`), mỗi task lớn của plan là một sub-issue (`--parent`) của issue tính năng, để tiến độ nhìn được trên board mà không mở file. | `make issue-sub PARENT= TITLE=` |

## 2. Vòng đời một issue

```text
backlog ──(được xếp sprint)──▶ todo ──make issue-start──▶ in_progress ──make issue-pr──▶ in_review ──merge + DoD, make issue-done──▶ done
                                   │                          │
                                   └──── kẹt: make issue-block ◀┘   (blocked → in_progress khi gỡ)
```

| Bước | Ai | Lệnh | Điều xảy ra trên UniAI |
| --- | --- | --- | --- |
| Nhận việc | dev | `make issue-start KEY=UNI-423` | assign cho bạn, `in_progress`, tạo nhánh `feature/UNI-423-<slug>` từ `develop`, bình luận "bắt đầu, nhánh …" |
| Chia việc | dev | `make issue-sub PARENT=UNI-423 TITLE="Migration audit_events"` | sub-issue `todo`, cùng project, cùng assignee |
| Ghi chú | dev | `make issue-note KEY=UNI-423 MSG="đã đo outbox lag p95 0,4 s"` | bình luận |
| Kẹt | dev | `make issue-block KEY=UNI-423 MSG="chờ quyết định A5"` | `blocked` + bình luận |
| Mở PR | dev | `make issue-pr KEY=UNI-423` | push, `gh pr create` với tiêu đề `UNI-423: …` và mẫu PR, `in_review`, bình luận PR URL |
| Xong | dev sau khi merge | `make issue-done KEY=UNI-423` | `done` + bình luận "merged <sha>"; nhắc cập nhật roadmap |
| Xem việc của tôi | ai cũng được | `make issue-mine` | danh sách `todo` + `in_progress` + `in_review` của bạn |

Mọi lệnh trên gọi `scripts/uniai.sh`; chạy trực tiếp `uniai` khi cần thao tác ngoài danh
sách này (`uniai issue --help`).

## 3. Commit và PR

- **Commit**: giữ Conventional Commits (`CLAUDE.md` § Commits). Hook `prepare-commit-msg`
  tự thêm trailer `Refs: UNI-423` lấy từ tên nhánh; không gõ tay, không xóa. Commit không
  thuộc issue nào (chỉ khi làm việc ngoài nhánh issue) thì không có trailer, và không được
  merge vào `develop` qua PR thiếu mã.
- **PR**: tiêu đề bắt đầu bằng mã issue: `UNI-423: audit events + outbox dispatcher`. Mẫu
  PR có mục **UniAI** ghi mã; workflow `uniai-link` đọc tiêu đề và mô tả, thiếu `UNI-nnn`
  thì đỏ. Ngoại lệ duy nhất: PR gắn nhãn `no-issue` (chỉ maintainer gắn, dùng cho sửa
  CI khẩn), workflow ghi cảnh báo thay vì chặn.
- **Merge**: người merge kiểm issue đang `in_review` và DoD tick đủ trong mô tả PR. Sau
  merge, tác giả chạy `make issue-done`.

## 4. Nhịp cập nhật

- **Hằng ngày trước 10:00**: mỗi người xem `make issue-mine`; issue `in_progress` không
  có bình luận trong 2 ngày làm việc coi như kẹt, chủ sở hữu sản phẩm sẽ hỏi.
- **Cuối sprint**: `done` chỉ khi DoD đủ; việc chưa xong giữ `in_progress` và ghi rõ còn
  gì; không tạo issue mới "phần 2" để làm đẹp board.
- **Khi đổi phạm vi**: sửa mô tả issue **và** roadmap trong cùng PR; ghi bình luận "phạm
  vi đổi vì …".
- Trạng thái issue trên UniAI và cột Trạng thái trong `docs/roadmap/FEATURE_ROADMAP.md`
  phải khớp khi kết thúc sprint; roadmap là bản ghi lâu dài, UniAI là bản sống.

## 5. Quy tắc cho agent lập trình (Claude Code, Codex, agent UniAI)

Agent tuân cùng năm luật và thêm:

1. **Mở phiên bằng issue.** Phiên làm việc bắt đầu từ `uniai issue get UNI-nnn --output json`
   để đọc mô tả, bình luận, sub-issue; không đoán phạm vi từ tên nhánh.
2. **Không tự đổi trạng thái sang `done`.** Agent được `in_progress`, `in_review`, `blocked`
   và bình luận; `done` là quyết định của người sau khi kiểm DoD.
3. **Mỗi lần dừng phải để lại bình luận**: đã làm gì, lệnh nào đã chạy thật, còn gì, chặn
   bởi gì. Bình luận ngắn, có tiền tố `[agent]`.
4. **Không tạo issue mới ngoài sub-issue** của issue đang làm, trừ khi người yêu cầu.
5. Khi issue được giao cho một agent UniAI (assignee là agent), quy tắc chạy và duyệt vẫn
   theo ADR 0010: agent đề xuất qua PR, người merge.

## 6. Ánh xạ với tài liệu repo

| UniAI | Repo |
| --- | --- |
| Epic "Giai đoạn F/C/A/E" | mục tương ứng trong `docs/roadmap/FEATURE_ROADMAP.md` |
| Issue `UNI-nnn` có Roadmap ID | dòng roadmap; spec trong `docs/superpowers/specs/` |
| Sub-issue | task có checkbox trong `docs/superpowers/plans/<plan>.md` |
| Bình luận có PR URL | PR trên GitHub, commit có trailer `Refs: UNI-nnn` |
| `done` | roadmap `CÓ` + ngày; plan `shipped`; spec `Đã triển khai` |
| Nhãn `phase-*`, `uw-*` | giai đoạn và vùng (backend, frontend, ai, devops, platform, qa) |

## 7. Cài đặt lần đầu

```sh
uniai login                          # hoặc: uniai setup
uniai workspace switch uni2026
uniai auth status                    # phải thấy email của bạn
make issue-mine                      # kiểm tra kết nối
```

`make doctor` báo nếu thiếu `uniai` hoặc `gh`. Token UniAI là bí mật cá nhân; không đưa
vào `.env` của repo.
