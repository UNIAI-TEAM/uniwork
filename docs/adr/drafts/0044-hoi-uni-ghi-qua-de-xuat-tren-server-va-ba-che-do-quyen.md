# 0044 — Hỏi UNI ghi qua đề xuất lưu trên server, ba chế độ quyền, lượt bị nhiễm thì phải hỏi

**Trạng thái:** proposed (UNI-2148, 2026-10-23). Viết theo spec
`docs/superpowers/specs/2026-10-16-ask-uni-agent-design.md` §6.4, nơi nó được gọi là "ADR 0034": số đó đã
là [0034](../0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) (khóa BYOK cho desktop), 0038–0041
giữ cho các bản nháp khác, nên dùng 0044. Chấp nhận thì chuyển ra `docs/adr/`, thêm vào bảng của
`README.md`; luật vào `CLAUDE.md` cùng PR với các test giữ luật bên dưới.
**Mở rộng:** [0033](../0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md) (tool ghi qua MCP chạy bằng
actor human) sang kênh Hỏi UNI. [0010](../0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) giữ
nguyên cho agent runtime.
**Liên quan:** [0007](../0007-actor-kind-agent-la-actor-hang-nhat.md) (actor),
[0008](../0008-cach-ly-tenant-o-tang-service.md) (tenant), [0009](../0009-audit-va-outbox-cung-transaction.md)
(audit + outbox), spec A-01 `2026-09-04-agent-actor-model-design.md` (bảng `agent_action_proposals`), spec
`2026-10-21-ask-uni-ui-parity-design.md` §5 (chỗ chạm P3).

## Bối cảnh

Hỏi UNI (P0–P2b, gắn file) chỉ đọc: `TestAskUniToolsAreReadOnly` giữ registry không có tool ghi. Chủ sản
phẩm đã duyệt P3: UNI làm thay đổi thay người hỏi (tạo, sửa task, dự án, cuộc họp, tài liệu, bình luận,
gửi chat) theo một trong ba chế độ người dùng tự chọn (spec §5.3). Spec cũng chốt bốn quy tắc giữ ở mọi
chế độ: việc hàng loạt hay khó đảo luôn hỏi từng việc; lượt đọc nội dung không do người hỏi viết thì mọi
thay đổi thành đề xuất, và cả hội thoại giữ trạng thái đó; admin tổ chức đặt mức cao nhất, mặc định Hỏi
trước; không có chế độ "bỏ qua quyền".

Hai ADR gần nhất không khớp hẳn:

- ADR 0010 nhắm agent tự chạy, không người nào khởi động lệnh. Hỏi UNI do người hỏi khởi động, giống MCP.
- ADR 0033 cho tool ghi MCP chạy ngay, vì client AI (Claude, ChatGPT…) hỏi người dùng trước mỗi lệnh ghi.
  Trong Hỏi UNI, chính UniWork là client: lời gọi tool của model chỉ là ý định, chưa có ai xác nhận. Model
  lại đọc nội dung người khác viết, nên một câu cài trong task của người khác có thể khiến model gọi tool
  ghi mà người hỏi không hề nhờ.

## Quyết định

1. **Actor là người hỏi.** Lệnh ghi chạy bằng `service.Human(askerID)`, qua `RequireMember` như màn hình
   và như MCP (0033 §1–§2). Dòng audit của lệnh nghiệp vụ mang `metadata.via` với `kind: "ask_uni"` và id
   của đề xuất. ADR 0010 giữ nguyên cho agent runtime: ranh giới vẫn là ai khởi động lệnh.

