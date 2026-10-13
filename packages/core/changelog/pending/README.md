# Duyệt nội dung trên GitHub

Agent tự viết đầy đủ tiếng Việt và tiếng Anh, rồi mở một PR Changelog.
Người duyệt đọc mô tả PR hoặc <version>.md, comment/Request changes khi cần
và approve/merge khi đồng ý. Không cần tải artifact, điền nội dung, đổi tên
hoặc push file thủ công.

PR gồm <version>.json, <version>.md, releases.json và phần Changelog của hai
locale. Sau merge và deploy web, phiên bản xuất hiện trên /changelog.
ready: true là kết quả content review của agent; merge là quyết định của người.

CI kiểm snapshot, coverage commit, bản dịch, phạm vi file, dữ liệu cũ và sự
khớp giữa Markdown/JSON/catalog. Agent dùng scripts/changelog-review-pr.mjs
để chuẩn bị đề xuất; không tự merge, tag hay publish. Stable tag cũ vẫn là
lựa chọn cho các lần phát hành GitHub Release.

Xem docs/public-changelog.md và docs/engineering/changelog-review-agent.md.
