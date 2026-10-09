# Office G3-G4: deploy và rollback

> **Trạng thái:** in-progress (UNI-819). Bản dev/beta chưa ký. Nguồn rollback: plan §8.2
> (`docs/superpowers/plans/2026-09-27-office-g3-g4.md`).

Ngắn gọn. Làm theo thứ tự. Chỗ nào ghi "Chưa có" là repo chưa có thứ đó. Ô đã tick là phần repo đã cung cấp; ô trống là việc DevOps làm trên môi trường thật.

## Hiện còn thiếu để chạy production

Đã kiểm trong repo. Làm xong các mục này mới deploy Office lên production.

**A. `office-engine` trên Helm: luôn bật production; DevOps còn Secret + node.**
Chart `deploy/app/uniwork/` luôn deploy engine (`officeEngine.enabled: true`). Non-secret env:
`deploy/app/env/uniwork-office-engine.env` (origins/workers). CIDR kho file: `networkPolicy.officeEngineFileStore`
trong `values.yaml`. Jenkins luôn build image + pin digest — **không** còn param `OFFICE_ENGINE_ENABLED` /
`OUTPUT_ORIGINS` / `VALUES_FILE`. Quyền container giống compose. Sidecar XLSX nằm **trong** image engine.

- [x] Pipeline production-app build/push `uniwork-office-engine` + digest (cùng BE/FE).
- [x] Deployment + Service **riêng tư**, cổng `8090` (`deployment-office-engine.yaml`, `service-office-engine.yaml`).
- [x] Env non-secret: `uniwork-office-engine.env` + CIDR CMC S3 trong `values.yaml`.
- [ ] Node chạy engine đặt `podPidsLimit: 256` (kubelet); pod spec không có trường này.
- [ ] Tạo Secret `uniwork-office-engine` chứa `OFFICE_ENGINE_SERVICE_TOKEN` và `OFFICE_ENGINE_GRANT_KEY` (>= 32 ký tự, khác nhau). Xem `deploy/app/env/README.md`.
- [x] NetworkPolicy: chỉ `uniwork-be` gọi engine; engine ra DNS + CIDR kho file.
- [x] BE: `OFFICE_ENGINE_URL` để trống trong `uniwork-be.env`; chart set URL in-cluster. Timeout/job knobs trong `uniwork-be.env`.
- [x] `DESKTOP_AUTH_*` đã có trong `uniwork-be.env` (xem mục 3.2).
- [ ] Sau deploy chạy mục 4.

**B. Origin xem trước: ĐÃ nối sẵn.** `deploy/edge/{route,certificate,apisix-tls}.yaml` có `preview.unicomhub.com`; `PREVIEW_ORIGIN` có trong `uniwork-be.env`; Secret `uniwork-preview` (khóa `PREVIEW_CAPABILITY_SECRET`) khai trong `values.yaml`. Chỉ cần tạo Secret thật.

**C. Bản cài desktop: có workflow build chưa ký, DevOps vẫn tải lên và điền link.**
`.github/workflows/office-desktop-installers.yml` (chạy tay: Run workflow, chọn `channel` `dev`/`beta`; hoặc đẩy tag `office-desktop-v<version>-<dev|beta>.<số build>`) build Windows x64 (`-setup.exe`, `.zip`) và Linux x64 (`.deb`, `.AppImage`) **chưa ký**, ghi `SHA256SUMS-<nền tảng>.txt`, gắn vào release và in dòng `OFFICE_INSTALLER_<KÊNH>_URLS=…` ở job summary. `scripts/office/installer-urls.mjs` tạo cùng giá trị đó từ thư mục file (dùng khi copy file sang host khác). macOS `.dmg` **không** có trong workflow (cần máy Mac, chạy tay `package:macos`). Chi tiết: [desktop-packaging.md](desktop-packaging.md) mục "CI installers and `OFFICE_INSTALLER_*_URLS`".

