# WebVitalsLCPPoor — p75 LCP vượt 2,5 giây

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Web Vitals*

## Triệu chứng

- Alert `WebVitalsLCPPoor`: `histogram_quantile(0.75, sum by (le) (rate(uniwork_web_vitals_seconds_bucket{metric="lcp"}[30m]))) > 2.5` liên tục 30 phút.
- Dữ liệu tới từ trình duyệt thật (`POST /api/v1/rum`, thư viện `web-vitals`, lấy mẫu theo `RUM_SAMPLE_RATE`) nên phản ánh cả mạng người dùng; API có thể đang hoàn toàn khoẻ.
- Panel **p75 LCP theo route** trên *UniWork · Web Vitals* vượt 2,5 s ở một hoặc mọi `route_pattern`.

## Kiểm tra

1. Mọi route hay một route?
   ```promql
   histogram_quantile(0.75, sum by (le, route_pattern) (rate(uniwork_web_vitals_seconds_bucket{metric="lcp"}[30m])))
   ```
   Mọi route cùng xấu → tải trang/bundle/CDN. Một route → màn hình đó fetch quá nhiều hoặc ảnh lớn.
2. TTFB có tăng cùng không (`metric="ttfb"`)? Có → server hoặc mạng; xem [ApiLatencyP95High](ApiLatencyP95High.md). Không → phần render/bundle phía client.
3. Đủ mẫu chưa? Panel **Mẫu RUM nhận được mỗi phút** — dưới ~20 mẫu/30 phút thì p75 nhiễu; kiểm tra `RUM_SAMPLE_RATE` và flag `rum_sampling` ở `/admin/flags`.
4. Bundle vừa phình? Job CI `size-limit` (`apps/web/.size-limit.json`, ngưỡng initial JS ≤ 250 KB gzip, route chunk ≤ 150 KB) — PR nào vừa nâng ngưỡng hoặc bị bỏ qua.
5. Tái hiện: mở route đó với DevTools → Performance/Lighthouse trên mạng "Fast 3G"; phần tử LCP là gì (ảnh avatar lớn? font chưa preload? bảng render đồng bộ?).
6. Deploy web mới? So thời điểm alert với deploy `apps/web` (không có `build_info` phía web; dùng lịch sử deploy).

## Khắc phục

- Ảnh/font: dùng `next/image` với kích thước đúng, preload font; ảnh người dùng tải lên phải qua thumbnail.
- Route fetch nhiều: gộp query, dùng cache `@tanstack/react-query` đã có, render skeleton sớm; không thêm dependency.
- Bundle: tách route chunk (`next/dynamic`), xóa import thừa; CI size-limit phải xanh trước khi merge.
- Mạng người dùng (một tổ chức ở xa CDN) → cân nhắc CDN/edge cho static; ghi nhận, không phải lỗi code.
- Nhiễu do ít mẫu → nâng `RUM_SAMPLE_RATE` tạm thời (0.2 → 1.0) để có số thật, rồi hạ lại.

## Leo thang

- p75 LCP > 4 s (mức "poor" của Google) hoặc kéo dài quá 1 ngày → nâng sev 2, đưa vào sprint hiện tại.
- Cần thay đổi hạ tầng tĩnh (CDN) → người giữ hạ tầng quyết.
