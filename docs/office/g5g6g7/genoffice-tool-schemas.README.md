# genoffice-tool-schemas.json — schema công cụ thật cho holdout G7-12 (G6-09 W10, R2)

`genoffice-tool-schemas.json` **do script sinh, không sửa tay**. Nó là tệp `--tool-schemas` của
`scripts/office/g5g6g7/holdout-run.mjs`: tên, mô tả và `inputSchema` đầy đủ của mọi công cụ docs / sheets / slides / pdf /
markdown / html, đọc từ fork ở đúng rev của khối trích xuất trong [genoffice-tools.md](genoffice-tools.md) §3
(`header.rev`). Khóa `catalogue` ghi từng hàng của bảng; công cụ có `descriptionComplete: false` là công cụ mà frame dựng mô
tả lúc chạy từ mã sản phẩm (`opNames()`, `buildOpsGuide()`…): tệp giữ schema thật và phần chữ nguyên văn của mô tả, đặt
`[generated at runtime]` ở chỗ mã chạy, nên holdout chạy các công cụ đó với mô tả rút gọn.

Sinh lại (khi khối trích xuất đổi rev, cùng lúc với bảng; `FORK` là worktree fork ở nhánh
`feature/UNI-1374-g6-09-ai-edit-undo` — nơi có `--emit-schemas` cho tới khi extractor vào fork `main`):

```bash
node "$FORK/scripts/genoffice-tools-extract.mjs" --repo "$FORK" --rev <rev trong header khối §3> \
  --emit-schemas docs/office/g5g6g7/genoffice-tool-schemas.json
node --test scripts/office/g5g6g7/genoffice-tool-schemas.test.mjs
```

`genoffice-tool-schemas.test.mjs` giữ tệp khớp khối trích xuất (cùng rev, cùng danh sách công cụ theo module) và khớp
`holdout-backend.mjs`. Mở rộng phần công cụ mà harness ánh xạ là việc của g6-ai_server, không phải của tệp này.
