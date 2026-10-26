# Meetings AI: dữ liệu cá nhân, bên xử lý phụ và chuyển dữ liệu ra nước ngoài

> **Trạng thái:** in-progress — tài liệu có sẵn; thỏa thuận xử lý dữ liệu, hồ sơ chuyển dữ liệu ra nước ngoài và thông báo cho khách **chưa xong** (chủ sản phẩm + pháp chế). Cổng bật cờ: [`MEETINGS_AI_GO_LIVE.md`](MEETINGS_AI_GO_LIVE.md).

Phạm vi: thư ký AI (ghi lời trực tiếp, phụ đề, việc rút trong họp, phụ đề dịch, tóm tắt phần đã
lỡ), ghi lời file ghi âm tải lên, tóm tắt và biên bản sau họp. Nền: spec
`docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §7.5, spec thư ký AI §4.6,
ADR 0045 (mục "Bổ sung 2026-10-23"). Tài liệu này không phải ý kiến pháp lý: mọi dòng có
**(pháp chế xác nhận)** phải được người có chuyên môn kiểm trước khi dùng với khách.

## 1. Cơ sở pháp lý

- **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15**, hiệu lực từ **01/01/2026**, là văn bản gốc.
  Spec và ADR trước đây chỉ dẫn Nghị định 13/2023/NĐ-CP; từ 2026 Nghị định 13 không còn là căn
  cứ chính. Nghị định hướng dẫn Luật 91 (số hiệu và điều khoản cụ thể: **pháp chế xác nhận**)
  thay các quy định chi tiết của Nghị định 13 về đồng ý, hồ sơ đánh giá tác động và chuyển dữ
  liệu ra nước ngoài.
- **Dữ liệu là gì:** giọng nói, tên người dự họp (gửi cho STT làm keyterms), lời đã ghi, ghi
  chú, chat, tóm tắt và việc được giao. Đều là dữ liệu cá nhân của người dự họp; nội dung họp
  có thể chứa dữ liệu nhạy cảm (sức khỏe, tài chính, nhân sự). Tách người nói (micro hội trường)
  chỉ gán nhãn "người nói A/B" trong một phiên, không nhận dạng người bằng giọng; việc này có
  phải xử lý dữ liệu sinh trắc học hay không: **pháp chế xác nhận**.
- **Vai trò:** tổ chức khách hàng là bên kiểm soát dữ liệu của cuộc họp; UniWork là bên xử lý;
  các nhà cung cấp ở mục 2 là bên xử lý phụ của UniWork.
- **Căn cứ xử lý và thông báo:** người dự họp phải được báo trước và trong khi ghi (chip ghi
  lời trong phòng; khách và người gọi điện vào cũng phải được báo, issue #2 của benchmark), và
  file tải lên kèm xác nhận "Tôi đã thông báo cho người dự họp về việc ghi âm" (đã có, §7.5).
  Căn cứ là sự đồng ý của người dự họp hay hợp đồng của tổ chức với nhân viên: **pháp chế xác nhận**.
- **Chế tài:** Luật 91 phạt vi phạm chuyển dữ liệu ra nước ngoài theo tỉ lệ doanh thu năm trước
  (mức trần cụ thể: **pháp chế xác nhận**), nặng hơn nhiều so với Nghị định 13. Đây là lý do cờ
  không được bật cho khách trước khi hồ sơ ở mục 3 xong.

## 2. Bên xử lý phụ (sub-processor)

Danh sách này là bản công bố cho khách (đưa vào điều khoản/chính sách quyền riêng tư khi bật).
Cập nhật khi đổi nhà cung cấp (`SCRIBE_STT_PROVIDER`, `AI_MEETING_TRANSCRIBE_PROVIDER`,
`AI_PROVIDER`) hoặc vùng.

| Bên | Việc | Dữ liệu nhận | Nơi xử lý | Giữ bao lâu | Thỏa thuận |
|---|---|---|---|---|---|
| **AssemblyAI, Inc.** (Mỹ) | Ghi lời trực tiếp (Universal-3.6 Pro Streaming, từ `apps/meeting-agent`) và ghi lời file (API pre-recorded, từ server) | Âm thanh từng người nói; keyterms (tên cuộc họp, dự án, tên người dự họp); lời đã ghi | Mỹ mặc định; **EU** qua `api.eu.assemblyai.com` (file) và `streaming.eu.assemblyai.com` (trực tiếp). Không có vùng Việt Nam | File: server xóa bản ghi lời ngay sau khi lấy về (`DELETE /v2/transcript/{id}`). Trực tiếp: **chưa có cam kết bằng văn bản** về việc giữ âm thanh/lời của phiên streaming | **Chưa ký DPA** |
| **Anthropic PBC** (Mỹ) — khi `AI_PROVIDER=anthropic` | Mọi lời gọi model qua `ai.Gateway`: tóm tắt, biên bản, việc rút trong họp, phụ đề dịch, tóm tắt phần đã lỡ, Hỏi UNI | Lời đã ghi, ghi chú, chat, tên người, tên việc | Mỹ | Theo điều khoản API thương mại (thời hạn giữ và cam kết không dùng để huấn luyện: **xác nhận theo hợp đồng**) | **Chưa ký DPA** |
| OpenAI / máy chủ tự host qua `OPENAI_BASE_URL` / Ollama | Chỉ khi một môi trường đổi `AI_PROVIDER`; production hiện không dùng | Như dòng trên | Theo nhà cung cấp | — | Phải thêm vào bảng **trước** khi đổi |
| CMC Telecom (Việt Nam) — kho đối tượng `s3.hn-2.cloud.cmctelecom.vn` | Lưu file ghi âm cuộc họp và file âm thanh tải lên | File âm thanh/video | Việt Nam (Hà Nội) | Theo thời hạn lưu của tổ chức (chưa có lịch xóa tự động, issue #5) | Hợp đồng hạ tầng hiện có (**ops xác nhận**) |
| ~~BytePlus~~ | Đã bỏ ngày 2026-10-21 trước khi có dữ liệu thật (spec cha D14) | — | — | — | Không cần |

Không phải bên xử lý phụ: LiveKit (server tự vận hành trên hạ tầng của UniWork; âm thanh đi
qua SFU trong cụm, không tới LiveKit Inc.), PostgreSQL, Redis (trong cụm). Nhà cung cấp cụm
Kubernetes và vị trí trung tâm dữ liệu: **ops điền**.

## 3. Chuyển dữ liệu ra nước ngoài

Không nhà cung cấp STT hay LLM nào ở mục 2 xử lý tại Việt Nam, nên **mọi cuộc họp có thư ký AI
hoặc tóm tắt AI đều chuyển dữ liệu cá nhân ra nước ngoài**. Trước khi bật cho khách:

1. **Chọn một vùng cho cả hai đường STT** và ghi vào ADR 0045: file
   (`AI_MEETING_TRANSCRIBE_BASE_URL`) và trực tiếp (`SCRIBE_STT_BASE_URL` của agent, mặc định
   theo vùng của file; biến này do luồng sửa của agent thêm, xem `MEETINGS_AI_GO_LIVE.md`). Hai
   đường khác vùng là hai hồ sơ.
2. Lập **hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài** theo Luật 91 và nghị
   định hướng dẫn, gồm: bên nhận (mục 2), mục đích, loại dữ liệu, vùng, biện pháp bảo vệ (TLS,
   xóa bản ghi lời file, không log lời nói ở agent và server, token theo cuộc họp), thời hạn giữ.
   Nộp cơ quan có thẩm quyền theo thời hạn luật định (**pháp chế xác nhận** nơi nộp và thời hạn).
3. Ký **DPA** với AssemblyAI và Anthropic, có điều khoản chuyển dữ liệu quốc tế và thời hạn giữ
   cho cả streaming. Lấy cam kết bằng văn bản về âm thanh/lời của phiên streaming.
4. Cập nhật điều khoản với khách: tổ chức khách là bên kiểm soát, UniWork xử lý theo chỉ dẫn,
   danh sách bên xử lý phụ ở mục 2, cách tắt (cờ, công tắc "Tóm tắt tự động", nút tắt thư ký
   trong phòng).
5. Một tổ chức khách yêu cầu dữ liệu không ra khỏi Việt Nam: hiện chưa đáp ứng được (không có
   STT/LLM trong nước được tích hợp); để cờ tắt cho tổ chức đó.

## 4. Biện pháp kỹ thuật đã có

- Agent không log lời nói, chỉ id và độ dài (ADR 0045 quyết định 5); server log người bằng id
  (`scripts/no-pii-log.test.mjs`).
- Agent chỉ gọi `/api/v1/meetings/{id}/agent/*` bằng token `uwma_` theo cuộc họp, không có
  DB/Redis; không giữ khóa LLM (ADR 0045).
- Bản ghi lời file bị xóa ở AssemblyAI ngay khi server lưu xong (spec cha §7.5).
- Cách ly tenant ở tầng service và kiểm bằng `TestIsolationMatrix` (ADR 0008).
- Chưa có: sửa/xóa transcript, lịch giữ dữ liệu (issue #5), quyền đọc transcript hẹp hơn thành
  viên workspace (issue #4). Ghi vào hồ sơ là "đang làm" thay vì hứa.
