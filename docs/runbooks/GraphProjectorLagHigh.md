# GraphProjectorLagHigh — Work Graph chiếu chậm hơn nguồn

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/ops/RUNBOOK_OUTBOX.md`](../ops/RUNBOOK_OUTBOX.md)

## Triệu chứng

`uniwork_graph_dirty_oldest_seconds` trên 120 s suốt 10 phút. Panel "Liên quan" và dòng thời gian trên trang việc thiếu thay đổi mới. Việc, cuộc họp, chat vẫn chạy bình thường vì marker không chặn lane realtime.

## Kiểm tra

1. `uniwork_graph_projected_total{result="error"}` có tăng không. Nếu có, xem log `graph: projection failed` (có `node_type`, `source_id`, `attempts`).
2. `SELECT node_type, count(*), max(attempts), min(last_event_at) FROM graph_dirty GROUP BY 1;` để biết loại node nào kẹt.
3. `SELECT last_error FROM graph_dirty WHERE attempts > 3 LIMIT 20;` để xem lỗi lặp.
4. `uniwork_graph_dirty_pending` tăng đều mà không có lỗi: worker không chạy hoặc quá tải (xem log khởi động, CPU DB).
5. `uniwork_graph_dirty_lag_up = 0` nghĩa là không đọc được bảng, cảnh báo trễ sẽ im.

## Khắc phục

- Lỗi do một bản ghi nguồn hỏng: sửa nguồn; dòng bẩn tự chạy lại theo lịch lùi (tối đa 5 phút).
- Worker không chạy: khởi động lại pod API (worker chạy cùng server).
- Tồn đọng lớn sau sự cố: `graph-rebuild --org <id>` cho tổ chức bị ảnh hưởng, rồi khi `graph_dirty` của tổ chức đó đã rút hết, `graph-rebuild --org <id> --verify` phải in `drift=0` (dòng còn chờ worker cũng hiện thành lệch). Không dùng `--all` khi `graph` chưa bật toàn cục: xem mục "Work Graph: dòng bẩn và rebuild" trong [RUNBOOK_OUTBOX](../ops/RUNBOOK_OUTBOX.md).
- Tắt khẩn: đặt override global `graph=false` và gỡ override theo tổ chức; marker ngừng đánh dấu. Bật lại thì chạy rebuild cho các tổ chức đã bật.

## Leo thang

Kéo dài quá 1 giờ, hoặc `--verify` vẫn lệch sau rebuild: báo owner `graph` (C-11) kèm kết quả bước 2 và 3.