2. **Model không bao giờ chạy lệnh ghi trong vòng agent.** Tool ghi của Hỏi UNI chỉ kiểm tham số, đọc đối
   tượng đích, rồi ghi một **dòng đề xuất** vào bảng `agent_action_proposals` (thiết kế của A-01, tạo trong
   P3, `source = ask_uni`; agent runtime sau này dùng chung bảng). Server chỉ chạy lệnh nghiệp vụ khi:
   - người hỏi bấm Áp dụng (từng dòng, "Áp dụng tất cả", hoặc duyệt cả kế hoạch); hoặc
   - lượt đó ở chế độ Tự động, dòng đó mức 1 và lượt không bị nhiễm (mục 4). Khi đó server chạy dòng ở
     **cuối lượt**, sau khi vòng agent đã đọc xong, để một dòng gọi sớm không thoát được việc đọc nhiễm về
     sau trong cùng lượt.

   Lệnh chạy là **đúng lệnh service** mà tool ghi MCP cùng tên chạy; một lượt bị dừng, lỗi hay bị từ chối
   không lưu đề xuất nào.

3. **Mức do code quyết, theo tham số và đối tượng đích đọc lúc đề xuất.** Model không khai mức.
   - **Mức 1:** mọi thay đổi chỉ chạm đối tượng của chính người hỏi, không thông báo cho ai khác, và tool có
     lệnh ngược chạy được. "Của chính người hỏi" nghĩa là người hỏi tạo ra nó và mọi dòng audit của nó đều do
     người hỏi.
   - **Mức 2:** mọi thay đổi khác: người khác thấy hoặc được báo, đối tượng của người khác, gửi chat.
   - **Mức 3:** một lệnh chạm hơn 10 đối tượng, xóa, gửi ra ngoài tổ chức, đổi quyền. Hỏi UNI **không có**
     tool mức 3: không có tool xóa, không gửi ra ngoài, không đổi quyền; mời họp tối đa 10 người một lệnh;
     một lượt tối đa 10 dòng đề xuất.