- [x] Workflow build + SHA-256 + script tạo JSON link (không còn "CI không build").
- [ ] Chạy workflow cho kênh `dev`/`beta` và kiểm job pass (mục XLSX sidecar bắt buộc).
- [ ] Release/host phải tải được công khai bằng HTTPS (server không gửi thông tin đăng nhập). Repo riêng: copy file sang host HTTPS rồi chạy `installer-urls.mjs`.
- [ ] Điền JSON vào `OFFICE_INSTALLER_DEV_URLS` / `OFFICE_INSTALLER_BETA_URLS` của BE (`deploy/app/env/uniwork-be.env`, không phải Secret), ví dụ `{"win32-x64":"https://…-setup.exe","linux-x64-deb":"https://….deb"}`, rồi khởi động lại BE. Xem `.env.example`. `uniwork-be.env` đã có sẵn ba dòng (để trống).
- [ ] `GET /api/v1/config` trả link này (`office_installers.<kênh>` có `unsigned: true`). Để trống = web hiện "chưa có bản tải"; không thay kênh khác.
- [ ] macOS: build trên máy Mac và thêm file vào cùng release (chưa có).
- [ ] Bản build **chưa ký**: có cảnh báo SmartScreen/Gatekeeper; **không** tự cập nhật. Ký mã/notarization vẫn ở backlog.

## 1. Office gồm những phần nào

| Phần | Chạy ở đâu | Cần gì |
| --- | --- | --- |
| Trình soạn web DOCX, XLSX, PPTX, PDF, MD, HTML | Trình duyệt, trong `apps/web` (code ở `packages/views/office/`) | Cờ `office_engine` bật; file lưu qua kho file (MinIO/S3) |
| Máy xử lý Office (`office-engine`) | Container riêng, cổng `8090`, chỉ Go gọi | 2 khóa bí mật; `uniwork-office-engine.env` (origins); Helm luôn bật production |
| Máy tính lại XLSX (`xlsx-sidecar`) | Nằm trong cùng image `office-engine`, do engine tự chạy | Không cần cấu hình riêng (`UNIWORK_XLSX_ASSETS` đã đặt trong image) |
| Khung xem trước MD/HTML | Origin riêng `preview.<host>`, cùng tiến trình Go | `PREVIEW_ORIGIN`, `PREVIEW_CAPABILITY_SECRET`, DNS + chứng chỉ riêng |
| Server Go | Như hiện tại | Migration, env, kho file |
| App desktop (Electron) | Máy người dùng | Bản cài chưa ký; đăng nhập qua server |

## 2. Trước khi deploy

- [ ] Nhánh đã qua `make check` (hoặc đúng mức cổng đã chọn).
- [ ] Có 2 khóa khác nhau, mỗi khóa >= 32 ký tự: `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY`.
- [ ] Có 1 khóa >= 32 ký tự cho `PREVIEW_CAPABILITY_SECRET` (khác `JWT_SECRET`).
- [ ] DNS + chứng chỉ cho `preview.<host>` (khác origin của app).
- [ ] Kho file (MinIO/S3) đã chạy, trình duyệt gọi tới được.
- [ ] Đã backup DB.
- [ ] Biết cách tắt cờ (mục 6) trước khi bật.

## 3. Deploy từng bước

### 3.1 Migration

1. Chạy `make migrate-up` (bên trong là `cd server && go run ./cmd/migrate up`).
2. Migration Office/desktop (đều trong `server/migrations/`):

| Tên | Để làm gì |
| --- | --- |
| `9991790521814499_office_jobs` (+ 4 index `…500` đến `…503`) | Bảng việc của engine |
| `9991790608225750_office_jobs_convert_result` | Kết quả chuyển đổi |
| `9991790722053464_desktop_auth` (+ index `…465` đến `…468`) | Đăng nhập desktop, phiên thiết bị |
| `9991790722053469_office_launch_sessions` (+ index `…471`, `…472`) | Phiên mở file từ web sang desktop |

3. Bảng file (`950` đến `977`) có từ trước. Không có migration nào xóa hay đổi dữ liệu cũ.

### 3.2 Biến môi trường

Server Go (mọi biến đã có trong `.env.example`):

