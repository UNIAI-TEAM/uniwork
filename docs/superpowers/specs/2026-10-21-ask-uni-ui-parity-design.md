# UniWork — Hỏi UNI: giao diện như ClickUp Brain (bổ sung spec Hỏi UNI v2)

> **Trạng thái:** in-progress — chủ sản phẩm duyệt 2026-10-21; kế hoạch: `docs/superpowers/plans/2026-10-21-ask-uni-p2b.md` (duyệt 2026-10-21); chưa có issue.

**Ngày:** 2026-10-21
**Bổ sung cho:** `docs/superpowers/specs/2026-10-16-ask-uni-agent-design.md` (gọi tắt "spec gốc"). File này thay một số quyết định ở §5.1 của spec gốc (xem §6); phần còn lại của spec gốc giữ nguyên.
**Làm sau:** P2 (UNI-2015, PR #389); trước P3.
**Liên quan:** ADR 0010, ADR 0033, ADR 0034 (P3); spec gốc §5.1, §5.3, §6.2, §6.5, §6.8, §6.10.

Mục ghi **(chủ sản phẩm chốt)** là quyết định của chủ sản phẩm trong buổi trao đổi ngày 2026-10-21. Mục ghi **(người viết quyết)** là lựa chọn của người viết spec; người xây dựng được đổi nếu có lý do và ghi lại.

---

## 1. Ý định

Sau khi P2 xong, chủ sản phẩm dùng thử Hỏi UNI cạnh ClickUp Brain và thấy UNI "mới ở mức cơ bản": gần như mọi phần đều chưa được như ClickUp. Họ nêu rõ: ô nhập và hàng nút chia không hợp lý, @ chưa hoạt động như mong đợi, và cần xem lại chi tiết giao diện.

Mục tiêu của phần bổ sung này: một người quen ClickUp Brain mở Hỏi UNI thấy cùng cảm giác. Ô nhập gọn trong một khung. Họ nhắc được task, tài liệu, người ngay trong câu. Câu trả lời nói thẳng về các đối tượng thật, bấm được. UNI cho thấy nó đang làm gì. Lịch sử tìm được.

Phần này chỉ gồm giao diện và phần **đọc**. Mọi việc ghi vẫn thuộc P3.

## 2. Nguồn hiểu biết

Theo spec gốc §5.5: chỉ dùng thử giao diện, không reverse engineering, không gọi private API. Ngày 2026-10-21, người viết dùng thử ClickUp Brain trên tài khoản ClickUp của chủ sản phẩm, và dùng thử Hỏi UNI bản P2 chạy local trong cùng trình duyệt. Mọi so sánh dưới đây đến từ hai lần dùng thử đó.

Những điều quan sát được ở ClickUp Brain (chỉ để tham khảo, không phải yêu cầu):
- **Ô nhập:** một khung bo tròn chứa chip vị trí đang mở, ô soạn có định dạng và hàng nút (+, Skills, model, mic, Gửi); cả khung sáng viền khi gõ.
- **@:** mở danh sách có tab (All, Tasks, Docs, Agents, People, Teams), icon theo loại, ảnh người làm, gạch dưới chữ khớp. Đối tượng chọn xong thành thẻ nằm giữa câu (icon trạng thái, tên, nhãn trạng thái).
- **Câu trả lời:** nhắc task/tài liệu thành thẻ trong câu, không có số chú thích. Rê chuột lên thẻ task hiện thẻ thông tin (trạng thái, người làm, hạn, ưu tiên). Mỗi tin có ảnh, tên, giờ.
- **Tiến độ:** khi đang chạy, dòng trạng thái nói việc đang làm ("Scanning October deadlines"). Khi xong, nó thu thành "Finished in 5 steps ›", bấm thì xổ các bước bằng lời.
- **Sau câu trả lời:** hàng nút (👍 👎, sao chép) và 2–3 gợi ý hỏi tiếp.
- **Màn trống:** logo và 4 gợi ý theo vị trí đang mở ("Summarize progress in Overview", "Find overdue tasks in Overview").
- **Lịch sử:** ô tìm, nhóm theo thời gian, giờ ở mỗi dòng, nút sửa/xóa khi rê chuột. Tên hội thoại do AI đặt ngắn ("Tasks Due This Month & Owners").

## 3. Mục tiêu, không làm, không được thành

**Mục tiêu**
1. Ô nhập một khung, nhắc đối tượng bằng @ ngay trong câu, trang đang mở tự thành ngữ cảnh.
2. Câu trả lời nhắc đối tượng thật thành thẻ bấm được, có thông tin khi rê chuột.
3. Người dùng thấy UNI đang làm gì, bằng lời dễ hiểu, cả khi đang chạy và sau khi tải lại.
4. Lịch sử tìm được, tên hội thoại ngắn gọn.
5. Sửa bốn lỗi logic thấy khi dùng thử (§4.6).

**Không làm ở phần này (chủ sản phẩm chốt)**
- Skill và lệnh "/": để sau. Spec gốc §3 vẫn giữ "prompt lưu sẵn `/`" trong danh sách không làm.
- Nút mic (nói thành chữ): để sau.
- Chế độ toàn trang: bỏ hẳn (§4.5).
- Nút @ trên hàng nút: không có, vì gõ @ là đủ.
- Các mục thuộc P3, không làm ở đây: nút "Tạo task / Tạo tài liệu" từ câu trả lời; gợi ý hỏi tiếp kiểu việc ghi ("Giao 2 việc này cho…"); sửa trường ngay trên thẻ hover.

**Không được thành**
- Một thẻ đối tượng trỏ tới thứ UNI không đọc trong hội thoại, hoặc người hỏi không được xem.
- Sao chép câu trả lời làm mất tên đối tượng.
- UNI trả lời bằng ngôn ngữ khác ngôn ngữ người hỏi dùng.
- Một tính năng mới tốn tiền không giới hạn: mỗi phần có gọi AI thêm đều có trần (§7.6).
- Gợi ý hoặc nút bấm trông như sẽ làm thay đổi dữ liệu trong khi P3 chưa có.

## 4. Quyết định (chủ sản phẩm chốt 2026-10-21, trừ chỗ ghi khác)

### 4.1 Ô nhập

- **Một khung:** chip ngữ cảnh, ô soạn và hàng nút nằm chung trong một khung bo tròn. Cả khung sáng viền khi ô soạn có focus. Không còn ô soạn có viền riêng với hàng nút nằm ngoài.
- **Trang đang mở tự thành chip:** mở Hỏi UNI (⌘J, nút trên thanh trên cùng, hay nút trên trang) khi đang ở trang một task, cuộc họp, tài liệu, dự án hoặc phòng chat, thì trang đó hiện sẵn thành chip "Trang này: <tên>".
  - Bấm × để bỏ chip; chip đã bỏ không quay lại cho tới khi người dùng sang trang khác.
  - Chữ gợi ý trong ô đổi theo loại trang ("Hỏi về task này…").
  - Ở trang không phải một đối tượng (danh sách task, trang chủ…) thì không có chip.
- **@ chèn thẳng vào câu:** gõ @ mở danh sách; chọn một mục thì mục đó thành **thẻ nằm giữa câu**.
  - Thẻ có icon loại; thẻ task có thêm nhãn trạng thái.
  - Một lần Backspace xóa cả thẻ.
  - Không còn chip riêng phía trên cho mục @, không còn chữ "@Tên" thô.
- **Danh sách @:**
  - Tab: Tất cả / Task / Tài liệu / Cuộc họp / Dự án / Người / Chat.
  - Mỗi dòng có icon loại. Task có nhãn trạng thái và ảnh người làm. Chữ khớp được gạch dưới. Dòng đang chọn có gợi ý ⏎.
  - Tìm được khi gõ không dấu. Điều khiển được bằng phím (↑ ↓ ⏎ Esc).
- **Nút "+" (phạm vi):** giữ như P2, nhưng dùng cùng kiểu danh sách với @ (tab, icon, tìm không dấu) và thêm nhóm Task.
- **Hàng nút:** trái là "+"; phải là chọn model và Gửi/Dừng. Không có nút @, không có mic. Chừa chỗ cạnh nút model cho nút chế độ quyền của P3.
- Giữ các luật đã có từ P0/P2:
  - Enter gửi, Shift+Enter xuống dòng.
  - Enter khi đang gõ dở Telex/VNI (đang composing) không gửi.
  - Ô tự giãn tới một chiều cao tối đa rồi cuộn.
  - Dán vào là chữ thường.

### 4.2 Câu trả lời

- **Nhắc thẳng đối tượng (phương án A).** UNI nhắc một task, tài liệu, cuộc họp, dự án, người hoặc phòng chat thì đối tượng đó hiện thành **thẻ trong câu**.
  - Thẻ task có icon trạng thái và nhãn trạng thái; thẻ người có ảnh đại diện; bấm thẻ thì mở đối tượng.
  - Không còn số chú thích trong câu và không còn hàng chip "[S2] …".
  - Thay đổi này thay quyết định "trích dẫn là số nhỏ trong câu" của spec gốc §5.1.
- **Nguồn:** cuối câu trả lời có dòng "Nguồn (n) ›", mặc định thu gọn; bấm thì xổ danh sách nguồn, mỗi dòng có icon loại và tên.
- **Dữ kiện vẫn phải có nguồn.** Spec gốc §5.2 vẫn giữ: một dữ kiện về công việc phải đi cùng thẻ của đối tượng nó lấy từ, ngay trong câu ("Theo 📄 Quy trình phát hành…, người phụ trách là…").
- **Rê chuột (hoặc focus bằng phím) lên thẻ:** hiện thẻ thông tin, **chỉ để xem**, có nút Mở. Nội dung theo loại (người viết quyết):
  - task: mã, tên, nơi chứa, trạng thái, người làm, hạn, ưu tiên;
  - tài liệu: tên, đoạn trích chữ thuần;
  - cuộc họp: tên, giờ;
  - dự án: tên, trạng thái;
  - người: tên, vai trò;
  - phòng chat: tên.
- **Mỗi tin có tên và giờ:** câu hỏi ghi tên người hỏi và giờ; câu trả lời ghi "UNI" và giờ.
- **Dòng tiến độ:**
  - Khi đang chạy, dòng này nói việc UNI đang làm bằng lời dễ hiểu, theo ngôn ngữ giao diện, ví dụ "Đang tìm task quá hạn…", "Đang đọc tài liệu Quy trình phát hành…".
  - Không còn khoảng trống không có dấu hiệu gì giữa hai bước, hay giữa bước cuối và chữ đầu tiên.
  - Khi xong, dòng thu thành "Xong sau n bước ›"; bấm thì xổ từng bước bằng lời.
  - Dòng này **còn sau khi tải lại trang**.
- **Hàng nút dưới câu trả lời:** sao chép, trả lời lại, 👍, 👎.
  - Sao chép đưa ra chữ thuần, mỗi thẻ thành tên đối tượng (không mất chữ).
  - Lượt bị dừng khi chưa có chữ không có nút sao chép và 👍👎.
- **Trả lời lại thay tại chỗ:**
  - Câu trả lời mới thay câu cũ ở cùng vị trí, không lặp lại câu hỏi.
  - Dùng lại đúng câu hỏi, chip trang và các @ của lượt đó.
  - Câu trả lời cũ không còn hiện và không đưa vào lịch sử gửi cho model.
- **Gợi ý hỏi tiếp:**
  - 2–3 câu sau câu trả lời cuối; bấm là gửi luôn.
  - Chỉ là câu hỏi để đọc, viết bằng ngôn ngữ của câu trả lời.
  - Không hiện sau lượt bị dừng hay lỗi.
  - Mỗi lượt có thể có hoặc không (người viết quyết: không ép model luôn đưa gợi ý).
- **Ngôn ngữ:** UNI trả lời bằng ngôn ngữ của câu hỏi. Ngôn ngữ giao diện chỉ dùng khi câu hỏi không rõ là tiếng gì (ví dụ chỉ có "ORI-3?").

### 4.3 Màn trống

- Logo UNI, dòng "Hỏi UNI về công việc", và 4 câu gợi ý theo trang đang mở; bấm là gửi luôn (kèm chip trang nếu có).
- Gợi ý là câu cố định theo loại trang, dịch qua i18n, **không gọi AI** (người viết quyết). Chỉ là câu hỏi để đọc.
- Bộ gợi ý tối thiểu (người viết quyết; người xây dựng được chỉnh câu chữ):
  - Trang task: "Tóm tắt task này", "Task này đang vướng ở đâu?", "Ai nên nhận task này?", "Việc nào liên quan đến task này?".
  - Trang dự án: "Tóm tắt tiến độ dự án này", "Việc nào của dự án đang trễ?", "Ai đang làm nhiều việc nhất trong dự án?", "Việc nào chưa có người làm?".
  - Trang cuộc họp: "Tóm tắt cuộc họp này", "Cuộc họp này chốt những gì?", "Việc nào được giao trong cuộc họp?", "Cần chuẩn bị gì cho cuộc họp?".
  - Trang tài liệu: "Tóm tắt tài liệu này", "Tài liệu này nói gì về hạn chót?", "Việc nào liên quan đến tài liệu này?", "Ai phụ trách nội dung này?".
  - Phòng chat: "Tóm tắt trao đổi gần đây", "Có việc nào được nhắc mà chưa thành task?", "Ai đang chờ trả lời?", "Chốt được gì trong phòng này?".
  - Trang khác: "Việc nào của tôi sắp trễ?", "Hôm nay tôi nên làm gì trước?", "Tóm tắt các cuộc họp tuần này", "Việc nào đang chờ tôi duyệt?".

### 4.4 Lịch sử và tên hội thoại

- Bấm tên hội thoại ở header mở danh sách lịch sử:
  - ô tìm theo tên, tìm được không dấu, trên mọi hội thoại của người dùng trong workspace;
  - nhóm Hôm nay / Hôm qua / 7 ngày qua / Cũ hơn;
  - mỗi dòng có giờ hoặc ngày;
  - hội thoại đang mở được tô màu;
  - nút đổi tên và xóa chỉ hiện khi rê chuột hoặc focus vào dòng.
- **Tên do UNI đặt:** sau câu trả lời đầu tiên của hội thoại, UNI đặt một tên ngắn (khoảng ≤ 40 ký tự) bằng ngôn ngữ của câu hỏi, ví dụ "Việc trễ dự án Q4".
  - Trước khi có tên đó, hoặc khi đặt tên lỗi, tên là câu hỏi đầu, cắt 80 ký tự như hiện nay.
  - Tên người dùng tự đổi **không bao giờ** bị ghi đè.

### 4.5 Bỏ chế độ toàn trang

- Header panel chỉ còn: icon UNI, tên hội thoại (bấm mở lịch sử), nút hội thoại mới, nút đóng. Bỏ nút mở toàn trang và chế độ toàn trang.
- Thay đổi này thay mục "nút mở toàn trang" của spec gốc §5.1.
- Panel vẫn dock bên phải, đẩy nội dung sang trái, kéo giãn 400–640px. Trên mobile vẫn mở toàn màn hình (đó là cách hiển thị, không phải một nút).

### 4.6 Bốn lỗi logic phải sửa

1. **Hỏi tiếp không được tự "đính chính".** Hiện tại câu trả lời cũ được gửi lại cho model kèm số [S#] nhưng không kèm nguồn (`history()` trong `server/internal/service/askuni.go`). Model tưởng các số đó là bịa và tự rút lại câu trả lời trước. Sau khi sửa, model biết các nguồn của lượt trước là nguồn thật đã đọc (§7.3).
2. **Ngôn ngữ trả lời theo câu hỏi**, như §4.2. Hiện prompt ép "Output language" theo ngôn ngữ giao diện.
3. **Trả lời lại giữ phạm vi và thay tại chỗ**, như §4.2. Hiện nó hỏi lại thành một lượt mới và bỏ mất chip/@ (comment ở `packages/views/ai/ask-uni-thread.tsx`).
4. **Dòng tiến độ có nghĩa**, như §4.2. Hiện chỉ có "Looked at 6 tasks" và danh sách lặp lại số đếm, có quãng im lặng dài khi đang chạy, và mất sau khi tải lại.

## 5. Chỗ chạm P3 (chủ sản phẩm chốt cách chia)

1. Gợi ý hỏi tiếp chỉ là câu đọc. Đề xuất ghi đến ở P3 dưới dạng thẻ đề xuất, không thành nút gợi ý.
2. "Tạo task / Tạo tài liệu" từ câu trả lời thuộc P3.
3. Hàng nút ô nhập chừa chỗ cho nút chế độ quyền của P3 (spec gốc §5.3), cạnh nút model.
4. Lượt có đề xuất hoặc thay đổi đã áp dụng (P3) **không có nút Trả lời lại**; P3 quyết chi tiết.
5. Câu hỏi để P3 quyết: chip trang tự gắn có làm hội thoại "nhiễm" (spec gốc §5.3 quy tắc 2) hay chỉ tính khi người dùng giữ chip lúc gửi. Phần này chưa có việc ghi nên chưa ảnh hưởng.

## 6. Thay đổi so với spec gốc

| Spec gốc | Phần bổ sung |
|---|---|
| §5.1 "nút mở **toàn trang**" | Bỏ (§4.5). |
| §5.1 "trích dẫn là số nhỏ trong câu… hàng chip nguồn" | Thẻ đối tượng trong câu + "Nguồn (n) ›" thu gọn (§4.2). |
| §5.1 ô nhập "các nút + (phạm vi), @ (nhắc …)" | Không có nút @; gõ @ chèn thẻ vào câu (§4.1). |
| §5.1 chip ngữ cảnh chỉ khi mở từ nút trên trang | Trang đang mở tự thành chip (§4.1). |
| §6.10 server không trả chuỗi tiếng Việt cố định | Giữ; câu tiến độ và gợi ý màn trống do client dịch (§7.4, §4.3). |
| §3 không làm "prompt lưu sẵn `/`" | Giữ; Skill và "/" để sau. |

Người viết sửa spec gốc trong cùng PR với file này: dòng trạng thái trỏ tới file này, và ghi chú ở §5.1 cho các mục đã thay.

## 7. Thiết kế kỹ thuật (người viết quyết, trừ chỗ ghi khác)

### 7.1 Thẻ đối tượng trong câu trả lời

- **Model viết số nguồn ở chỗ tên đối tượng.** Prompt mới (§7.2) yêu cầu: khi nhắc một đối tượng có số nguồn, viết `[S#]` *thay cho tên* của nó; client hiện `[S#]` thành thẻ với tên lấy từ nguồn. Ví dụ model viết "Dự án [S3] có 2 việc sắp trễ", panel hiện "Dự án ◆ Ra mắt app mobile Q4 có 2 việc sắp trễ". Như vậy server không phải tìm tên trong chữ, và thẻ luôn trỏ đúng thứ UNI đã đọc.
- **Client biết nguồn ngay khi đang stream.** Hiện `citations` chỉ đến cuối lượt. Server gửi thêm, mỗi khi một tool trả về nguồn mới, các bản ghi nguồn `{source_id, kind, id, title, href}`, có thể gộp vào sự kiện `step` hoặc thành một sự kiện mới. Nhờ vậy thẻ hiện được ngay khi `[S#]` xuất hiện trong chữ đang chạy. Sự kiện mới đi qua `parseWithFallback` và có test frame hỏng, theo spec gốc §6.5.
- **Số không có thật:** `[S#]` không có trong sổ nguồn của hội thoại thì không thành thẻ. `ParseAnswer`/`agentCitations` đã lọc citation lạ; người xây dựng chọn cách hiện chỗ đó sao cho câu vẫn đọc được (bỏ hẳn hoặc để chữ thường), và ghi lại.
- **Người là nguồn:** `list_members` (nguồn chung "Thành viên workspace", `askuni_agent_tools.go`) và `member_workload` (nguồn chung "Khối lượng việc") đổi thành mỗi người một nguồn, với `kind: "member"` và `Href` là trang người `paths.person(userId)` (`/{org}/{ws}/people/{userId}`). Link `/members?user=` mà `mentionedMember` đang dùng chuyển về trang cài đặt và bỏ mất người, nên `mentionedMember` cũng đổi sang trang người. Tên người làm nằm trong nội dung task vẫn là chữ; thẻ người chỉ có khi UNI đã đọc người đó qua hai tool trên hoặc qua @.
- **Thông tin trên thẻ là dữ liệu sống:** nhãn trạng thái, người làm và thẻ hover đọc qua các hook React Query sẵn có theo `kind` + `id`, không lưu vào `ai_messages.citations`. Người hỏi không còn quyền xem đối tượng thì thẻ hiện tên đã lưu, không có thông tin sống, và nút Mở dẫn tới trang báo không tìm thấy như mọi link khác.
- **Câu trả lời cũ** (P1/P2, viết "dữ kiện [S2]") hiện thẻ ở đúng chỗ số cũ. Đọc hơi lạ nhưng không mất thông tin; chấp nhận, không viết lại dữ liệu cũ.
- **Sao chép:** thay mỗi `[S#]` bằng tên đối tượng (thay cho việc xóa số như bản sửa ngày 2026-10-21).
- An toàn hiển thị theo spec gốc §6.8: thẻ chỉ trỏ href nội bộ của nguồn; tên đối tượng là chữ thuần.

### 7.2 Prompt `copilot_answer@4`

- Thêm luật viết `[S#]` thay cho tên đối tượng (§7.1) và luật gợi ý hỏi tiếp (§7.5).
- **Ngôn ngữ:** bỏ dòng ép `Output language: <locale>`. Thay bằng: trả lời bằng ngôn ngữ của câu hỏi; chỉ dùng `<locale>` khi câu hỏi không rõ là tiếng gì.
- Prompt mới là một phiên bản mới (`copilot_answer@4`); bản cũ giữ cho đến khi bản mới đạt bộ đánh giá spec gốc §8 với model "Tự động". Người xây dựng chạy bộ đánh giá với model thật trước khi bật, ghi kết quả, và hỏi chủ sản phẩm trước khi tốn tiền chạy (như các giai đoạn trước).
- **Mức đạt (chủ sản phẩm chốt 2026-10-21):** `@4` không được kém lần chạy đã ghi của `@3` (33/33 đúng, 6/6 bảo mật, $0.0076 mỗi câu). Cụ thể:
  - câu bảo mật vẫn 6/6;
  - sai tối đa 1 câu so với `@3`;
  - chi phí ≤ $0.10 mỗi câu;
  - đạt thêm các câu mới về ngôn ngữ trả lời và về thẻ đối tượng.
- Chưa đạt thì sửa prompt và chạy lại. Không bật giao diện mới với `@3`.

### 7.3 Lịch sử gửi cho model

- Mỗi câu trả lời cũ trong `history()` đi kèm danh sách nguồn của nó: số, loại, tên; không gửi lại nội dung. Prompt nói rõ: đó là các nguồn đã đọc thật ở lượt trước; muốn dữ kiện mới thì đọc lại bằng tool.
- Câu trả lời đã bị "trả lời lại" thay thế (§7.8) không vào lịch sử.

### 7.4 Dòng tiến độ

- Sự kiện `step` mang đủ để client viết câu: tên tool và một tham số ngắn an toàn để hiện, như từ khóa tìm hay tên đối tượng đang mở (tên lấy từ nguồn, không lấy từ model). Client có câu i18n cho từng tool, theo spec gốc §6.10.
- Giữa các bước, và từ bước cuối tới chữ đầu tiên, client luôn hiện một trạng thái "đang làm" có chuyển động.
- **Lưu lại:** các bước của một lượt được lưu cùng tin trả lời, cột mới trên `ai_messages` hoặc cách khác người xây dựng chọn, theo luật migration. Khi tải lại, dòng "Xong sau n bước ›" hiện đúng như lúc vừa chạy.

### 7.5 Gợi ý hỏi tiếp

- Model đưa 0–3 gợi ý ở cuối câu trả lời, trong một khối có đánh dấu mà server tách ra (người xây dựng chọn dạng). Server bỏ khối đó khỏi nội dung câu trả lời, gửi sự kiện riêng và lưu cùng tin trả lời.
- Server lọc: tối đa 3 gợi ý, mỗi gợi ý tối đa khoảng 120 ký tự, chữ thuần một dòng.
- Không tốn thêm lượt gọi model.

### 7.6 Tên hội thoại

- Sau khi lưu câu trả lời đầu tiên, server gọi model rẻ nhất trong allowlist một lần qua `ai.Gateway`, với capability riêng (ví dụ `copilot_title`): đầu vào là câu hỏi đầu và vài trăm ký tự đầu của câu trả lời, `max_tokens` nhỏ (≤ 32).
  - Lượt gọi này được tính phí và ghi usage như mọi lượt khác.
  - Lỗi hoặc hết quota thì giữ tên cũ, không báo lỗi cho người dùng.
- Chỉ ghi tên khi tên hiện tại vẫn là tên tự sinh. Cần biết hội thoại đã được người dùng đổi tên hay chưa (cột mới hoặc cách khác, theo luật migration).
- Tên mới đến client qua sự kiện cuối lượt hoặc bằng cách invalidate query danh sách hội thoại; không tạo kênh mới.

### 7.7 Ô soạn

- Dùng TipTap với extension mention sẵn có (`packages/views/editor/extensions/mention-extension.ts`, `mention-suggestion.tsx`) thay cho `Textarea` ở `packages/views/ai/ask-uni-composer.tsx`, hoặc một ô soạn nhẹ hơn dựng trên cùng nền. Người xây dựng chọn và ghi lý do.
- Phải giữ: hành vi Enter / Shift+Enter / composing; tự giãn; dán chữ thường; test ở `ask-uni-composer.test.tsx`.
- Khi gửi: chữ của câu hỏi có tên đối tượng ở chỗ thẻ (để lưu và hiện lại đúng), `mentions[]` là các thẻ trong câu (tối đa 5, như server đang kiểm), `focus` là chip trang hoặc chip phạm vi.
- Server đang nhận mention kinds `task, meeting, document, project, member` (`askMentionKinds`); thêm `room` để @ được phòng chat. Phòng chat vẫn kiểm quyền thành viên như khi là focus.
- Lượt người dùng lưu lại `focus` và `mentions` của nó (cột mới trên `ai_messages` hoặc cách khác), để trả lời lại dùng lại được (§7.8) và để hiện thẻ trong câu hỏi cũ.

### 7.8 Trả lời lại

- Client gửi yêu cầu "trả lời lại tin <id>", không gửi lại câu hỏi như một lượt mới. Server lấy câu hỏi, focus và mentions đã lưu của lượt đó, chạy lại với model và mức nỗ lực đang chọn ở ô nhập, rồi lưu câu trả lời mới.
- Câu trả lời cũ giữ dòng trong bảng nhưng được đánh dấu là đã bị thay. Nó không hiện, không vào lịch sử model. Đánh giá 👍👎 cũ của nó giữ nguyên.
- Chỉ trả lời lại được tin trả lời cuối của hội thoại (như hiện nay).

### 7.9 Ngữ cảnh trang

- Mỗi trang đối tượng (task, cuộc họp, tài liệu, dự án, phòng chat) khai báo đối tượng đang mở cho Hỏi UNI qua một hook trong `packages/views` (ví dụ `useAskUniPageContext({kind, id, label})`), ghi vào store Hỏi UNI trong `packages/core`. Đây là state phía client, theo luật state của repo.
- Composer hiện chip trang khi có ngữ cảnh trang và người dùng chưa bỏ nó. Nút "Hỏi UNI về …" trên trang vẫn hoạt động như P2.

### 7.10 Lịch sử

- Tìm theo tên trên mọi hội thoại của người dùng trong workspace, không chỉ trang đầu. Nếu `ListConversations` có giới hạn số dòng thì thêm tham số tìm phía server (query sqlc có tenant theo luật); nếu không thì lọc phía client. Người xây dựng kiểm và chọn.
- Nhóm theo ngày tính theo giờ địa phương của trình duyệt.

### 7.11 Gỡ chế độ toàn trang

- Gỡ `fullPage`/`setFullPage` khỏi `useAiPanelStore`, nút trong `ask-uni-header.tsx`, nhánh trong `ask-uni-dock.tsx`, khóa i18n `ai.full_page`/`ai.exit_full_page`, và test liên quan. `pnpm knip` phải sạch.

### 7.12 Trợ năng

- Thẻ trong câu là link có tên đọc được: loại + tên, ví dụ "Task: Sửa lỗi crash…". Thẻ hover mở được bằng focus bàn phím.
- Danh sách @ dùng mẫu combobox/listbox sẵn có của registry, có `aria-activedescendant`.
- Dòng tiến độ đang chạy có `role="status"`.

### 7.13 Bật ở đâu

- Cờ `ask_uni_stream` chỉ đổi phía client; server không chặn route stream (`featureflags/keys.go`). Vì vậy prompt `@4`, sự kiện nguồn khi stream, gợi ý hỏi tiếp, lưu bước và lượt gọi đặt tên **chỉ chạy trên route stream** (`POST …/ai/ask/stream`, panel mới).
- Route cũ `POST …/ai/ask` và panel cũ giữ `@3` và hành vi hiện tại cho tới khi P2 Task 16 gỡ chúng. Nếu không, panel cũ sẽ hiện `[S#]` thô thay cho tên.
- Sửa lịch sử kèm nguồn (§7.3) áp cho đường agent ở cả hai route: đó là sửa lỗi, không đổi định dạng câu trả lời.
- Đường P0 (khi `ask_uni_agent` tắt) không đổi gì: không gọi đặt tên, không đổi prompt.
- Trên production, người dùng chỉ thấy P2b khi chủ sản phẩm bật `ask_uni_stream`.

## 8. Lộ trình (người viết quyết)

- Một giai đoạn riêng **P2b**, issue riêng là sub-issue của epic UNI-415. Làm sau khi PR #389 (P2) merge vào develop, nhánh cắt từ develop, vẫn sau cờ `ask_uni_stream`.
- Gợi ý chia PR:
  1. Logic và prompt: §4.6, §7.2, §7.3, nguồn theo từng người (§7.1), sự kiện nguồn khi stream.
  2. Câu trả lời: thẻ đối tượng, hover, "Nguồn (n)", dòng tiến độ có lưu, gợi ý hỏi tiếp, trả lời lại tại chỗ, tên tin và giờ, tên hội thoại do UNI đặt.
  3. Ô nhập và khung: ô soạn một khung với @ trong câu, danh sách @ và "+" mới, chip trang, màn trống, lịch sử có tìm, gỡ toàn trang.
- Mỗi PR theo DoD của repo; test toàn bộ chỉ chạy ở cuối giai đoạn.

## 9. Test bắt buộc ngoài test thường lệ

- Một hội thoại hai lượt với fake provider: lượt hai không chứa câu tự đính chính, và lịch sử gửi cho model có danh sách nguồn của lượt một.
- Câu hỏi tiếng Việt khi giao diện tiếng Anh: prompt gửi đi không ép ngôn ngữ giao diện. Bộ đánh giá có câu kiểm ngôn ngữ trả lời.
- Thẻ: `[S#]` có thật thành thẻ đúng loại và tên; `[S#]` lạ không thành thẻ; sao chép ra tên.
- Trả lời lại: chỉ một câu hỏi trong thread; focus/mentions của lượt cũ được gửi lại; tin cũ không vào lịch sử model.
- Dòng tiến độ còn sau khi tải lại (đọc từ dữ liệu đã lưu).
- Tên hội thoại: không ghi đè tên người dùng đã đổi; lỗi gọi model giữ tên cũ; lượt gọi có dòng usage.
- Ô soạn: Enter khi đang composing không gửi; Backspace xóa cả thẻ; thẻ trong câu thành `mentions[]` đúng.
- Isolation: không route mới nào bỏ qua `TestIsolationMatrix`; mention `room` của phòng người hỏi không ở trong bị từ chối như focus.
- E2E (khi có AI provider): mở từ trang task có chip trang; @ một task; nhận câu trả lời có thẻ; tải lại thấy dòng tiến độ.

## 10. Để người xây dựng quyết

- Dạng sự kiện nguồn khi stream (gộp vào `step` hay sự kiện riêng).
- Cách hiện `[S#]` lạ.
- TipTap đầy đủ hay ô soạn nhẹ.
- Cột nào thêm vào `ai_messages`/`ai_conversations` (bước, gợi ý, focus/mentions, đã bị thay, tên do người đặt), theo luật migration.
- Dạng khối gợi ý hỏi tiếp trong câu trả lời của model.
- Câu chữ cụ thể của dòng tiến độ và gợi ý màn trống (vi + en).

## 11. Câu hỏi mở

- (P3) Chip trang tự gắn có tính là "nhiễm" hay không (§5 mục 5).
