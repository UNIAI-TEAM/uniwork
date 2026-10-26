# Log text dễ đọc khi xem từ Docker

> **Trạng thái:** in-progress

**Ngày:** 2026-10-23
**Issue:** chưa có. Tạo issue UniAI trước khi mở nhánh `feature/UNI-nnn-…` (luật "No issue, no code").

## 1. Mục tiêu

`docker logs` của server đang một màu. stderr trong container là pipe, không phải terminal, nên `tint` tắt ANSI (`NoColor`). Value của mọi field lại luôn sáng, nên ULID chiếm cả dòng.

Thành công khi, với `LOG_FORMAT` khác `json`:

- Docker không cần TTY vẫn thấy màu. Level, method, path, status, duration và câu lỗi nổi. Id lặp lại trên mọi dòng nằm cuối dòng và mờ.
- `grep` một `trace_id` hoặc `organization_id` vẫn trúng, vì id in đủ trên cùng dòng.
- `LOG_FORMAT=json` giữ `slog.JSONHandler`: một object mỗi dòng, không ANSI, thứ tự field không đổi.

## 2. Hiện trạng

`server/internal/logger.newHandler` chọn JSON khi `LOG_FORMAT=json`, còn lại là `tint` với `TimeFormat` `15:04:05.000` và `NoColor: !isTerminal(os.Stderr)`. `telemetry.WrapLogHandler` bọc phía ngoài và gắn `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id`, `actor_kind` cho lệnh `*Context`.

`RequestLogger` ghi message `http request` với `method`, `path`, `status`, `duration`, rồi `request_id`, `correlation_id`, và metadata client. 5xx là Error, 4xx là Warn, soft-404 (`runtime not found`, `task not found`) là Info, còn lại là Info.

`tint` v1.2.0 làm mờ key và để value sáng. `tint.Attr` tô value sáng theo màu, không làm mờ value. Không có API cho phần đuôi mờ. Code truyền `"err", err` hoặc `"error", err`, không gọi `tint.Err`.

`.env.example` khai báo `LOG_LEVEL` và `LOG_FORMAT`. `docs/ops/OBSERVABILITY.md` nói format text là «text màu cho terminal».

## 3. Chỗ format nằm và khi nào có màu

`RequestLogger` và mọi `slog.*` khác giữ nguyên lời gọi. `telemetry.LogHandler` vẫn gắn field trace và tenant trước khi ghi.

`newHandler`:

- `LOG_FORMAT=json` (không phân biệt hoa thường, có trim) → `slog.JSONHandler`. Không ANSI.
- Mọi giá trị khác, kể cả trống → handler text ở `server/internal/logger/text.go`.

Handler text tự viết mọi record không nằm trong group. Record nằm trong group (handler đã `.WithGroup` với tên khác rỗng) ủy thác cả dòng cho `tint`, cùng `TimeFormat` và cùng cờ màu. `tint` không còn là đường mặc định của dòng phẳng.

Màu của format text, đúng thứ tự này:

1. `NO_COLOR` sau trim còn khác rỗng → tắt. Biến trống hoặc không khai báo không tắt màu. `NO_COLOR` thắng `LOG_COLOR=always`.
2. `LOG_COLOR=never` → tắt.
3. `LOG_COLOR=auto` → bật chỉ khi stderr là terminal (`isTerminal` như hiện tại).
4. `LOG_COLOR=always`, trống, hoặc một giá trị khác ba từ trên → bật, kể cả stderr là pipe.

So sánh `LOG_COLOR` không phân biệt hoa thường, có trim. Khi màu tắt, dòng text vẫn xếp field theo mục 4, không có byte ESC.

`LOG_LEVEL` lọc trước khi format, như `tint` đang lọc. Handler trả lỗi của `Write`. `slog` nuốt lỗi đó. Request đã trả xong, nên một dòng log hỏng không đổi response. Logger không gọi `slog` khi ghi thất bại.

Mỗi `newHandler` tính màu một lần lúc tạo. `Init` và `NewLogger` đều đi qua `newHandler`, nên logger mặc định và logger có `component` dùng cùng quy tắc.

## 4. Một dòng text

Một record là một dòng vật lý, kết thúc bằng `\n`. Thời gian và nhãn level dùng cùng quy tắc `tint` v1.2.0: `15:04:05.000`, nhãn `DBG` / `INF` / `WRN` / `ERR` (kể cả hậu tố `+N` khi level lệch khỏi mốc). `DBG` không tô. `INF` xanh sáng, `WRN` vàng sáng, `ERR` đỏ sáng. Thời gian mờ. Message sáng.

Attr lấy từ `.With(...)` trước, rồi đến attr của record. Field trống (attr zero) bỏ. Key lặp thì in mỗi lần nó xuất hiện. Trong bộ mờ, các lần lặp của cùng một key đứng cạnh nhau theo thứ tự thu thập, đúng chỗ của key đó trong danh sách cố định. Mỗi đoạn màu reset trước field kế tiếp, nên đỏ của `err` hoặc `status` không nhuốm field sau.

Ba nhóm, từ trái sang phải:

