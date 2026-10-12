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

## Bổ sung dàn cảnh và verification sau hiệu chỉnh

**Trạng thái: DRAFT / NOT APPROVED FOR SHIPPING. Disposition độc lập vẫn là REBUILD.**
Phần bổ sung này ghi hiệu chỉnh sau lượt review trên; không sửa lịch sử finding
thành một quyết định ship.

- Desktop từ 768px chừa cửa sổ nhân vật bên phải rộng
  clamp(330px, 36vw, 520px). Các section đọc, trust và footer thu về bên trái;
  platform và CTA cuối có rule specificity tương ứng để không lấn cửa sổ.
- Business OS dùng lưới 6 cột, chuyển 3 cột trong khoảng 768–1100px. AI stage
  desktop giữ khối copy trái, bỏ cột world rỗng và chiều cao trống trước đó.
- Camera theo vị trí route, đặt view offset vào cửa sổ và tính zoom từ envelope
  nhân vật bảo thủ, giữ lề 24px trong cửa sổ. Đây là sửa visibility; nhịp đặt
  nhân vật bên phải lặp lại chưa đạt shot direction điện ảnh.
- Phone đo tâm ba khoảng hở thật trong DOM và ánh xạ sceneProgress tới
  0.30 / 0.695 / 1. Mỗi passage cao 110svh; passage trước CTA cuối chỉ hiện
  trên phone. Cuộn native vẫn sở hữu document, không có scroll hijacking.
- Ramp có cobalt inlay ở cả hai mặt để nhìn thấy từ các hướng camera route.

Reviewer theo dõi hiệu chỉnh xác nhận foreground không còn che nhân vật trong
cả 11 frame desktop, gồm nhảy thứ hai và đoạn kết; cả 3 passage hành động phone
đều thấy nhân vật. Kết quả này giải quyết finding về occlusion, không phê duyệt
asset, vật liệu, kiến trúc/ánh sáng, planting chân hay chất lượng hành động
điện ảnh. Overall disposition tiếp tục **REBUILD**; chưa có quyết định ship.

Bằng chứng mới là các ảnh gốc trong .impeccable/review: desktop.png, mobile.png,
user-940.png, opening-dark-en.png, studio-scroll-00.png đến studio-scroll-10.png,
và mobile-action-0.png đến mobile-action-2.png. Contact sheet là chỉ mục, không
thay thế ảnh viewport gốc. Provenance vẫn phân biệt geometry/motion viết bằng
code, recording canvas runtime và raster fallback sinh bởi imagegen.

Verification final fit: **10 e2e tập trung qua** gồm 3 scene, 3 scroll/pause và
4 staging ở 1440px, 940px, 768px và phone 390px. Web typecheck và focused ESLint
qua. make check vẫn chưa chạy được vì host không có GNU make. Không dùng các
check tập trung này để tuyên bố toàn bộ suite hoặc nghiệm thu mỹ thuật đã đạt.

Asset UNI hoàn thiện, vật liệu/kiến trúc/daylight có phân lớp, planting và lực
run/jump/land, cùng nhịp camera điện ảnh vẫn còn mở. Xem brief asset đã liên kết;
PR #249 vẫn draft và UNI-1334 vẫn in_progress.


### Kết quả lượt review đầy đủ mới nhất

Reviewer độc lập hoàn tất lượt review mới: disposition **REBUILD**.
Persistence scoped draft đạt; record UNI-1334-studio-02 là lựa chọn 02 đã được
xác nhận. TYPE đạt tracking; THESIS, FIRST VIEWPORT và FORM khớp direction.
STORY đã giải quyết foreground occlusion trong 11 frame desktop và 3 passage
phone, nhưng cinematic performance vẫn chưa được nghiệm thu. DESIGN.md cấp
app kế thừa không phải blocker persistence của record draft theo scope này.

Các phần phải làm tiếp:

1. Nhân vật UNI: likeness, rig, mesh, bờm/đuôi và chất liệu/cấu trúc áo.
2. Kiến trúc: junction, phân biệt vật liệu, daylight có hướng và chiều sâu.
3. Hành động: chân trong world space, tiếp xúc ramp, anticipation, nén khi
   landing và chứng minh bằng video runtime có cả UI foreground.
4. Camera: tiến triển góc và scale có chủ đích, không chỉ lặp vị trí bên phải.
5. Đồng bộ tài liệu draft với trạng thái và kết quả thật; mục này đã được ghi
   vào DESIGN.md scoped, sidecar và phần bổ sung review này.

10 check tập trung, typecheck và focused lint nêu trên giữ nguyên phạm vi.
Không có quyết định ship; PR #249 vẫn draft, UNI-1334 vẫn in_progress.