| Biến | Nghĩa |
| --- | --- |
| `OFFICE_ENGINE_URL` | Địa chỉ engine. Bỏ trống = không có engine, job Office báo lỗi, phần còn lại chạy bình thường |
| `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY` | Hai khóa; **giống hệt** khóa của engine |
| `OFFICE_ENGINE_REQUEST_TIMEOUT_MS` | Chờ engine trả lời (mặc định trong ví dụ: 10000) |
| `OFFICE_JOB_MAX_DEADLINE_MS`, `OFFICE_JOB_RECONCILE_INTERVAL_MS` | Hạn tối đa một job; chu kỳ dọn job kẹt |
| `PREVIEW_ORIGIN` | Origin khung xem trước; phải khác `FRONTEND_ORIGIN` |
| `PREVIEW_CAPABILITY_SECRET`, `PREVIEW_ASSET_TTL`, `PREVIEW_ASSET_MAX_BYTES` | Khóa ký, thời hạn, trần byte |
| `DESKTOP_AUTH_CLIENT_ID`, `DESKTOP_AUTH_REDIRECT_URIS`, `DESKTOP_AUTH_DEPLOYMENT_IDS` | Cho phép app desktop đăng nhập (so khớp từng byte) |
| `DESKTOP_AUTH_CLIENTS` | Nhiều client cùng lúc (`uniwork-office` bản ổn định + `uniwork-office-dev` bản dev), mỗi client chỉ dùng redirect của mình; khi đặt thì để trống `DESKTOP_AUTH_CLIENT_ID` / `DESKTOP_AUTH_REDIRECT_URIS` |
| `DESKTOP_AUTH_CODE_TTL`, `DESKTOP_AUTH_ATTEMPT_TTL` | Hạn mã đăng nhập (120s) và lượt thử (10m) |
| `OFFICE_INSTALLER_{DEV,BETA,STABLE}_URLS` | Link tải bản cài theo nền tảng (JSON). `_URL` số ít là kiểu cũ, bỏ sau 2026-11-02 |
| `FEATURE_FLAGS_FILE` | File YAML cờ; có thể ghi đè bằng `FF_<TÊN_CỜ>` |
| `FF_DOCUMENTS`, `FF_OFFICE_ENGINE` | Bật/tắt cờ cho **cả môi trường** (`true`/`false`; `false` là công tắc khẩn). Office cần **cả hai** bật. Bật theo từng tổ chức thì dùng override trong `/admin` (mục 3.6) |
| `FF_OFFICE_DOCX` … `FF_OFFICE_HTML`, `FF_OFFICE_HTML_VISUAL_EDIT` | Tắt riêng từng định dạng (mặc định bật; sửa HTML trực quan mặc định tắt) |
| `MINIO_*` hoặc `S3_*` (`STORAGE_BACKEND`) | Kho file |
| `S3_KEY_PREFIX` | Thư mục gốc theo môi trường trong kho dùng chung (`<env>/v1/...`, UNI-947); mỗi môi trường một giá trị khác nhau |
| `MINIO_PUBLIC_ENDPOINT` | Địa chỉ MinIO mà **trình duyệt** tới được, dùng khi ký URL tải thẳng. Bỏ trống khi dùng S3 |

Không phải biến của server, nhưng cần khi triển khai:

| Biến | Đặt ở đâu | Nghĩa |
| --- | --- | --- |
| `OFFICE_ENGINE_DIGEST` | Đầu vào bắt buộc của `ci/scripts/rollout-uniwork.sh` (Jenkins tự ghi vào `target/rollout.env`) | Digest `sha256:…` của image `uniwork-office-engine`. Engine **luôn** được deploy cùng BE/FE; không còn công tắc bật/tắt engine khi rollout |
| `OFFICE_ENGINE_OUTPUT_ORIGINS`, `OFFICE_ENGINE_MAX_WORKERS`, `OFFICE_ENGINE_MAX_QUEUE`, `OFFICE_ENGINE_FAULT_OPERATIONS` | `deploy/app/env/uniwork-office-engine.env` (ConfigMap của engine) | Origin kho file engine được đọc/ghi (CMC S3), số việc chạy cùng lúc, hàng chờ; `FAULT_OPERATIONS` luôn `0` ngoài test |
| `MINIO_API_CORS_ALLOW_ORIGIN` | Biến của **container MinIO** | Origin trình duyệt được gọi thẳng vào MinIO (`FRONTEND_ORIGIN`, `PREVIEW_ORIGIN`, cách nhau dấu phẩy). Không đặt = MinIO nhận **mọi** origin; production nên đặt. Chi tiết: [bucket-cors.md](bucket-cors.md) |