1. Thời gian, level, message.
2. Phần sáng. Nếu message đúng `http request`: `method`, `path`, `status`, `duration` kéo lên đầu phần này, theo thứ tự đó. Key nào không có thì bỏ. Những attr khác không thuộc bộ mờ đi sau, theo thứ tự đã thu thập. Value sáng, key mờ. `status` chỉ được tô khi message là `http request` và value là số nguyên: 5xx đỏ, 4xx vàng, còn lại (2xx và 3xx) xanh. Không phải số thì in thường. Value của key đúng `err` hoặc `error` tô đỏ khi màu bật. `room_id`, `user_id`, `code`, `batch` và mọi id nghiệp vụ khác ở phần sáng.
3. Bộ mờ, cuối dòng, cả key và value mờ, theo thứ tự cố định này: `request_id`, `correlation_id`, `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id`, `actor_kind`. Key không có thì bỏ.

Ví dụ request lỗi, khi có màu (id viết tắt):

`15:04:05.402 ERR http request method=POST path=/api/v1/workspaces/…/chat/messages status=500 duration=12ms request_id=… trace_id=… organization_id=…`

`ERR` và `500` đỏ. `method`, path, `duration` sáng. Cụm id mờ. Soft-404 vẫn là `INF` xanh và `status=404` vàng.

Ví dụ lỗi nghiệp vụ:

`15:04:05.402 WRN chat: thread participants not read room_id=01H… error=timeout trace_id=… organization_id=… workspace_id=… actor_id=…`

`WRN` vàng. `room_id` sáng. `timeout` đỏ. Bốn id cuối mờ.

Mã ANSI, cùng bảng `tint` đang dùng: mờ `\033[2m`, xanh sáng `\033[92m`, vàng sáng `\033[93m`, đỏ sáng `\033[91m`, reset `\033[0m`.

Value format như `tint`: `error` thì `Error()`, duration thì `String()`, số và bool thì dạng thập phân, thời điểm thì RFC3339 với mili-giây. Format mà panic thì attr đó thành `!PANIC`, các attr sau vẫn ghi. Value cần quote (rỗng, có space, `=`, xuống dòng, ESC, hoặc byte không nằm trong tập an toàn của `tint`) thì quote bằng `strconv.Quote`. Dạng quote giữ `\n` và `\x1b`. Không giải mã `\x1b` trở lại byte ESC, kể cả khi màu bật. Value không cần quote thì ghi thẳng.

Dòng được lắp trong buffer rồi `Write` một lần dưới mutex, để hai goroutine không xen byte.

## 5. Cấu hình và tài liệu

`.env.example` thêm `LOG_COLOR` và `NO_COLOR` cạnh `LOG_FORMAT`, vì `scripts/env-example.test.mjs` bắt mọi `os.Getenv` của server. Comment nói rõ bốn bậc ở mục 3.

`docs/ops/OBSERVABILITY.md` sửa câu format text «màu cho terminal» và thêm một dòng `LOG_COLOR`. `LOG_FORMAT=json` vẫn là quy ước production. Spec này không sửa `docker-compose.prod.yml` và không sửa `docker-compose.observability.yml` (file đó đã đặt `LOG_FORMAT=json`). Ai chạy format text trong Docker sẽ thấy ANSI. Tắt bằng `LOG_COLOR=never` hoặc `NO_COLOR`.

Comment đầu `server/internal/logger/logger.go` sửa cho khớp: format text có màu cả khi stderr không phải terminal, trừ hai nút tắt ở trên.

## 6. Test

Test trong `server/internal/logger`, ghi vào `bytes.Buffer`. Không phụ thuộc stderr của tiến trình test có phải terminal hay không. Cờ màu truyền vào handler.

- `LOG_COLOR` trống → dòng có ANSI. `LOG_COLOR=never` và `NO_COLOR=1` → không byte ESC, thứ tự field giống lúc có màu. `LOG_COLOR=auto` tắt màu khi stderr không phải terminal. `LOG_FORMAT=json` ra một object JSON, không ANSI, và `LOG_LEVEL=warn` vẫn loại dòng Info.
- `http request` với `method`, `path`, `status=500`, `duration`, `room_id`, `trace_id`: bốn field đầu đứng trước `room_id`, `room_id` đứng trước `trace_id`. `status=500` nằm trong ANSI đỏ. Key và value `trace_id` mờ. Không có `duration` thì không có chuỗi `duration=`.
- Warn với `room_id`, `error`, `organization_id`: `room_id` và `error` đứng trước `organization_id`. Value `error` đỏ. `organization_id` mờ.
- `err` chứa xuống dòng hoặc ESC thì record vẫn một `\n` cuối dòng. ESC trong value là chuỗi `\x1b` đã quote. Khi màu tắt, dòng đó không có byte ESC.
- `.WithGroup("g")` in kiểu `tint`, có `g.method=GET`. `LOG_LEVEL=warn` thì dòng Info không được ghi.

`RequestLogger` không đổi. Test của nó vẫn gắn `slog.TextHandler` riêng.

## 7. Ngoài phạm vi

- Không lọc log presence.
- Không đổi thứ tự field JSON.
- Không đặt `tty: true` trên container.
- Không sửa từng chỗ gọi sang `tint.Err`.
