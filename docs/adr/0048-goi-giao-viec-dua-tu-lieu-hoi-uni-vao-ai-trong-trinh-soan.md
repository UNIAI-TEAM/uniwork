# 0048 — Gói giao việc đưa tư liệu Hỏi UNI vào AI trong trình soạn

**Trạng thái:** accepted (2026-10-28, UNI-2264). Chủ sản phẩm duyệt kế hoạch 4 của spec Hỏi UNI × Office ngày 2026-10-28 (`docs/superpowers/plans/2026-10-28-ask-uni-office-p4-handoff.md`).
**Issue:** UNI-2264 · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md), [0044](0044-hoi-uni-ghi-qua-de-xuat-tren-server-va-ba-che-do-quyen.md), [0029](0029-ai-cua-office-tren-web-qua-ai-gateway.md), spec `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md`, spec Office `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` §6.1, §6.3.

## Bối cảnh

Spec Office §6.1 và §6.3 giữ AI trong trình soạn (UniWork AI trong frame genoffice và app desktop) ở đúng tệp đang mở: chat không mở thành Hỏi UNI toàn workspace, và công cụ đọc tài liệu khác của workspace là một mở rộng riêng cần ADR. Luật đó chặn việc AI trong trình soạn tự đi đọc workspace.

Spec Hỏi UNI × Office (2026-10-27) muốn một luồng khác: người dùng nhờ Hỏi UNI soạn một tệp Office mới, Hỏi UNI đọc tư liệu (việc, dự án, cuộc họp, tài liệu…) dưới quyền của người hỏi, đưa yêu cầu, dàn ý và trích dẫn lên thẻ đề xuất. Người hỏi duyệt thẻ, Apply tạo tệp, rồi AI trong trình soạn làm phần soạn thật bằng công cụ editor. Để làm được, AI trong trình soạn cần biết việc đã duyệt và tư liệu đã trích, mà theo §6.1/§6.3 thì nó không được lấy tư liệu ngoài tệp đang mở.

Chỗ dễ bị "sửa" sai về sau: thấy tư liệu workspace trong hội thoại UniWork AI, người đến sau dễ tưởng đã có đường đọc workspace từ trình soạn, rồi mở rộng nó thành công cụ đọc tự do.

## Quyết định

1. **Tư liệu đi vào bằng gói, không bằng công cụ.** Khi người hỏi Apply thẻ `create_office_document`, server ghi một gói giao việc (`ai_office_handoffs`): yêu cầu, dàn ý chia thành phần, và các trích dẫn Hỏi UNI đã đọc dưới quyền người hỏi. Thẻ cho người hỏi thấy phần đầu của mỗi trích dẫn (200 ký tự đầu); gói mang trọn trích dẫn model đã dẫn (tối đa 1.500 ký tự) sang AI trong trình soạn. Gói chỉ sinh cho tài liệu Apply vừa tạo, không bao giờ cho một mẫu, và chỉ khi thẻ đã hứa AI sẽ soạn (`editor_ai` là `compose` hay `build`) và AI trong trình soạn vẫn chạy được lúc Apply; thẻ nói "tự soạn", hay thẻ cũ không có trường đó, thì Apply chỉ tạo tệp.
2. **Gói chỉ dùng được bởi đúng người hỏi, cho đúng tài liệu, trong 24 giờ.** Frame và app chỉ mang id gói (header `X-UniWork-AI-Handoff`); server đọc gói theo tổ chức, người, tài liệu, hạn dùng và hội thoại đã gắn. Mọi trường hợp khác bị bỏ qua lặng lẽ: lượt chạy như câu hỏi thường, không lỗi, không lộ gói có tồn tại hay không. Gói hết hạn bị máy quét xóa.
3. **Server mở rộng câu hỏi, từng phần một, và mỗi phần mang cả việc.** Lượt câu hỏi mang id gói hợp lệ được server nối thêm yêu cầu, toàn bộ dàn ý, phần cần làm và tư liệu — ở mọi phần, không chỉ phần đầu; chỉ câu mở đầu khác ("Continue the same job…" từ phần hai). Lý do: ngân sách lịch sử 48k token cắt các lượt cũ nhất khi tài liệu lớn dần, nên lượt đầu có thể đã rơi khỏi hội thoại lúc tới phần sau, và pack `office_uniwork_ai@5` đọc lượt cũ như dữ liệu chứ không như lệnh. Trần 8.000 ký tự vẫn áp lên chữ client gửi, không áp lên phần server thêm. Server trả `X-UniWork-AI-Handoff-Remaining` để frame biết còn mấy phần.
4. **Gói tăng phần khi câu trả lời đầu tiên của run được lưu.** Lượt câu hỏi mở run; ngay khi model trả lời lượt đó và transcript đã ghi, gói tăng một phần. Lỗi trước lúc đó (gateway, hạn giờ, ghi transcript) để nguyên phần, lượt sau làm lại phần ấy. Lỗi ở một vòng công cụ sau đó của cùng run không làm lại phần ấy: gói đã tăng, người dùng tự hỏi tiếp nếu phần đó dở dang.
5. **Tư liệu vào dưới dạng không tin cậy.** Mỗi trích dẫn nằm trong `<untrusted source="handoff:<kind>:<id>">`, đã thoát thẻ, và id do model viết chỉ giữ ký tự của id. Yêu cầu, dàn ý và phần cần làm là chữ người hỏi đã duyệt, đi như câu hỏi của người dùng, nhưng cũng được thoát thẻ vì do model viết, để không mở hay đóng được khối không tin cậy; câu client gửi kèm cũng vậy, vì nó mang tên tài liệu do model viết. Nội dung gói không vào audit, log hay metrics; log chỉ ghi id.