Web (đặt **lúc build**, vì Next nhúng cứng): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL`.
Không có biến `NEXT_PUBLIC_*` riêng cho Office.

Engine (đầy đủ ở `docs/ops/RUNBOOK_OFFICE_ENGINE.md`):

| Biến | Nghĩa |
| --- | --- |
| `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY` | Bắt buộc, >= 32 ký tự, khác nhau |
| `OFFICE_ENGINE_OUTPUT_ORIGINS` | Origin kho file mà engine được ghi vào. Trống = không ghi được |
| `OFFICE_ENGINE_MAX_WORKERS` (2), `OFFICE_ENGINE_MAX_QUEUE` (16) | Số việc chạy cùng lúc, hàng chờ |
| `OFFICE_ENGINE_SANDBOX` | Image đã đặt `required`; đừng đổi ở production |
| `OFFICE_ENGINE_FAULT_OPERATIONS` | Phải là `0` ngoài lúc test |

Sidecar XLSX: không có biến riêng cần đặt.

### 3.3 Chạy engine (profile `office`)

1. `docker compose --profile office build office-engine`
2. `docker compose --profile office up -d office-engine`
3. Giá trị mặc định trong compose chỉ để dev. Nơi dùng chung phải đặt khóa thật.
4. Trên Kubernetes dùng chart Helm thay compose: bật `officeEngine.enabled`, xem mục A ở đầu file.

**Bundle gateway XLSX phải build lại với patch 0010** (`packages/office-upstream/patches/0010-xlsx-visual-additions.patch`, UNI-940 X02). Patch này thêm tham số `visualAdditions` vào `applyCellEditsToXlsx` và xuất cờ `UNIWORK_XLSX_VISUAL_ADDITIONS`; `bindXlsxGateway` từ chối bundle không có cờ này, nên một `xlsx-gateway.mjs` build trước patch sẽ lỗi ngay khi bind chứ không lưu sai. Mọi nơi đóng gói gateway (image `office-engine`, `dist/xlsx-assets` của bản cài desktop, bản dev tại `.go-tmp/office-upstream-build`) phải chạy lại `node scripts/office/build-upstream.mjs` rồi build lại image/bản cài; không copy bundle cũ sang. Kiểm: `grep -c UNIWORK_XLSX_VISUAL_ADDITIONS <đường dẫn>/xlsx-gateway.mjs` phải >= 1.

### 3.4 Kho file (MinIO/S3)

- Trình duyệt phải gọi được địa chỉ kho (`MINIO_PUBLIC_ENDPOINT` nếu khác địa chỉ nội bộ).
- `OFFICE_ENGINE_OUTPUT_ORIGINS` = origin kho file mà engine nhìn thấy.
- CORS của bucket: xem [bucket-cors.md](bucket-cors.md) (quy tắc, `deploy/app/storage-cors.example.json`, cách áp trên S3 và MinIO). MinIO của compose không có CORS theo bucket: đặt `MINIO_API_CORS_ALLOW_ORIGIN` cho container MinIO. Lỗi browser không tới được MinIO: `docs/superpowers/specs/2026-09-22-shared-file-service-design.md`.
- Mục đích file `document_file` do FileService quản lý. Nếu job báo `file_purpose_disabled` thì mục đích này chưa mở ở bản đang chạy.

### 3.5 Origin xem trước

1. DNS `preview.<host>` trỏ vào cùng tiến trình Go (reverse proxy).
2. Chứng chỉ phủ cả hai tên. Không redirect, không alias app.
3. Giữ nguyên header broker trả (xem `docs/office/g3g4/preview-origin.md`, mục Proxy and headers).
4. Thiếu hoặc sai biến thì server **không khởi động** (đóng an toàn).

### 3.6 Cờ tính năng

| Cờ | Mặc định | Làm gì |
| --- | --- | --- |
| `documents` | bật | Tài liệu trong workspace (menu Tài liệu) |
| `office_engine` | bật | Công tắc tổng: bật trình soạn Office cho cả web và desktop host |
| `office_docx` `office_xlsx` `office_pptx` `office_pdf` `office_markdown` `office_html` | bật | Cho phép sửa riêng từng định dạng (cần `office_engine` bật) |
| `office_html_visual_edit` | tắt | Sửa HTML trực quan (chưa có giao diện) |

1. `documents` mặc định đã bật (tắt bằng `FF_DOCUMENTS=false` hoặc override); `office_engine` cũng mặc định bật (tắt bằng `FF_OFFICE_ENGINE=false`, file YAML `FEATURE_FLAGS_FILE` hoặc override).
2. Tắt/bật **riêng từng định dạng**: mỗi định dạng có cờ riêng, mặc định **bật** — `office_docx`, `office_xlsx`, `office_pptx`, `office_pdf`, `office_markdown`, `office_html`. Một định dạng chỉ sửa được khi `office_engine` **và** cờ của nó cùng bật. Để tắt một định dạng: `FF_OFFICE_DOCX=false` (đổi tên theo cờ) hoặc override trong file/org. Tệp định dạng đó mở ở màn xem/tải như khi tắt `office_engine`, không mở trình soạn; các định dạng khác không đổi. Web đọc `GET /api/v1/config` theo tổ chức của tài liệu, nên override theo org có hiệu lực. Desktop đọc cùng các cờ này theo tổ chức đang chọn (lấy sau khi chọn tổ chức, đọc lại khi đổi tổ chức hoặc tài khoản; nếu lỗi thì thử lại ngay một lần, sau đó tự thử lại theo khoảng tăng dần tới 5 phút, ngay khi cửa sổ được focus hoặc có mạng lại, và trước mỗi lần mở tài liệu cloud): tài liệu cloud thuộc định dạng bị tắt, hoặc khi chưa đọc được cấu hình, mở ở chế độ chỉ xem. Tab chỉ xem ghi rõ lý do: định dạng bị tổ chức tắt, hoặc chưa đọc được cấu hình. Khi được phép, tab được đọc lại tài liệu mới nhất rồi mới chuyển sang sửa (chưa có chỉnh sửa nào trong chế độ chỉ xem nên không mất dữ liệu). Tệp cục bộ không bị cờ chặn. Web: đổi cờ có hiệu lực ở lần làm mới cấu hình tiếp theo (tối đa ~5 phút hoặc khi quay lại tab). Trình soạn đang mở không bị đóng khi làm mới lỗi; chỉ đóng khi câu trả lời mới nói tắt, và nếu đang có thay đổi chưa lưu thì hiện hộp thoại Lưu / giữ bản nháp / bỏ trước. Trong lúc chưa đọc được cấu hình, thẻ tệp ghi "đang kiểm tra" hoặc "chưa kiểm tra được" (có nút Thử lại), không ghi "đang tắt".
3. Cờ chỉ ẩn tính năng, không cấp quyền.

## 4. Kiểm tra sau deploy

1. Server: `curl <api>/healthz` rồi `curl <api>/readyz` đều 200.
2. Engine: `curl 127.0.0.1:8090/healthz` ra `{"status":"ok"}`.
3. Engine sẵn sàng: `curl -H "Authorization: Bearer $OFFICE_ENGINE_SERVICE_TOKEN" 127.0.0.1:8090/readyz` ra 200.
4. Engine hỏng **không** làm `/readyz` của API hỏng. Xem số đo `uniwork_office_engine_ready`.
5. Mỗi định dạng (DOCX, XLSX, PPTX, PDF, MD, HTML), làm lần lượt:
   1. Tải một file mẫu lên Tài liệu.
   2. Mở bằng trình soạn.
   3. Sửa một chữ (PDF chỉ xem/ghi chú theo khả năng của trình soạn).
   4. Bấm Lưu (không có tự lưu).
   5. Đóng, mở lại: nội dung mới còn.
6. XLSX: nhập một công thức, lưu, mở lại. Công thức có giá trị đúng.
7. MD/HTML: mở xem trước. Địa chỉ khung phải là `PREVIEW_ORIGIN`, không phải origin app.
8. Tải file về từ lịch sử phiên bản.

## 5. App desktop

**Chưa ký.** Ký mã (code signing), notarization và tự cập nhật: **CHƯA LÀM**. Để backlog đến khi có chứng chỉ. Tự cập nhật luôn tắt.

### 5.1 Tạo bản dev/beta (chưa ký)

1. Dùng Node 22.23.2, `pnpm install --frozen-lockfile`.
2. Đặt `UNIWORK_OFFICE_CHANNEL` (`dev` hoặc `beta`; `stable` bị từ chối khi chưa ký) và `UNIWORK_OFFICE_BUILD_NUMBER`.
3. Build: `pnpm --filter @uniwork/office-desktop package` (Windows ZIP + setup).
4. Linux `.deb` + AppImage: `pnpm --filter @uniwork/office-desktop package:linux` (hoặc `package:linux:docker`).
5. macOS `.dmg`: `pnpm --filter @uniwork/office-desktop package:macos`, phải chạy trên máy macOS. Chưa có bằng chứng build/cài trên Mac thật.
6. Kiểm: `pnpm --filter @uniwork/office-desktop smoke` và `smoke:installer`.
7. Tên file có chữ `unsigned`. Lưu SHA-256 cạnh file.

### 5.2 Phát cho người dùng

1. Đặt link tải vào `OFFICE_INSTALLER_DEV_URLS` / `OFFICE_INSTALLER_BETA_URLS` (chỉ HTTPS). Workflow `office-desktop-installers.yml` in sẵn giá trị này; xem mục C ở đầu file.
2. Người dùng đăng nhập, bấm Tải trên web. Server trả gói có kèm hồ sơ deployment.
3. Không có hồ sơ deployment thì app báo `no_deployment_profile`. Tải lại từ web.

### 5.3 Người dùng sẽ thấy gì

| Hệ | Cảnh báo | Cách qua |
| --- | --- | --- |
| Windows | SmartScreen | **More info** rồi **Run anyway**; hoặc `Unblock-File` |
| macOS | Gatekeeper | Chuột phải app, **Open**, **Open** |
| Ubuntu AppImage | Cần `libfuse2` | Cài `libfuse2` |

Chi tiết: `desktop-install-macos-ubuntu.md`.

### 5.4 Đăng nhập và thu hồi thiết bị

- Đăng nhập kiểu PKCE qua trình duyệt, quay về `uniwork-office://auth/callback` (`uniwork-office-dev://…` với bản dev).
- Người dùng tự xem thiết bị: `GET /auth/desktop/devices`; tự thu hồi: `DELETE /auth/desktop/devices/{deviceSessionID}` (đều dưới `/api/v1`).
- Đăng xuất thiết bị: `POST /auth/desktop/logout`.
- Dùng lại refresh token cũ: server trả 401 `refresh_reused` và tự thu hồi thiết bị đó.
- Thu hồi thiết bị xong, lần gọi tiếp theo bị chặn ngay (`device_revoked`).
- Thu hồi thay người dùng bằng công cụ vận hành (chạy trên máy chủ, cần `DATABASE_URL`):
  `uniwork-admin revoke-desktop-device --user-id <id người dùng> --device-id <id thiết bị> --reason "<lý do, ít nhất 10 ký tự>"`.
  Lệnh thu hồi cả họ phiên của thiết bị đó, nên lần refresh tiếp theo bị chặn (`device_revoked`). Id thiết bị lấy từ `GET /auth/desktop/devices` của chủ tài khoản, hoặc từ bảng `device_sessions`.
  Id không có, hoặc thiết bị không thuộc người dùng đó: lệnh báo lỗi, thoát mã khác 0, không ghi gì. Thiết bị đã thu hồi từ trước: lệnh báo "already revoked", không ghi thêm. Mỗi lần thu hồi thật ghi một dòng `admin_actions` (actor `cli`) và một dòng `audit_events` (`desktop_device.revoked`) cùng mã trace.

