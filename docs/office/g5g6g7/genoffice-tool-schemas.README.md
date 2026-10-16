# genoffice-tool-schemas.json — schema công cụ thật cho holdout G7-12 (G6-09 W10, R2)

`genoffice-tool-schemas.json` **do script sinh, không sửa tay**. Nó là tệp `--tool-schemas` của
`scripts/office/g5g6g7/holdout-run.mjs`: tên, mô tả và `inputSchema` đầy đủ của mọi công cụ docs / sheets / slides / pdf /
markdown / html, đọc từ fork ở đúng rev của khối trích xuất trong [genoffice-tools.md](genoffice-tools.md) §3
(`header.rev`). Khóa `catalogue` ghi từng hàng của bảng; công cụ có `descriptionComplete: false` là công cụ mà frame dựng mô
tả lúc chạy từ mã sản phẩm (`opNames()`, `buildOpsGuide()`…): tệp giữ schema thật và phần chữ nguyên văn của mô tả, đặt
`[generated at runtime]` ở chỗ mã chạy, nên holdout chạy các công cụ đó với mô tả rút gọn.

Công cụ mà extractor không phân giải được `inputSchema` — ô trong bảng §3 là `unresolved:<lý do>` — vẫn có hàng trong
`catalogue` nhưng không được chào: `offered: false`, `schemaComplete: false`, `inputSchemaSha256: null`, kèm `reason`,
`tableHash` giữ nguyên ô `unresolved:<lý do>` của bảng, và công cụ đó không nằm trong mảng module nào gửi cho model. Từ
G6-09d (`3e4e9b71f`, nhánh `feature/UNI-1825-g6-09d-extractor`), extractor gấp mũi tên đệ quy có tham số
`nodeSchema(maxDepth)` nên cả hai hàng `generate_mindmap` ở docs và markdown đều phân giải thành hash
`ad838ec1782297153a2f798b110c62ef30e050ee6656615f7d4ff6a7f9c925e0` (`offered: true`, `schemaComplete: true`), và
`UNRESOLVED_SCHEMA_TOOLS` trong `genoffice-tool-schemas.test.mjs` nay rỗng (`[]`; bất kỳ hàng `unresolved:` nào hoặc chữ
`unresolved:` trong mảng module là lỗi).

Sinh lại **cả hai tạo phẩm** cùng lúc khi khối trích xuất đổi rev (`header.rev` và `header.mechanicalBlockSha256` của tệp JSON phải
khớp khối §3 trong `genoffice-tools.md`; `FORK` là worktree fork `/home/ubuntu/orca/workspaces/uniwork-office/feature-UNI-1374-g6-09-ai-edit-undo`
và extractor G6-09d ở `3e4e9b71f`, nhánh `feature/UNI-1825-g6-09d-extractor`, blob `4a7fbf1d67b8649265f205443439cd14e9537682` cho tới khi vào
fork `main`; ở `REV=3e4e9b71f` khối §3 có 143 dòng, sha256 `235ceb7a82b5c0d3a11315314eb6dbf68de2d6cbedf29f12aace8fb4599e9b95`, và schema sinh
ra khớp từng ô hash trong bảng §3 trừ hàng `docs/set_page_setup` đã ghi trong test):

```bash
REV=3e4e9b71f # hoặc <rev mới>
git -C "$FORK" show 3e4e9b71f:scripts/genoffice-tools-extract.mjs > /tmp/extractor-3e4e9b71f.mjs

# 1. Sinh lại khối trích xuất §3, ghép giữa hai marker của genoffice-tools.md và kiểm AC-2 từng byte
node /tmp/extractor-3e4e9b71f.mjs --repo "$FORK" --rev "$REV" > /tmp/extract.md
awk '
  /^<!-- extract:begin -->$/ {
    print
    while ((getline line < "/tmp/extract.md") > 0) print line
    close("/tmp/extract.md")
    skip = 1
    next
  }
  /^<!-- extract:end -->$/ { skip = 0 }
  !skip { print }
' docs/office/g5g6g7/genoffice-tools.md > /tmp/genoffice-tools.md && \
  mv /tmp/genoffice-tools.md docs/office/g5g6g7/genoffice-tools.md
sed -e '1,/^<!-- extract:begin -->$/d' -e '/^<!-- extract:end -->$/,$d' \
  docs/office/g5g6g7/genoffice-tools.md | diff - /tmp/extract.md && echo AC-2 OK

# 2. Sinh tệp schema JSON ở cùng rev và chạy test đối chiếu hai tạo phẩm
node /tmp/extractor-3e4e9b71f.mjs --repo "$FORK" --rev "$REV" \
  --emit-schemas docs/office/g5g6g7/genoffice-tool-schemas.json
node --test scripts/office/g5g6g7/genoffice-tool-schemas.test.mjs
```

`genoffice-tool-schemas.test.mjs` giữ tệp khớp khối trích xuất (cùng rev, cùng danh sách công cụ theo module) và khớp
`holdout-backend.mjs`. Mở rộng phần công cụ mà harness ánh xạ là việc của g6-ai_server, không phải của tệp này.
