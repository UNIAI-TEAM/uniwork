# UNI-1334 · Brief asset và cảnh studio

Trạng thái: bản runtime đang ở draft, chưa đạt nghiệm thu mỹ thuật/chuyển động điện ảnh.
Môi trường đã được người dùng chọn: 02 · Studio kiến trúc.

## Nhân vật bàn giao

- Bám ảnh UNI gốc trong public/landing/mascot/uni-horse-v2.webp: ngựa hai chân, thân trắng, mắt xanh, bờm/đuôi cobalt–cyan, áo và móng navy.
- File nguồn Blender hoặc FBX cùng bản GLB có rig; bề mặt liền, topology kín, không có lỗ đầu vai, không lộ các khối cầu ráp.
- Mắt nằm trong hốc mắt có mí; mõm, hàm và nụ cười có hình khối và biểu cảm đúng ảnh gốc.
- Bờm/đuôi có độ dày, đầu kín, silhouette sạch, chuyển động phụ theo gia tốc và đổi hướng.
- Áo có UV cho decal logo SVG chính thức của packages/ui/brand. Không tự vẽ lại hoặc nung logo khác vào texture.
- Trục Y hướng lên, Z là mặt trước; gốc ở mặt đất giữa hai móng. Nhân vật được chuẩn hóa cao khoảng 3.4 đơn vị của scene.
- PBR base color/roughness/normal; màu thân và trang phục ổn định cả ánh sáng sáng/tối. Tránh chất liệu nhựa bóng đồng loạt.
- Web budget khởi điểm: dưới 100k tam giác, texture 2K tối đa, tối ưu trước khi giao; kiểm tra trên RX550 và điện thoại, không coi đây là chỉ tiêu đủ để nghiệm thu.

## Các clip

idle, run, turn, anticipation, jump, land, greet.
Run có nhịp đặt chân, lực đẩy và chuyển trọng tâm, không trượt móng. Các clip được scrub theo vị trí cuộn; cuộn ngược trả đúng pose. Nhảy có lấy đà, pha bay, co chân và nén khi tiếp đất. Export root motion hoặc dữ liệu plant chân đủ để giữ tốc độ với đường cong trong scene.

## Dàn cảnh cần sửa tiếp

Runtime hiện có atrium, gallery, ramp, shadow và reflection. Nền là scene thật, không phải một ảnh nhân vật dịch tọa độ.
Bản draft vẫn bị panel nội dung che nhân vật ở nhiều đoạn, kể cả nhịp nhảy thứ hai và đoạn kết.
Cần đạo diễn các nhịp hành động theo khoảng hở thực tế của các section, chừa khung hình cho nhân vật, và kiểm tra toàn hành trình ở desktop/mobile.
Ưu tiên staging rõ ràng với kiến trúc tiền/trung/hậu cảnh, daylight có hướng, phản xạ tiết chế và bóng tiếp xúc. Không chỉ tăng ánh sáng hay thêm hiệu ứng để gọi là điện ảnh.

## Điểm tích hợp

- animation/studio-world.ts sở hữu renderer, scene, camera, thời điểm cuộn, motion state và cleanup.
- buildStudioHorse là adapter model/pose tạm. Thay bằng GLTFLoader + AnimationMixer hoặc rig pose sampler khi có asset đạt chuẩn.
- Giữ một canvas, không thêm portrait/hình ngựa ở mép trang.
- Reduced motion mở ở frame tĩnh, pause giữ nguyên pose, tab ẩn dừng RAF, không WebGL dùng ảnh fallback.
- Thay đổi breakpoint phải cập nhật DPR, shadow và reflection; dispose skeleton/texture/render target khi thay model hay unmount.

## Nghiệm thu

So sánh video runtime với ảnh gốc và concept studio; xem các góc trước, sau và ba phần tư.
Không có lỗ mesh, xuyên mắt, chân/giày co sập, bóng trượt, jump bị crop hay bị panel che cả nhân vật.
Nội dung đọc rõ trên mọi vùng nền trong VI/EN và sáng/tối.
8 kiểm tra renderer/scroll hiện qua không thay thế nghiệm thu mỹ thuật. PR #249 vẫn draft, UNI-1334 vẫn in_progress.