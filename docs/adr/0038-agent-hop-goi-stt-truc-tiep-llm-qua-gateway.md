# 0038 — Agent thư ký AI gọi STT trực tiếp; mọi lời gọi LLM vẫn qua `ai.Gateway`; agent không ghi bảng nghiệp vụ

**Trạng thái:** accepted (2026-10-20) — chủ sản phẩm (quangpd) duyệt cùng spec thư ký AI (D5, D13).
**Issue:** UNI-2023 · **Parent:** UNI-1995 · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) (AI chỉ đề xuất, mọi LLM qua `ai.Gateway`), [0008](0008-cach-ly-tenant-o-tang-service.md) (tenant), [0009](0009-audit-va-outbox-cung-transaction.md) (audit + outbox).

## Bối cảnh

Spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` đưa một agent LiveKit
(`apps/meeting-agent`, Python) vào mỗi phòng họp để ghi lời từng người và phát phụ đề. Luật
hiện có (ADR 0010, `CLAUDE.md` mục Audit and Events) nói: chỉ `server/internal/ai/provider`
nói chuyện với nhà cung cấp model, mọi lời gọi LLM đi qua `ai.Gateway`.

Ghi lời trực tiếp là một luồng âm thanh liên tục mỗi người nói, đi từ SFU LiveKit tới nhà
cung cấp STT (AssemblyAI Universal-3.6 Pro Streaming). Chuyển luồng đó qua server Go nghĩa
là server nhận lại toàn bộ âm thanh của mọi phòng họp rồi mở WebSocket STT thay agent: gấp
đôi băng thông, thêm độ trễ phụ đề, và server API phải giữ hàng nghìn kết nối dài. Plugin STT
của LiveKit Agents (Python) đã làm đúng việc này, kể cả chốt lượt nói và đóng phiên.

## Quyết định

1. **STT là ngoại lệ duy nhất.** `apps/meeting-agent` mở kết nối trực tiếp tới nhà cung cấp
   STT do `SCRIBE_STT_PROVIDER` chọn (`assemblyai` hoặc `fake` cho test), bằng key của chính
   agent. Server Go không nhận âm thanh.
2. **Mọi lời gọi LLM vẫn qua `ai.Gateway`.** Agent không giữ key LLM và không import SDK LLM
   nào (thư viện LiveKit có thể kéo theo một gói như vậy làm phụ thuộc gián tiếp; luật là
   "không import, không key", không phải "không có trong môi trường"); việc
   cần model (rút việc trong lúc họp, dịch phụ đề, tóm tắt) là một request tới API của
   server, server gọi `ai.Gateway` và trừ tín dụng AI như mọi tính năng khác.
3. **Agent không ghi bảng nghiệp vụ.** Agent chỉ gọi các route
   `/api/v1/meetings/{meetingID}/agent/*` bằng token theo cuộc họp `uwma_…` (HMAC do server
   ký, có `meeting_id`, tổ chức, lần chạy, hạn). Server quyết định lưu gì, chống trùng, đo
   phút, audit và phát sự kiện. Agent không có kết nối DB, Redis hay outbox.
4. **Phút STT không vào tín dụng AI.** Phút ghi lời đo vào quyền gói
   `meeting.transcription` (phút/tháng) bằng sổ đo sẵn có (`EntitlementService.RecordUsage`),
   theo giây nói agent báo sau VAD.
5. **Không log nội dung lời nói** ở agent, chỉ id và độ dài.

## Hệ quả

- Có thêm một nơi giữ key nhà cung cấp ngoài `internal/ai/provider`: secret của Deployment
  `meeting-agent`. NetworkPolicy chỉ cho agent ra LiveKit, nhà cung cấp STT và `uniwork-be`.
- Đổi nhà cung cấp STT chỉ là đổi `SCRIBE_STT_PROVIDER` và secret, không sửa server.
- `scripts/governance.test.mjs` giữ phần kiểm được bằng máy: `requirements.txt` của agent
  không khai SDK LLM, và không file `apps/meeting-agent/**/*.py` nào import SDK LLM (`openai`,
  `anthropic`, `google.generativeai`, `google.genai`, `mistralai`, `cohere`, `langchain*`,
  `livekit.plugins.openai|anthropic|google|groq|…`). Phụ thuộc gián tiếp không bị cấm; chúng
  không có key để dùng. Phần "agent chỉ gọi route `/agent/*`" do token giữ: token `uwma_`
  không được route nào khác nhận.
- Hồ sơ pháp lý (thỏa thuận xử lý dữ liệu, vùng xử lý, chuyển dữ liệu ra nước ngoài) cho nhà
  cung cấp STT theo spec cha §7.5 phải xong trước khi bật cờ `meeting_scribe` cho khách.
