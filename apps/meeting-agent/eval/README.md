# Bộ đánh giá chất lượng STT tiếng Việt

> **Trạng thái:** shipped — công cụ có sẵn; **bộ dữ liệu thật chưa có** (chủ sản phẩm cung cấp, xem "Việc của chủ sản phẩm").

Công cụ đo độ chính xác ghi lời của thư ký AI (UNI-1995, vấn đề #3 của benchmark) trên
**cuộc họp thật của người Việt**, cho cả hai đường: **live** (phụ đề và transcript trong
phòng, `apps/meeting-agent`) và **batch** (file ghi âm tải lên, `server/internal/ai/provider/file_transcribe.go`).
Đo hai chỉ số: **WER** (tỉ lệ lỗi từ) và **độ phủ thực thể** (tên người, tên sản phẩm,
thuật ngữ tiếng Anh có được ghi đúng nguyên cụm không). Đường live còn đo **độ trễ** từ
lúc hết câu tới bản chốt (p50/p95) và tỉ lệ **thời gian mở phiên STT / giây nói** (nhà cung
cấp tính tiền theo thời gian mở phiên, S0 §1 mục 5b).

## Cổng bật cờ

**Không bật cờ `meeting_scribe` (và `meeting_transcription`) cho tổ chức khách hàng nào
trước khi bộ này chạy với dữ liệu thật và ra `Đạt`**, ghi kết quả vào
`docs/superpowers/specs/2026-10-20-meeting-scribe-agent-s0-results.md` §1 (mục 3, 5b, 6) và
tích mục tương ứng trong `docs/ops/MEETINGS_AI_GO_LIVE.md`. Chạy lại (và ghi lại) trước
mọi thay đổi có thể đổi chất lượng: model hay `mode` của STT, `speech_models` của batch,
keyterms, phiên bản plugin LiveKit, vùng (`base_url`), hoặc cách VAD đóng/mở phiên.

Ngưỡng mặc định (`python -m eval.run --help`), áp cho **từng lát cắt** (mỗi giọng vùng miền,
mỗi loại micro, và toàn bộ), không chỉ trung bình:

| Chỉ số | Ngưỡng | Vì sao |
|---|---|---|
| WER | ≤ 25% | Họp hội thoại tự nhiên, nhiều người, chen tiếng Anh; trên mức này tóm tắt và rút việc bắt đầu sai nội dung. |
| Độ phủ thực thể | ≥ 80% | Tên người và việc là thứ người dùng đọc lại trong biên bản và việc được giao. |
| p95 độ trễ live | ≤ 4 s | Phụ đề trễ hơn thì người họp bỏ đọc (cùng ngưỡng với alert đề xuất trong benchmark). |
| Tổng âm thanh | ≥ 2 giờ | Ít hơn thì một cuộc họp lệch kéo cả kết quả. |

Đổi ngưỡng là quyết định của chủ sản phẩm; ghi ngưỡng đã dùng cạnh kết quả.

## Việc của chủ sản phẩm

1. **Gom 2–5 giờ cuộc họp thật**, có sự đồng ý ghi âm của mọi người trong đó (giọng nói và
   tên là dữ liệu cá nhân, Luật 91/2025/QH15; xem `docs/ops/MEETINGS_AI_COMPLIANCE.md`). Phủ:
   - giọng **Bắc, Trung, Nam** (mỗi giọng ≥ 30 phút; `mixed` cho cuộc họp lẫn giọng),
   - **micro**: tai nghe, laptop, **điện thoại** (≥ 30 phút) và **micro hội trường** (≥ 30 phút),
   - chen **thuật ngữ tiếng Anh** (deadline, KPI, tên công cụ), tên người, con số, ngày giờ.
2. **Bản gõ tham chiếu** cho từng file: gõ đúng lời đã nói, một file `.txt` UTF-8. Số viết
   chữ hay số đều được (công cụ tự quy về một dạng). Không ghi nhãn người nói, không mốc giờ,
   bỏ tiếng ngập ngừng (ờ, ừm, ơ, uh, um). Người gõ không nghe được thì bỏ đoạn đó khỏi cả
   âm thanh lẫn bản gõ, đừng đoán.
3. **Thực thể** của từng file: tên người, tổ chức, sản phẩm, thuật ngữ quan trọng, đúng chính
   tả mong muốn. **Keyterms**: đúng thứ production gửi cho STT (tên cuộc họp, tên dự án, tên
   người dự họp, spec thư ký AI §4.2), không phải danh sách thực thể, để không chấm điểm lời gợi ý.
4. Giữ bộ dữ liệu **ngoài git** (ổ mã hóa của công ty). `eval/data/` và `eval/out/` đã nằm
   trong `.gitignore`; chỉ commit `report.md` đã bỏ trích dẫn lời nói nếu cần.

## Manifest

JSON, đường dẫn tính từ thư mục chứa manifest. Mẫu: `manifest.example.json`.

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `version` | có | `1` |
| `items[].id` | có | duy nhất; tên file kết quả trong `--out` |
| `items[].audio` | có | WAV PCM 16-bit (đổi: `ffmpeg -i in.m4a -ac 1 -ar 16000 -c:a pcm_s16le out.wav`) |
| `items[].reference` | có | bản gõ tham chiếu `.txt` |
| `items[].accent` | có | `north` \| `central` \| `south` \| `mixed` |
| `items[].mic` | có | `headset` \| `laptop` \| `phone` \| `room` |
| `items[].entities` | không | cụm phải xuất hiện nguyên vẹn trong bản ghi lời |
| `items[].keyterms` | không | keyterms gửi cho STT live (như production) |

## Chạy

```bash
cd apps/meeting-agent
set -a; . ../../.env; set +a   # ASSEMBLYAI_API_KEY, AI_MEETING_TRANSCRIBE_BASE_URL (vùng)
SCRIBE_STT_PROVIDER=assemblyai .venv/bin/python -m eval.run \
  --manifest ~/golden/manifest.json --out ~/golden/out --path both
```

- **live** phát lại từng file **theo thời gian thực** qua đúng đường của agent: Silero VAD →
  `TrackTranscriber` → `make_stt(SCRIBE_STT_PROVIDER, keyterms)`. 3 giờ âm thanh là 3 giờ
  chạy và ~3 giờ phiên STT (khoảng 0,45 USD/giờ). `--speed 0` chỉ để thử đường ống với
  `SCRIBE_STT_PROVIDER=fake`; độ trễ chỉ có nghĩa ở `--speed 1`.
- **batch** tải file lên AssemblyAI, gửi đúng request của server (`speech_models`,
  `language_codes`; `tests/test_eval_run.py` fail nếu hai bên lệch), chờ kết quả rồi xóa
  bản của nhà cung cấp như server làm (spec cha §7.5).
- Bản ghi lời được giữ trong `--out` (`<id>.<live|batch>.txt`); chạy lại chỉ chấm lại.
  `--fresh` ghi lời lại (tốn tiền lại).
- Ra `report.md` (bảng theo lát cắt và theo file) và `results.json`. Mã thoát: 0 đạt, 1 không
  đạt, 2 manifest sai.

## Chuẩn hóa trước khi chấm

`eval/score.py`, có test trong `tests/test_eval_score.py`:

- Unicode NFC, chữ thường, bỏ dấu câu và ký hiệu; từ tiếng Anh giữ nguyên.
- Số đọc thành chữ kiểu Việt: `2026` → "hai nghìn không trăm hai mươi sáu", `1.500.000`
  (dấu chấm ngăn nghìn) → "một triệu năm trăm nghìn", `3,5` (dấu phẩy thập phân) → "ba phẩy
  năm", `50%` → "năm mươi phần trăm", số bắt đầu bằng 0 (điện thoại) đọc từng chữ số.
- Biến thể đọc số gộp làm một: lăm/nhăm → năm, mốt → một, tư → bốn, lẻ → linh, ngàn → nghìn.
- Bỏ dấu kiểu cũ và mới: "hòa"/"hoà", "thúy"/"thuý", "ủy"/"uỷ"; "y"/"i" sau phụ âm đầu:
  "kỹ"/"kĩ", "lý"/"lí", "tỷ"/"tỉ".
- WER cộng lỗi trên tổng số từ của lát cắt (file dài nặng hơn), không lấy trung bình từng file.

Giới hạn đã biết: không gộp các cách đọc số khác ("hai không hai sáu" cho 2026, "chín rưỡi"
cho 9:30) và không bỏ tiếng ngập ngừng; bản gõ nên viết như người nói đọc, bỏ ờ/ừm.