**Không mở:** AI trong trình soạn vẫn không có công cụ đọc workspace. Nó chỉ thấy những gì người hỏi đã đọc được và đã duyệt trên thẻ, nên gói không mở rộng quyền. Một công cụ đọc workspace phía server vẫn cần ADR riêng như §6.3 nói.

## Hệ quả

- Hội thoại UniWork AI của tài liệu vừa tạo chứa trích dẫn workspace. Đó là bản sao người hỏi đã duyệt, sống theo vòng đời của hội thoại (TTL của `ai_uniwork_conversations`), không phải một đường đọc mới.
- Tải lại trang làm mất id gói ở web: tài liệu vẫn mở, chỉ không giao việc tiếp. Cái giá: phải nhờ Hỏi UNI lại; đổi lại id không lọt vào URL hay lịch sử trình duyệt.
- Model của trình soạn không phân biệt được trích dẫn đúng hay sai so với nguồn hiện tại: `prepare` không đọc lại nguồn. Người hỏi là người duyệt.

## Cách kiểm

- Task 1 (`server/internal/service/ai_office_handoff_test.go`): `TestHandoffPartsSplitsTheOutline`, `TestOfficeHandoffLoadIsScopedToItsAskerAndDocument`, `TestOfficeHandoffAdvanceBindsOneConversation`, `TestOfficeHandoffSweeperDeletesOnlyExpiredRows`; migration lint và `TestIsolationMatrix` phủ bảng mới.
- Task 2 (`server/internal/service`): `TestAskCreateOfficeApplyWritesAHandoff`, `TestAskCreateOfficeApplyWithoutEditorAIWritesNoHandoff`, `TestAskCreateOfficeApplyWritesAHandoffOnlyForACardThatPromisedIt`, `TestAskCreateOfficeSourcesAreCheckedAndShown`, `TestAskCreateOfficeCardSaysWhetherTheEditorAICanRun`, `TestEditorAIGateReadsTheFrameGrantGates`.
- Task 3: `TestPlanUniworkTurnWithExpandsAfterTheQuestionCap` (`server/internal/ai`); `TestAIUniworkHandoffExpandsTheFirstQuestion`, `TestAIUniworkHandoffContinuationDoesTheNextPart`, `TestAIUniworkHandoffIgnoredOutsideItsScope`, `TestAIUniworkHandoffNotAdvancedWhenTheTurnFails`, `TestAIUniworkHandoffQuoteCannotCloseItsUntrustedBlock` (`server/internal/service`); `TestAIUniworkHandoffHeadersOnTheWire` (`server/internal/handler`); `TestCORSCarriesTheUniworkHandoffHeaders` (`server/internal/handler/router`).
