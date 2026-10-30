# Checklist: bật AI của Office và Hỏi UNI soạn tệp cho tổ chức khách hàng

> **Trạng thái:** in-progress — chưa mục nào được tích cho production (UNI-2304). Vận hành: [`RUNBOOK_AI.md`](RUNBOOK_AI.md) (mục "Hỏi UNI: giao việc cho AI trong trình soạn" và "route viết").

**Luật:** không bật `office_ai_uniwork`, cờ định dạng `office_ai_uniwork_<định dạng>` hay
`ask_uni_office` cho **bất kỳ tổ chức nào ngoài nội bộ UniWork** — qua `/admin`, `FF_*` hay
override — trước khi mọi dòng dưới đây được tích, có người, ngày và bằng chứng. Kể cả tổ chức nội bộ:
mục 5 (bật cờ) chỉ bắt đầu sau khi mục 1–4 đã tích, vì tổ chức nội bộ ở production giữ dữ liệu thật và
mô tả của `office_ai_uniwork` ghi rõ "tắt cho tổ chức có dữ liệu thật tới khi G6-D2 đóng". Người bật cờ
đầu tiên cho khách ghi link tới bản checklist đã tích trong lý do của thao tác admin (`reason`,
lưu ở `admin_actions`). Bằng chứng là link (hợp đồng, PR, kết quả lệnh, ảnh dashboard), không
chỉ dấu tích.

## 1. G6-D2: upstream production (chủ sản phẩm quyết)

Định nghĩa ở `docs/office/g5g6g7/contract-p0.md` (dòng G6-D2); ứng viên và số đo ở
`docs/office/g5g6g7/g6-02-spike-report.md` §6. Gợi ý của spec: dùng cùng nhà cung cấp với Hỏi UNI để chỉ có một đường dữ liệu.

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 1.1 | Nhà cung cấp upstream production đã chọn | chủ sản phẩm | | [ ] |
| 1.2 | Vùng xử lý đã chọn và ghi lại | chủ sản phẩm | | [ ] |
| 1.3 | Thời hạn giữ dữ liệu ở nhà cung cấp, và bằng chứng log nội dung đã tắt ở đó | chủ sản phẩm + ops | | [ ] |
| 1.4 | Khóa upstream nằm ở secret manager, không trong repo hay env của máy cá nhân | ops | | [ ] |
| 1.5 | Chính sách transcript (giữ gì, bao lâu, ai đọc được) đã chốt | chủ sản phẩm | | [ ] |

## 2. Pháp lý

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 2.1 | Câu F03 trong `docs/seo-legal-request.json` đúng với nhà cung cấp ở 1.1 | pháp chế | | [ ] |
| 2.2 | Trang quyền riêng tư (`apps/web/features/landing/privacy-content.ts`) khớp với nhà cung cấp, vùng và thời hạn giữ ở mục 1 | chủ sản phẩm | | [ ] |
| 2.3 | Pháp chế xác nhận hai dòng trên | pháp chế | | [ ] |

## 3. Dữ liệu và gói

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 3.1 | Điều kiện C2 của spec gỡ BYOK (hai truy vấn chỉ đọc, `docs/superpowers/specs/2026-10-27-remove-byok-design.md` §8) đã chạy trước lần deploy làm rơi bảng `ai_provider_credentials` | ops | | [ ] |
| 3.2 | Các gói của tổ chức sẽ bật có `office.ai_cloud` | chủ sản phẩm | | [ ] |

## 4. Eval

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 4.1 | Eval sống của Hỏi UNI (`docs/ops/ASKUNI_EVAL.md`, gồm mục "Soạn tệp Office (Phần 6)") chạy trên upstream đã chọn; kết quả đã lưu | chủ sản phẩm (tốn tiền, cần đồng ý) | | [ ] |
| 4.2 | Bộ harness G6 chạy lại trên upstream đó (`g6-02-spike-report.md`, ghi chú chạy lại) | builder | | [ ] |

## 5. Bật theo thứ tự

Chỉ bắt đầu khi mục 1–4 đã tích. Bật cho tổ chức nội bộ UniWork trước, bằng override ở `/admin/flags`. Mỗi bước kiểm cờ đã lên rồi mới sang bước sau:
cờ công khai (`office_ai_uniwork`, cờ định dạng, `ask_uni_stream`, `ask_uni_actions`) thấy ở `GET /api/v1/config?organization_id=<org>` của một thành viên;
cờ chỉ ở máy chủ (`ask_uni_agent`, `ask_uni_office`) xem ở danh sách override của `/admin/flags`.
Công cụ ghi chỉ tới một lượt ở dock, và dock chỉ hiện khi `ask_uni_stream` bật, nên cờ đó đứng trước `ask_uni_actions`.
`ask_uni_attachments` không thuộc thứ tự này: chỉ cần để bắt đầu từ một tệp đính kèm và cho `save_attachment_template`.

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 5.1 | `office_ai_uniwork` và sáu cờ định dạng (`docx`, `xlsx`, `pptx`, `pdf`, `markdown`, `html`) | admin | | [ ] |
| 5.2 | `ask_uni_agent` | admin | | [ ] |
| 5.3 | `ask_uni_stream` (công khai) | admin | | [ ] |
| 5.4 | `ask_uni_actions` | admin | | [ ] |
| 5.5 | `ask_uni_office` | admin | | [ ] |
| 5.6 | Một lượt soạn tệp thật: hỏi, duyệt thẻ, tệp mở trong trình soạn, AI viết tiếp | admin | | [ ] |
| 5.7 | Chỉ sau khi 5.1–5.6 xong mới bật cho tổ chức khách, một tổ chức một lần | admin | | [ ] |

## 6. Rút lại

Rút nhanh: đặt override về tắt (hoặc xóa override đã bật) ở `/admin/flags`. Override thắng biến `FF_*`, nên
`FF_ASK_UNI_OFFICE=false` / `FF_OFFICE_AI_UNIWORK=false` chỉ có tác dụng khi không còn override nào bật cờ đó.
Tắt `ask_uni_office`: lượt mới không còn được đưa ba công cụ soạn tệp; thẻ chờ đã có vẫn hiện và Apply của chúng
trả `ask_uni_office_off`; override được đệm tối đa 30 giây mỗi nút máy chủ, nên cờ về tắt chậm tới 30 giây; tắt `office_ai_uniwork` tắt luôn AI trong trình soạn.

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 6.1 | Người được rút đã có tên (trực ca + chủ sản phẩm) | chủ sản phẩm | | [ ] |
| 6.2 | Một lần rút thử ở tổ chức nội bộ: cờ về tắt (chờ quá 30 giây), lượt mới không có công cụ soạn tệp, thẻ chờ cũ Apply ra `ask_uni_office_off` | admin | | [ ] |
