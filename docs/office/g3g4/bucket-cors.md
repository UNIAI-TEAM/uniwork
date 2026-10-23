# Office G3-G4: CORS của kho file (bucket)

> **Trạng thái:** in-progress (UNI-944). Dùng cùng `runbook.md` mục 3.4. File mẫu:
> `deploy/app/storage-cors.example.json`.

Ngắn gọn. Chỉ cần làm khi trình duyệt gọi **thẳng** vào kho file bằng URL ký sẵn
(`MINIO_PUBLIC_ENDPOINT` / S3). Chế độ proxy qua API không cần CORS của bucket.

## 1. Ai gọi thẳng vào bucket

Đã đọc code, không đoán:

| Luồng | Đi đâu | Cần CORS bucket? |
| --- | --- | --- |
| Web tải file lên (`createDocumentFile`, `uploadDocumentFile`, lưu phiên bản Office) | `multipart` tới API (`packages/core/api/endpoints/documents.ts`), API tự ghi vào kho | Không |
| Web tải file xuống (`GET /documents/{id}/download`) | Proxy có xác thực của API | Không |
| App desktop (`apps/office-desktop/main/transport/office-transport.ts`) | Tiến trình main gọi `/api/v1` bằng `fetch` (`redirect: "error"`); renderer sandbox, không chạm bucket | Không. Desktop **không** là origin nào gọi vào bucket |
| Engine Office, LiveKit ghi file | Server-to-server, URL ký sẵn (`SignWrite`, `PUT`) | Không (không có trình duyệt) |
| Trình duyệt đọc URL ký sẵn `GET` (ảnh, audio, video, tải về) khi FileService chọn presign | Thẳng tới kho | Có, nếu mã trang dùng `fetch`/canvas/`crossorigin` trên URL đó. Thẻ `<img>`/`<audio>` thường không cần |
| Trình duyệt `PUT` thẳng lên URL ký sẵn | Thẳng tới kho | Có. Hiện chưa có đường này ở web; quy tắc bên dưới để sẵn khi bật |

Kết luận: CORS là **phòng bị**. Không có nó, web hiện tại vẫn tải lên/xuống qua API. Có
nó, các đường đọc/ghi trực tiếp (presign) không bị trình duyệt chặn.

Chi tiết header (từ `server/internal/storage/s3_objects.go`):

- URL ký sẵn chỉ ký header `host`. Không có header `x-amz-*` bắt buộc; kiểu nội dung và độ dài **không** nằm trong chữ ký.
- `PUT` từ trình duyệt vẫn gửi `Content-Type` (kiểu của `Blob`), nên preflight hỏi `content-type`.
- Media đọc theo từng đoạn gửi `Range`.
- Lấy `ETag` của `PUT`/`HEAD` cần `ExposeHeaders: ETag`.

## 2. Quy tắc

| Trường | Giá trị |
| --- | --- |
| Origin | `FRONTEND_ORIGIN` (origin app) và `PREVIEW_ORIGIN` (origin xem trước). Đúng scheme + host + cổng, không có dấu `/` cuối, không `*` ở production |
| Method | `PUT`, `GET`, `HEAD` |
| AllowedHeaders | `Content-Type`, `Content-MD5`, `Range` |
| ExposeHeaders | `ETag` |
| MaxAgeSeconds | `3600` |

Mẫu: `deploy/app/storage-cors.example.json` (origin giữ chỗ `https://app.example.com`,
`https://preview.example.com`). Thay bằng origin thật trước khi áp. Đừng thêm origin desktop.

## 3. Áp dụng

### 3.1 AWS S3

```sh
aws s3api put-bucket-cors --bucket <tên-bucket> \
  --cors-configuration file://deploy/app/storage-cors.example.json
aws s3api get-bucket-cors --bucket <tên-bucket>
```

(Đã sửa origin trong file trước khi chạy. Cần quyền `s3:PutBucketCORS`.)

### 3.2 MinIO

**Bản trong compose (`bitnamilegacy/minio:2025.7.23`) không hỗ trợ CORS theo bucket.**
`mc cors set` báo `A header you provided implies functionality that is not implemented`.
Cách đúng ở bản này là cấu hình **toàn máy chủ** cho MinIO, bằng biến môi trường của
container MinIO:

```sh
MINIO_API_CORS_ALLOW_ORIGIN=https://app.example.com,https://preview.example.com
```