### 5.5 Giới hạn dung lượng tệp (UNI-956)

- **Web giữ giới hạn.** Engine dùng chung trên server giữ `ENGINE_LIMITS` (đầu vào 64 MiB, đầu ra 128 MiB) và giới hạn model mở XLSX 16 MiB. Vượt giới hạn nào thì job trả lỗi có kiểu `upload_bounds` (413, `byte_bound`), kể cả giới hạn model XLSX (`reason: xlsx_open_model_too_large`), engine trong trình duyệt trả `failure_class: too_large`. Web không báo lỗi engine chung chung nữa: cả sáu định dạng (DOCX, XLSX, PPTX, PDF, MD, HTML) hiện cùng một thông báo "tệp quá lớn để chỉnh sửa trên web", nút chính là **Mở trong UniWork Office** (đúng luồng launch ticket ở header), nút phụ là **Tải xuống**.
- **App desktop không giới hạn dung lượng tệp làm việc.** Tệp cục bộ mở, lưu, ghi đè nguyên tử không có trần dung lượng; các đường engine cục bộ chạy không có `max_input_bytes` và không có giới hạn model 16 MiB. Giá trị trong `packages/office-contracts/src/limits.ts` không đổi vì đó là hợp đồng với server (Go cũng dùng).
- **Web kiểm tra trước khi tải.** Mọi đường mở trên web đọc `size_bytes` từ `GET /documents/{id}/download?meta=1` trước; vượt 64 MiB thì hiện ngay thông báo trên, không tải tệp. Giới hạn model XLSX 16 MiB không đoán được từ dung lượng tệp, nên chỉ biết sau khi tải và chạy job (lỗi `upload_bounds` / `xlsx_open_model_too_large`).
- **Vẫn chặn tệp độc hại.** Trước khi đưa DOCX/PPTX/XLSX cho parser, desktop quét central directory của zip (không giải nén): quá 20.000 entry, tổng kích thước khai báo vượt max(16 MiB, 100 × dung lượng tệp), entry trên 1 MiB có tỉ lệ nén quá 100:1, zip64, hoặc central directory nằm ngoài tệp thì từ chối (`corrupted`, `zip_bomb`). Áp dụng cho cả tệp trên máy lẫn tài liệu cloud mở trong app.
- **Hết bộ nhớ.** Engine XLSX và PDF cục bộ chạy trong một `utilityProcess` riêng. Heap JS của process đó tối đa khoảng 4 GiB: Electron build V8 với pointer compression nên heap bị chặn ở mức này dù cờ `--max-old-space-size` đặt cao hơn (máy ít RAM thì dùng 75% RAM, tối thiểu 2 GiB). Byte của tệp nằm ngoài heap (ArrayBuffer, bộ nhớ wasm) nên chỉ bị giới hạn bởi RAM của máy. Process đó hết bộ nhớ hay thoát giữa chừng thì main trả lỗi có kiểu `insufficient_memory`, và người dùng thấy "Máy không đủ bộ nhớ để mở tệp này." ở cả XLSX lẫn PDF. Các cửa sổ khác vẫn chạy, lần gọi sau tạo process mới. Một process phục vụ mọi cửa sổ, nên khi một tệp làm nó sập thì các lệnh engine đang chạy dở của tab khác cũng nhận cùng lỗi đó. Chưa có hạn giờ cho mỗi lệnh: engine bị treo (không phải hết bộ nhớ) thì lệnh đó chờ mãi, nhưng main không bị treo. Lỗi cấp phát bắt được (đọc tệp, giải mã trong renderer) cũng trả cùng mã. DOCX/PPTX chạy trong renderer: hết heap ở đó chỉ làm sập renderer của cửa sổ đó, main vẫn chạy (chưa có thông báo có kiểu cho trường hợp này).

