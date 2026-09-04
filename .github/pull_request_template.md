## UniAI

Issue: UNI-___ <!-- bắt buộc; workflow uniai-link chặn PR thiếu mã. make issue-pr KEY=UNI-123 điền sẵn. -->

## Thay đổi gì

<!-- Một đoạn: thay đổi này làm gì, và tại sao. Phần "tại sao" quan trọng hơn. -->

## Đã cố ý bỏ ra ngoài

<!-- Thứ đã cân nhắc rồi quyết định không làm trong PR này, kèm lý do. Ghi "không có" nếu không có. -->

## Kiểm chứng (bắt buộc)

<!-- Ghi lệnh đã CHẠY THẬT và kết quả, không phải lệnh lẽ ra nên chạy.
     Bỏ qua bước nào thì nêu tên bước và lý do. Reviewer đối chiếu với CI. -->

- Đã chạy:
- Đã bỏ qua, vì:

## Definition of Done

<!-- docs/engineering/DEFINITION_OF_DONE.md. Máy đã giữ phần còn lại (CI đỏ = chưa xong).
     Ô không áp dụng: tick và ghi "n/a — lý do" một dòng. -->

- [ ] **Issue và phạm vi** — issue ở `in_review`; PR không rộng hơn issue
- [ ] **Kiểm chứng thật** — mục trên ghi lệnh đã chạy; CI xanh trước khi merge
- [ ] **Test đi trước hành vi** — test ở đúng package, fail nếu revert code
- [ ] **Cách ly tenant** — query mới lọc tenant qua `RequireMember`; có test org B bị 403/404
- [ ] **Quyền hai phía** — rule Go có mirror trong `permissions/rules.ts`
- [ ] **Giao diện dùng được** — sáng/tối, bàn phím, không mock, empty state có bước tiếp
- [ ] **Agent là actor** — attribution, `created_by_kind`, đề xuất → xác nhận
- [ ] **Luật mới có ADR** — ADR + dòng `CLAUDE.md` + tên test giữ
- [ ] **Nền có runbook** — `docs/ops/` và chuỗi shutdown trong `main.go`
- [ ] **Tài liệu đóng vòng** — spec, plan, roadmap cập nhật hoặc nêu PR docs tiếp theo
