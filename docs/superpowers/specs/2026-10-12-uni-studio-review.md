# UNI-1334 · Review bản studio 3D

Reviewer độc lập: impeccable_finish_reviewer.
Disposition sau lượt review đầy đủ với bằng chứng hợp lệ: **rebuild**.
Không có quyết định ship.

## Bằng chứng

Bộ ảnh desktop, mobile, cửa sổ 940px, dark EN và 11 viewport cuộn thật xác nhận một scene 3D xuyên suốt.
Bản chụp full-page của canvas fixed bị trắng ở các khoảng hở; reviewer yêu cầu recapture và đã nhận bộ viewport thay thế.
Recording studio-action.webm quay canvas runtime, không phải video sinh bằng AI; reviewer chưa xem video nên không phê duyệt chất lượng hành động qua các ảnh tĩnh.

## Phần giữ lại

Cuộn native; pose đảo chiều xác định; dừng render khi đứng yên; pause, reduced motion và hidden-document behavior; logo SVG chính thức; CTA đọc rõ ở viewport đầu.

## Phần phải làm lại

1. Asset UNI: độ giống khuôn mặt, mí mắt, tai, mõm/cười, neckline, bờm/đuôi; còn lỗ đầu vai ở pose chào, lớp bờm phía sau và lưỡi quá rực.
2. Foreground và timeline: panel che hầu hết nhân vật ở nhiều đoạn, che nhảy thứ hai và đoạn kết. Phải xét cả UI cùng action, không chỉ canvas riêng.
3. Ramp/atrium: cobalt inlay chưa nổi từ camera chính, junction gallery và phân biệt vật liệu/ánh sáng chưa đạt concept.
4. Direction/provenance: record lựa chọn 02 rõ ràng; không coi seed cũ là phê duyệt mới. Document system chỉ sau review và ghi đúng trạng thái draft.
5. Performance nhân vật: kiểm tra planting chân trong world space qua nghiêng thân/đổi hướng, silhouette trên không, lực tiếp đất và nhịp camera bằng recording composited.
6. Craft: tracking headline tối thiểu -.04em và document các kích thước/radius có chủ đích.

Tracking và direction record đã được sửa sau review. Các phần asset, dàn cảnh và action vẫn còn mở.

## Verification

8 e2e tập trung qua: renderer thật, cuộn/reverse frame, run/jump/land, pause/reduced preference, resize/logo, context loss, phone CTA, dark EN.
Web typecheck và focused ESLint qua.
make check chưa chạy được: GNU make không có trên host.
Lượt suite rộng trước đó bị dừng với lỗi điều hướng/demo và kiểm tra cũ; không được dùng kết quả 8 bài để tuyên bố cả suite đạt.

Xem brief asset: 2026-10-12-uni-studio-asset-brief.md.
PR #249 vẫn draft; UNI-1334 vẫn in_progress.