## 6. Khi có sự cố / rollback

Nguyên tắc (plan §8.2):

1. **Tắt sửa, giữ xem.** Tắt cờ `office_engine` (`FF_OFFICE_ENGINE=false` hoặc override trong file/org). Tài liệu đã lưu vẫn xem, tải, xem lịch sử theo quyền. Tắt riêng một định dạng: đặt cờ của nó về `false` (ví dụ `FF_OFFICE_DOCX=false`), các định dạng còn lại vẫn sửa được (mục 3.6).
2. **Không xóa nháp.** Giữ nguyên nháp mã hóa, khóa, và store. Rollback không được làm mất nháp.
3. **Không down migration.** Không chạy `make migrate-down` trên production.
4. **Không xóa blob.** FileService tự giữ staged/claim/GC. Không dọn tay kho file.
5. **Engine lỗi:** chỉ rollback engine nếu bản cũ đọc được các phiên bản đã tạo. Nếu không, chặn sửa; không để mất byte, không tự chuyển định dạng.
6. **Desktop:** thu hồi thiết bị lỗi (mục 5.4). Rollback không khôi phục thiết bị đã thu hồi, không dùng lại refresh token đã xoay.
7. **Cập nhật lỗi:** giữ app và file cũ, giữ nháp, không ép khởi động lại khi lưu checkpoint lỗi. Tắt cập nhật tách riêng với tắt ghi cloud.

