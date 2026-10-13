# Changelog công khai — C-07 / UNI-1310

Route /changelog, mục riêng trên thanh menu chính và footer của landing. Tham khảo cấu
trúc multica.ai/changelog: mục lục theo tháng, phiên bản/ngày, các nhóm tính
năng mới, cải tiến và sửa lỗi. Giữ bộ chữ, logo và giao diện sáng/tối UniWork.
Không cần đăng nhập; không có log giám sát hoặc dữ liệu người dùng.

## Phiên bản đầu

Người dùng chốt **v1.0.0 cho phiên bản hiện tại**, ngày 2026-10-12. Đây là mốc
đầu tiên của Changelog ứng dụng, không phải bản sao tag Office desktop.
Nội dung ban đầu dựa trên origin/develop 4b7bd3fc082e033c317b9794b4d9b6a949cb92f0:

- Công việc/dự án, chat, cuộc họp và Hỏi UNI: route và UI hiện có của ứng dụng.
- UniWork Office: fc171d4a2 / PR219, tích hợp sáu trình soạn và mở/lưu desktop.
- Ảnh email theo người gửi tin cậy: 4a7029ed9 và 9f1417796 / PR218.
- Form kết nối và kết nối lại: d59fe7000, e9d3cfde2, e16219ba8 / PR223.
- Trạng thái hộp thư: e8ce941ab. Hộp thoại trên màn hình nhỏ: 75753d87f.
- Trang giới thiệu/hướng dẫn: 9681b51f4 và các bản cập nhật landing đã merge.

Không bịa phiên bản cũ hoặc ngày phát hành trước mốc này. Tính năng AI và kết
nối email giữ điều kiện cấu hình/quyền như trong ứng dụng.

## Luồng tự động cho cả team

Workflow: `.github/workflows/changelog.yml`. Việc push/merge code vào develop
gom thay đổi vào bản nháp; số phiên bản công bố vẫn gắn với tag phát hành.

1. **Push/merge vào develop:** CI đọc toàn bộ commit kể từ `sourceRef` của bản
   đã công bố, tạo artifact `changelog-unreleased` và summary trong Actions.
   JSON chứa commit gốc, nhóm thay đổi, đề xuất số phiên bản và các ô Việt/Anh.
   Sau khi lưu artifact, CI gọi webhook của **UniWork Changelog Reviewer**
   trên UniAI nếu đã cấu hình secret. Webhook chỉ gửi repo, ref, SHA và link
   Actions; agent luôn xác minh develop trực tiếp thay vì tin payload.
   `feat` đề xuất tăng minor; breaking change tăng major; còn lại tăng patch.
   Commit bắt đầu bằng UNI-nnn hoặc không đúng convention vẫn được giữ để
   phân loại, không tự loại bỏ.
2. **Duyệt nội dung một lần:** lấy `unreleased.json` từ lần chạy mới nhất, lưu
   thành `packages/core/changelog/pending/<version>.json`. Điền title, summary,
   note và text Việt/Anh; chọn include/exclude cho từng commit, ghi lý do loại.
   Chốt date/version và `ready: true`. Review và merge file notes vào develop.
   Lần merge này chỉ sửa notes để code vẫn đúng với snapshot `sourceRef`.
3. **Đẩy tag stable vMAJOR.MINOR.PATCH:** CI đọc notes từ chính commit được tag,
   kiểm tra đầy đủ bản dịch, ancestry, baseline và các quyết định phân loại.
   Nếu code thay đổi sau snapshot, CI dừng với lỗi stale; cập nhật draft và
   duyệt lại trước khi tag. Tag Office hoặc prerelease không được công bố bằng
   luồng Changelog ứng dụng.
4. **Công bố tự động:** CI tạo catalog + nội dung Việt/Anh, mở PR vào develop
   và bật auto-merge theo các checks/review bắt buộc của repo. Chỉ ba file
   catalog/locale được commit. Sau khi PR merge và bản web được triển khai theo
   quy trình hiện tại, phiên bản xuất hiện trên `/changelog`. CI cũng tạo
   GitHub Release từ notes đã duyệt khi đã queue PR thành công.

Không cần sửa catalog và hai file locale bằng tay cho mỗi lần phát hành.
Thành viên vẫn chịu trách nhiệm nội dung công bố; CI không tự dịch hoặc đưa
nguyên thông tin kỹ thuật trong commit lên trang công khai.

### Cấu hình một lần trên GitHub

- Đưa workflow lên repo; branch chứa workflow mới phải được merge trước khi
  dùng tag phát hành đầu tiên. Sau merge, push develop tạo draft; các secret
  và quyền nêu dưới đây cần được cấu hình trước khi tự động công bố.
- Tạo repository secret `CHANGELOG_BOT_TOKEN`: token dành cho bot, giới hạn
  repo UniWork, có Contents và Pull requests read/write. Dùng fine-grained PAT
  hoặc token GitHub App còn hiệu lực. Không đưa token vào source hoặc notes.
- Bật **Allow auto-merge** và bảo vệ develop với CI/review theo quy định team.
  Workflow không dùng admin bypass, force push hay push trực tiếp vào develop.
  Nếu policy yêu cầu review thêm cho PR catalog, auto-merge đợi review đó.