4. **Lượt bị nhiễm.** Server đánh dấu mỗi thứ lượt đã đọc là "do người hỏi viết" hay không; không rõ thì
   tính là không. Đọc nghĩa là: kết quả tool, chip trang và @mention **đã gửi kèm câu hỏi**, file gắn kèm.
   Một chip người dùng đã bấm × thì không được gửi, không được đọc, không tính. Chỉ một thứ không do người hỏi
   viết là đủ làm lượt bị nhiễm; hội thoại giữ dấu nhiễm mãi (`ai_conversations.tainted_at`), và hội thoại
   có lượt trước khi server biết đếm nhiễm cũng tính là nhiễm. Ở chế độ Tự động, lượt bị nhiễm xử lý như Hỏi
   trước. Ở chế độ Kế hoạch, bước duyệt kế hoạch chính là xác nhận (spec §6.11 #2).

5. **Ba chế độ, một trần, một công tắc.**
   - Chế độ của người dùng: Hỏi trước (mặc định), Kế hoạch, Tự động; lưu theo người
     (`users.ask_uni_mode`).
   - Trần của tổ chức (`organizations.ask_uni_write_ceiling`): `off` < `ask` < `plan` < `auto`. Chưa đặt
     nghĩa là `plan`: Tự động cần admin mở. `off` là công tắc ghi riêng của Hỏi UNI, tách khỏi công tắc ghi
     MCP.
   - Server kẹp chế độ vào trần ở **mọi** lượt và **mọi** lần áp dụng. Flag rollout `ask_uni_actions`, tắt
     thì không có tool ghi, không có nút.

6. **Một cổng ghi dùng chung.** `mcpWriteRefusal` chuyển từ handler xuống service, thành cổng chung cho cả
   MCP và Hỏi UNI. Mỗi kênh thêm điều kiện riêng:
   - MCP: scope `write`, công tắc ghi MCP, ngân sách theo grant.
   - Hỏi UNI: flag, trần tổ chức, ngân sách theo người.

7. **Áp dụng và hoàn tác là lệnh của người.**
   - Chỉ người đã hỏi áp dụng, sửa, bỏ qua hay hoàn tác được đề xuất của mình.
   - Áp dụng thì server kiểm lại tham số như input mới (kể cả phần người dùng sửa ở nút Sửa). Đề xuất hết
     hạn sau 24 giờ. Đối tượng đã đổi `revision` kể từ lúc đề xuất thì bị từ chối.
   - Mỗi tool khai **lệnh ngược** chạy được, có canh `revision`. Nút Hoàn tác chỉ hiện cho dòng đã áp dụng có
     lệnh ngược. Tool không có lệnh ngược thì không được là mức 1.
   - Áp dụng, bỏ qua, hoàn tác đều ghi `audit_events` (`ai_proposal.applied`, `ai_proposal.rejected`,
     `ai_proposal.undone`). Lệnh nghiệp vụ bên dưới ghi audit và outbox của nó như mọi lần.

8. **Hiển thị.** Thẻ đề xuất hiện thay đổi trước → sau. Bình luận và chat hiện nguyên văn chữ sẽ đăng và
   ai sẽ thấy, ai sẽ được báo (spec §6.8). Gợi ý hỏi tiếp vẫn chỉ là câu đọc. Lượt có đề xuất hoặc thay đổi
   đã áp dụng không có nút Trả lời lại.

## Hệ quả

- `TestAskUniToolsAreReadOnly` thay bằng các test giữ luật bên dưới, cùng PR với dòng luật trong
  `CLAUDE.md` (mục Audit and Events).
- Bảng mới `agent_action_proposals`; cột mới `ai_conversations.tainted_at`, `ai_conversations.taint_tracked`,
  `users.ask_uni_mode`, `organizations.ask_uni_write_ceiling(_by/_at)`. `audit.Via` có thêm id đề xuất.
- **Cái giá:**
  - Trong workspace dùng chung, gần như lượt nào đọc dữ liệu cũng bị nhiễm, nên chế độ Tự động hầu như chỉ
    tự làm việc riêng không cần đọc ("tạo cho tôi task gọi khách thứ Sáu"). Chủ sản phẩm chọn an toàn trước.
  - Đếm nhiễm tốn thêm một query audit có index cho mỗi vòng tool.
  - Áp dụng là ba bước: giữ dòng, chạy lệnh nghiệp vụ trong transaction của nó, ghi kết quả. Server tắt giữa
    bước hai và ba để lại dòng "đang áp dụng". Thẻ báo "chưa rõ đã áp dụng chưa"; `metadata.via` của dòng
    audit nghiệp vụ cho biết lệnh đã chạy hay chưa.

## Test giữ luật

- `TestAskUniWriteToolsDeclareLevelAndUndo`: mọi tool ghi của Hỏi UNI có hàm phân mức và lệnh ngược; mức 1
  kéo theo lệnh ngược; không tool nào xóa; không tool nào chạm quá 10 đối tượng.
- `TestAskUniLoopNeverRunsAWriteCommand`: trong vòng agent, tool ghi chỉ ghi dòng đề xuất, không đổi bảng
  nghiệp vụ nào.
- `TestAskUniTaintedTurnNeverAutoApplies`: injection trong task của người khác, chế độ Tự động, chỉ ra đề
  xuất; hội thoại giữ dấu nhiễm sang lượt sau.
- `TestAskUniModeIsClampedToTheCeiling`: trần tổ chức và mặc định Hỏi trước, ở lượt hỏi và ở lúc áp dụng.
- `TestAskUniOnlyTheAskerDecidesAProposal`: người khác (cùng hoặc khác tổ chức) không áp dụng, bỏ qua, hoàn
  tác được; isolation matrix có route mới và `isoReferences` cho `proposal_ids`.
- `TestAIWriteGateIsShared`: MCP và Hỏi UNI đi qua cùng một cổng ghi trong service.
- `audit_coverage_test.go` có ba lệnh áp dụng, bỏ qua, hoàn tác và lệnh đặt trần tổ chức.