Nói gì với người dùng:

- "Tạm thời chưa sửa được file Office. Bạn vẫn xem và tải được."
- "Nháp của bạn vẫn còn. Đừng xóa dữ liệu app."
- "Nếu máy bị mất hay lỗi, đăng nhập web và thu hồi thiết bị."

## 7. Lỗi hay gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Engine không khởi động | Hai khóa trùng nhau hoặc < 32 ký tự | Đặt hai khóa khác nhau |
| Job lỗi `output_write_*` | Kho file từ chối hoặc không tới được | Kiểm `OFFICE_ENGINE_OUTPUT_ORIGINS` và kho file |
| `503 engine_overloaded` | Hàng chờ đầy | Đợi; nếu hay lặp thì xét `OFFICE_ENGINE_MAX_WORKERS`/`MAX_QUEUE` sau khi đo |
| `timed_out` (`deadline`/`cpu_limit`) | File nặng, vượt hạn | Đo trước khi nâng giới hạn |
| `engine_crashed` (`memory_limit`/`temp_limit`) | Hết RAM/ổ tạm | Như trên |
| `failed` `output_limit` | Kết quả lớn hơn mức cho phép | Kiểm `max_bytes` của FileService (trần 50 MiB) |
| `file_purpose_disabled` | Mục đích `document_file` chưa mở | Cập nhật bản server có mục này |
| `501 unsupported_operation` | Thao tác chưa gắn (convert luôn thế) | Bình thường |
| Office job báo chưa cấu hình | `OFFICE_ENGINE_URL` trống | Compose: đặt địa chỉ engine. Helm: bật `officeEngine.enabled: true` (chart tự đặt URL; giữ `OFFICE_ENGINE_URL` trống trong `uniwork-be.env`) và tạo Secret `uniwork-office-engine` |
| Có tiến trình worker khi không có job | Tiến trình kẹt | Lấy `/metrics` + log, restart container |
| Server không lên, nhắc `PREVIEW_*` | Thiếu/sai biến xem trước | Sửa theo bảng ở `preview-origin.md` |
| Xem trước lỗi sau reverse proxy | Redirect hoặc alias origin app | Bỏ redirect; dùng host riêng |
| Desktop: `no_deployment_profile` | Thiếu hồ sơ deployment | Tải lại từ web |
| Desktop: 401 `refresh_reused` / `device_revoked` | Token cũ bị dùng lại, hoặc thiết bị đã thu hồi | Đăng nhập lại |
| Cập nhật báo `checkpoint_failed` | Lưu nháp cục bộ lỗi | Không khởi động lại; xem `desktop-packaging.md` mục Update and rollback |
| Nâng từ beta lên bản ký sau này mất khóa nháp | Keychain khác danh tính | Lưu file trước khi nâng cấp |

## 8. Tài liệu liên quan

- [RUNBOOK_OFFICE_ENGINE.md](../../ops/RUNBOOK_OFFICE_ENGINE.md): engine, giới hạn, XLSX sidecar
- [preview-origin.md](preview-origin.md): origin xem trước MD/HTML
- [bucket-cors.md](bucket-cors.md): CORS của kho file (S3/MinIO)
- [desktop-packaging.md](desktop-packaging.md): đóng gói, cập nhật, rollback nháp
- [desktop-install-macos-ubuntu.md](desktop-install-macos-ubuntu.md): cài macOS, Ubuntu
- [desktop-auth-contract.md](desktop-auth-contract.md): đăng nhập, thiết bị, thu hồi
- [acceptance.md](acceptance.md): ma trận nghiệm thu