- Tạo repository secret `UNIAI_CHANGELOG_WEBHOOK_URL` từ webhook trigger của
  Autopilot **UniWork Changelog Content Review**. URL chứa token, không đưa
  vào source, bình luận hay log. `scripts/changelog-review-notify.mjs` chỉ
  gọi HTTPS trên uniai.unicomhub.com, không follow redirect hoặc in response.
  Thiếu secret thì CI cảnh báo và giữ artifact để duyệt thủ công; HTTP/timeout
  làm bước dispatch thất bại. Kiểm tra Autopilot runs trước khi retry vì một
  request có thể đã được nhận dù CI timeout.

### Agent duyệt nội dung trên UniAI

Agent: **UniWork Changelog Reviewer**. Cấu hình và giới hạn nằm trong
`docs/engineering/changelog-review-agent.md`. Repo resource ghim nhánh develop
trong project UniWork; không cần GitHub ChatGPT Codex Connector để runtime
đọc repo qua Git. Agent chỉ biên tập notes Việt/Anh, kiểm chứng diff và nộp
PR để người phát hành quyết định. Nó không tự tạo tag, merge hoặc công bố.

Runtime **HCL (Codex)** chạy bằng daemon trên máy DESKTOP-TGS8UHR. Máy và
daemon cần online để thực thi task. Autopilot đang active, kiểm tra develop
mỗi giờ (Asia/Ho_Chi_Minh); webhook từ CI sẽ gọi ngay khi code đổi sau khi
workflow và secret được triển khai. Khi helpers/catalog chưa được merge vào
origin/develop, kết quả là NOT_READY; các file local chưa commit không phải
nguồn release. GitHub CLI/quyền tạo PR của runtime cũng cần sẵn sàng khi có
notes mới; agent báo BLOCKED nếu không có, không tự lấy credential người khác.

Token riêng giúp PR tạo từ CI và lần merge tiếp theo chạy các workflows liên
quan tự động. `GITHUB_TOKEN` có cơ chế chặn/đòi duyệt một số event phát sinh
từ chính workflow: [GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

### Thử và chạy lại

Sau khi file notes đã được review và merge, người phát hành tạo tag trên
develop mới nhất (ví dụ dưới đây; thay số phiên bản bằng số đã chốt):

```bash
git fetch origin develop
git switch develop
git pull --ff-only origin develop
git tag -a v1.1.0 -m "UniWork v1.1.0"
git push origin v1.1.0
```

Chỉ tạo tag khi checkout sạch và file notes tương ứng có trong commit đó.
Xem kết quả trong Actions → Changelog; không cần chạy script công bố bằng tay.

```bash
node scripts/changelog-automation.mjs draft --to HEAD --output .changelog-ci
node scripts/changelog-automation.mjs prepare --tag v1.1.0 --output .changelog-ci
node --test scripts/changelog-draft.test.mjs scripts/changelog-automation.test.mjs
```

Lệnh prepare sửa ba file catalog/locale trong checkout local; thử trên checkout
riêng nếu không muốn giữ kết quả. Không lệnh Node nào tự push, tạo PR hoặc release.
Những thao tác GitHub chỉ nằm trong bước công bố của workflow.

Workflow có **Run workflow → tag** để retry sau khi sửa cấu hình/quyền hoặc
checks. Cùng tag + cùng notes không tạo lại phiên bản; nội dung/metadata đã
công bố không được ghi đè. Nhánh và PR bị gián đoạn được tái sử dụng nếu chỉ
có đúng các file được phép và nội dung khớp; có chỉnh sửa khác thì dừng để
team xử lý. Một lần chỉ queue một PR phát hành, tránh xung đột baseline.

Không cần tạo tag v1.0.0 ngược thời gian: bản đầu là baseline đã được người
dùng chốt. Lần phát hành tự động tiếp theo dùng một phiên bản mới hơn.

## Cập nhật thủ công khi cần

1. Chốt số phiên bản, ngày và commit nguồn đã được chấp thuận để phát hành.
2. Tạo bản nháp từ Conventional Commits:

   node scripts/changelog-draft.mjs --version 1.1.0 --date YYYY-MM-DD --to origin/develop

   Mặc định lấy khoảng từ sourceRef của phiên bản mới nhất. Có thể chỉ định
   --from. Script chỉ xuất bản nháp; không sửa file, tạo tag hay publish.
   Giữ các commit không đúng convention và thay đổi nội bộ để người biên tập
   kiểm tra, tránh bỏ sót squash commit bắt đầu bằng UNI-nnn.
3. Thêm metadata vào packages/core/changelog/releases.json: version, date,
   sourceRef, contentKey, sections và item keys. ID cố định:
   release-1-1-0 cho v1.1.0. ID đã công bố không được đổi.
4. Viết nội dung hướng tới người dùng trong changelog.releases.<contentKey>
   của vi.json và en.json. Chỉ nêu thay đổi đã có trong bản nguồn, loại bỏ
   chi tiết build/infra không giúp người đọc. Không dùng nguyên commit message
   như nội dung phát hành; không đưa dữ liệu khách hàng hoặc log kỹ thuật vào.
5. Chạy catalog/locale/route tests và kiểm tra /changelog cùng anchor phiên bản.
   Review rồi triển khai theo quy trình chung. Chỉ người phát hành quyết định
   tạo Git tag; màn hình này không tự gán tag hoặc trạng thái issue.

Danh sách tự sắp xếp từ mới đến cũ, nhóm theo tháng; sidebar và anchor sinh từ
cùng catalog. Nội dung là tĩnh, nằm trong repo và được review cùng bản phát hành.
