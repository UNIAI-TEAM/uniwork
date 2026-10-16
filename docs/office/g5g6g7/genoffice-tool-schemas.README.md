# genoffice-tool-schemas.json — schema công cụ thật cho holdout G7-12 (G6-09 W10, R2)

`genoffice-tool-schemas.json` **do script sinh, không sửa tay**. Nó là tệp `--tool-schemas` của
`scripts/office/g5g6g7/holdout-run.mjs`: tên, mô tả và `inputSchema` đầy đủ của mọi công cụ docs / sheets / slides / pdf /
markdown / html, đọc từ fork ở đúng rev của khối trích xuất trong [genoffice-tools.md](genoffice-tools.md) §3
(`header.rev`). Khóa `catalogue` ghi từng hàng của bảng; công cụ có `descriptionComplete: false` là công cụ mà frame dựng mô
tả lúc chạy từ mã sản phẩm (`opNames()`, `buildOpsGuide()`…): tệp giữ schema thật và phần chữ nguyên văn của mô tả, đặt
`[generated at runtime]` ở chỗ mã chạy, nên holdout chạy các công cụ đó với mô tả rút gọn.

Công cụ mà extractor không phân giải được `inputSchema` — ô trong bảng §3 là `unresolved:<lý do>`, hiện là
`generate_mindmap` ở docs và markdown, vì `inputSchema` của nó trải helper có tham số `nodeSchema(maxDepth)` — vẫn có
hàng trong `catalogue` nhưng không được chào: `offered: false`, `schemaComplete: false`, `inputSchemaSha256: null`, kèm
`reason`, `tableHash` giữ nguyên ô `unresolved:<lý do>` của bảng, và công cụ đó không nằm trong mảng module nào gửi cho
model (`genoffice-tool-schemas.test.mjs` liệt kê đúng hai hàng này trong `UNRESOLVED_SCHEMA_TOOLS`; hàng thứ ba, hay chữ
`unresolved:` trong mảng module, là lỗi).

Sinh lại (khi khối trích xuất đổi rev, cùng lúc với bảng; `FORK` là worktree fork ở nhánh
`feature/UNI-1374-g6-09-ai-edit-undo` — `c7d1653c0` là bản đã sinh tệp hiện tại, và là nơi có `--emit-schemas` cho tới
khi extractor vào fork `main`; nhánh này đã chứa bản sửa `f0fead829`, và schema nó sinh khớp từng ô hash trong bảng §3
trừ hàng `docs/set_page_setup` đã ghi trong test):

```bash
node "$FORK/scripts/genoffice-tools-extract.mjs" --repo "$FORK" --rev <rev trong header khối §3> \
  --emit-schemas docs/office/g5g6g7/genoffice-tool-schemas.json
node --test scripts/office/g5g6g7/genoffice-tool-schemas.test.mjs
```

`genoffice-tool-schemas.test.mjs` giữ tệp khớp khối trích xuất (cùng rev, cùng danh sách công cụ theo module) và khớp
`holdout-backend.mjs`. Mở rộng phần công cụ mà harness ánh xạ là việc của g6-ai_server, không phải của tệp này.