- Danh sách origin cách nhau bằng dấu phẩy. Mặc định (không đặt biến) MinIO phản chiếu **mọi** origin, kể cả origin lạ. Production phải đặt.
- Áp cho mọi bucket trên MinIO đó. Phương thức/header do MinIO tự trả theo yêu cầu preflight; `ETag` đã nằm sẵn trong `Access-Control-Expose-Headers`.
- Đổi biến xong phải khởi động lại MinIO.
- Nếu sau này nâng MinIO lên bản có API CORS theo bucket, dùng `mc cors set <alias>/<bucket> <file>.xml` (mc cần XML `CORSConfiguration`, không nhận JSON của S3), rồi bỏ biến toàn máy chủ. Bản mới này **chưa kiểm** ở đây.

## 4. Kiểm tra (đã chạy 2026-10-06)

Môi trường: container MinIO dùng một lần, cùng image với `docker-compose.minio.yml`,
cổng host ngẫu nhiên `127.0.0.1` (tránh 9000/9001 mà IDE có thể chuyển tiếp), không
đụng MinIO dev dùng chung. Xong đã xóa container và network.

```sh
docker network create uw-cors-test-net
docker run -d --name uw-cors-test-minio --network uw-cors-test-net -p 127.0.0.1::9000 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  bitnamilegacy/minio:2025.7.23
MC() { docker run --rm --network uw-cors-test-net \
  -e MC_HOST_t=http://minioadmin:minioadmin@uw-cors-test-minio:9000 \
  -v "$PWD:/cfg:ro" bitnamilegacy/minio-client:2025.7.21 mc "$@"; }
MC mb t/uniwork-cors-test
MC cors set t/uniwork-cors-test /cfg/cors.xml   # -> "...not implemented"
MC cors get t/uniwork-cors-test                 # -> "No bucket CORS configuration found."
```

Kết quả preflight (`P=$(docker port uw-cors-test-minio 9000)`):

```sh
curl -i -X OPTIONS -H "Origin: https://evil.example.net" \
  -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: content-type" \
  http://$P/uniwork-cors-test/x.docx
```

| Cấu hình | Origin | Kết quả |
| --- | --- | --- |
| Mặc định (không đặt biến) | `https://app.example.com` | `204`, `Access-Control-Allow-Origin: https://app.example.com`, `Allow-Methods: PUT`, `Allow-Headers: content-type` |
| Mặc định | `https://evil.example.net` | `204`, **vẫn** `Access-Control-Allow-Origin: https://evil.example.net` (không chặn gì) |
| `MINIO_API_CORS_ALLOW_ORIGIN=https://app.example.com,https://preview.example.com` (container tạo lại) | `https://app.example.com` | `204`, `Allow-Origin: https://app.example.com`, `Allow-Methods: PUT`, `Allow-Headers: content-type`, `Allow-Credentials: true` |
| Như trên | `https://preview.example.com` | `204`, `Allow-Origin: https://preview.example.com`, cùng header |
| Như trên | `https://evil.example.net` | `204` **không có** `Access-Control-Allow-*` (trình duyệt chặn) |
| Như trên, `GET` thường (`/minio/health/live`) với `Origin: https://app.example.com` | | `200`, `Allow-Origin: https://app.example.com`, `Access-Control-Expose-Headers` có `Etag` |

Chưa kiểm: S3 thật (`aws s3api put-bucket-cors`, dùng đúng cú pháp chuẩn và file mẫu
là JSON `CORSConfiguration` hợp lệ), và MinIO bản mới có CORS theo bucket.

## 5. Khi trình duyệt vẫn báo lỗi CORS

1. Mở DevTools, xem preflight `OPTIONS`: có `Access-Control-Allow-Origin` đúng origin không.
2. Origin sai từng byte (scheme, cổng, dấu `/` cuối) là nguyên nhân hay gặp nhất.
3. Reverse proxy phía trước kho có thể ghi đè hoặc xóa header CORS; kiểm lại trên proxy.
4. URL ký sẵn dùng host nội bộ (`http://minio:9000`) thì trình duyệt không tới được: đặt `MINIO_PUBLIC_ENDPOINT`. Xem `docs/superpowers/specs/2026-09-22-shared-file-service-design.md` (mục browser không tới được MinIO).
