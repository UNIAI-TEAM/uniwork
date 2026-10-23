# unichat-tls-pins — ghim khoá TLS của UniChat mobile

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** không có alert — runbook vận hành; job `.github/workflows/chat-mobile-tls-pins.yml` (hằng ngày và mỗi PR chạm pin) là chuông báo · **Tệp:** `apps/chat-mobile/tls-pins.json` · **Issue:** UNI-2141

Mọi bản UniChat mobile **staging** và **production** (Android và iPhone) chỉ nói chuyện TLS với máy chủ của mình khi chuỗi
chứng chỉ có ít nhất một khoá CA đã ghim (audit bảo mật "no-pinning-or-attestation", MASVS-NETWORK-2). Bản dev không ghim.
Pin, host và ngày hết hạn nằm trong một tệp đã commit, `apps/chat-mobile/tls-pins.json`, đi qua review như mọi thay đổi
khác; `app.config.ts › tlsPinning` đưa chúng cho `plugins/with-tls-pins.js`, plugin viết network security config của
Android (`<pin-set expiration=…>`) và `NSAppTransportSecurity › NSPinnedDomains › NSPinnedCAIdentities` của iOS.

### Đang ghim gì

| Biến thể | Host (`host:port` — cổng chỉ để job kiểm, app ghim theo tên) | Vì sao |
| --- | --- | --- |
| production | `uniworkos.com` | API và web (`API_PUBLIC_URL`, `FRONTEND_ORIGIN` trong `deploy/app/env/uniwork-be.env`) |
| production | `livekit.vn247.info:7880` | signalling LiveKit (`LIVEKIT_URL`): token vào cuộc gọi đi qua đây |
| staging | như production, cộng `uniwork.unicomhub.com`, `livekit.ubos.vn` | máy chủ app-dev (`deploy/app-dev`), nếu môi trường EAS `preview` trỏ vào đó |

| Pin (khoá CA gốc) | Nhà CA | Vai trò |
| --- | --- | --- |
| Root YR | ISRG (Let's Encrypt) | đang dùng: mọi host trên được cấp bởi YR1/YR2 → Root YR (chứng chỉ chéo ký bởi ISRG Root X1) |
| ISRG Root X1 | ISRG (Let's Encrypt) | đang dùng trên máy chưa tin Root YR (chuỗi đi qua chứng chỉ chéo), và chuỗi "classic" R10–R14 |
| Root YE, ISRG Root X2 | ISRG (Let's Encrypt) | dự phòng khi chứng chỉ chuyển sang khoá ECDSA |
| GTS Root R1, GTS Root R4 | Google Trust Services | dự phòng **khác nhà CA**: server chuyển sang GTS (ACME, cert-manager) mà không cần bản app mới |

Ghim khoá **gốc**, không ghim khoá trung gian hay khoá lá: chứng chỉ lá đổi vài tháng một lần, Let's Encrypt chọn ngẫu
nhiên giữa nhiều chứng chỉ trung gian (YR1, YR2, YR3…) và thay chúng theo kế hoạch của họ; khoá gốc thì không đổi. Ghim
gốc vẫn chặn mọi chứng chỉ do CA khác cấp: CA người dùng tự cài, proxy chặn TLS của công ty, một CA khác bị lừa cấp
chứng chỉ cho tên miền của mình. Chứng chỉ của từng pin nằm ở `apps/chat-mobile/certs/tls-pins/`;
`scripts/mobile-tls-pins.test.mjs` tính lại pin từ chúng và đòi ≥ 2 nhà CA.

Không ghim: `u.expo.dev` (OTA), Sentry, dịch vụ push của Expo/Apple/Google, và media của cuộc gọi (TURN/WebRTC tự kiểm
DTLS bằng fingerprint trao đổi qua kênh signalling đã ghim).

### Khi ghim hỏng thì sao, và vì sao OTA không cứu được

Pin là cấu hình **native**: nằm trong `AndroidManifest.xml` + `res/xml/unichat_network_security_config.xml` và
`Info.plist` của binary. Một bản OTA chỉ thay JavaScript; nó không đổi được pin, và runtime fingerprint của app (gồm cả nội
dung `tls-pins.json`) bảo đảm một OTA không bao giờ rơi vào binary có pin khác. Nếu một host đã ghim phục vụ chuỗi không có
khoá nào trong pin (server đổi sang CA không được ghim, hay một proxy/CDN đứng trước và dùng CA của nó):

- **Android**: mọi request tới host đó hỏng (`SSLPeerUnverifiedException: Pin verification failed`) cho tới ngày
  `expires` của bản đó; sau ngày ấy Android bỏ ghim và app chạy lại. Đó là van an toàn duy nhất, nên mỗi bản store mới
  mang ngày hết hạn mới.
- **iOS**: không có ngày hết hạn. App hỏng cho tới khi người dùng cài bản mới từ App Store.
- Trong app, lỗi ghim trông như mất mạng (`ApiError` status 0, màn "mất kết nối"); không có sự kiện Sentry riêng. Web
  và desktop không ghim nên vẫn chạy — dấu hiệu phân biệt.
- Màn "Cần cập nhật" (`UNICHAT_MOBILE_MIN_SUPPORTED_VERSION`) đọc qua API đã ghim, nên **không** tới được máy đang bị
  khoá; nó chỉ có ích khi đặt **trước** lúc đổi CA (app giữ câu trả lời cuối trên máy).

Vì vậy: không bao giờ đổi CA, thêm proxy/CDN trước một host đã ghim, hay đổi `LIVEKIT_URL` sang một host khác CA mà
chưa đi qua mục Khắc phục › Trước khi đổi.

## Triệu chứng

- Job "UniChat mobile TLS pins" đỏ (thông báo của GitHub tới người sửa lịch gần nhất — chủ mobile bật thông báo cho
  workflow này):
  - `no pinned key in the chain`: một host đã ghim đang phục vụ chuỗi không có khoá nào trong pin. **Máy thật đang bị
    khoá** nếu host đó là của production.
  - `unreachable after 3 attempts`: không nối được (host sập, DNS, tường lửa chặn runner của GitHub).
  - `the pin-set expired`: đã qua `expires`: bản Android cũ thôi ghim, máy build EAS từ chối bản mới.
- Job cảnh báo (vàng): `the pin-set expires in N days` (≤ `warnDays`, 60 ngày) hay `the leaf certificate expires in N
  days` (gia hạn ACME kẹt).
- Người dùng mobile báo app "mất kết nối" ngay sau một lần đổi chứng chỉ/hạ tầng, trong khi web vẫn chạy; tỷ lệ
  `ApiError` status 0 của một bản tăng vọt.
- Máy build EAS đỏ với `tls-pins.json › expires is in the past` hay `<host> is not pinned: add it to tls-pins.json ›
  hosts.<biến thể>`.

## Kiểm tra

1. Chạy job tay (Actions › "UniChat mobile TLS pins" › Run workflow) hay tại máy:
   `node scripts/mobile-tls-pins.mjs` — mỗi host một dòng: `ok … pinned by Root YR, ISRG Root X1`, hay lỗi kèm chuỗi
   đang phục vụ. `--now 2027-09-15` thử trước một ngày.
2. Xem chuỗi và tính pin của từng chứng chỉ:

   ```bash
   host=uniworkos.com port=443
   openssl s_client -connect "$host:$port" -servername "$host" -showcerts </dev/null 2>/dev/null \
     | awk '/BEGIN CERT/{n++} {print > ("cert-" n ".pem")}'
   for f in cert-*.pem; do
     openssl x509 -in "$f" -noout -subject -issuer
     openssl x509 -in "$f" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
   done
   ```

   So các pin in ra (trừ chứng chỉ lá, `cert-1.pem`) với `sha256` trong `tls-pins.json`. Gốc tin cậy (ISRG Root X1…)
   thường không được server gửi; pin của nó tính từ `apps/chat-mobile/certs/tls-pins/*.pem` như trên.
3. Ai cấp chứng chỉ cho `uniworkos.com`: `kubectl -n reap-edge get certificate uniwork-tls -o yaml` (issuer
   `letsencrypt-http01`, `deploy/edge/certificate.yaml`, `deploy/edge/clusterissuer.yaml`). Host LiveKit
   (`livekit.vn247.info`) dùng chứng chỉ wildcard `*.vn247.info` của máy chủ LiveKit: hỏi người giữ máy đó nó được cấp
   ở đâu.
4. Có phải chỉ một số máy: một bản cũ có `tls-pins.json` khác? `git log -p apps/chat-mobile/tls-pins.json` cho biết bản
   nào mang pin nào (tag `chat-mobile-v*`).

## Khắc phục

### Trước khi đổi (đường thường)

- **Đổi CA của server sang Google Trust Services** (đã ghim — không cần bản app mới): tạo khoá EAB
  (`gcloud publicca external-account-keys create`), thêm ClusterIssuer ACME
  `https://dv.acme-v02.api.pki.goog/directory` với EAB đó, trỏ `issuerRef` của Certificate sang nó, chờ chứng chỉ mới,
  rồi `node scripts/mobile-tls-pins.mjs` phải xanh. Tương tự cho máy LiveKit.
- **Đổi sang một CA chưa ghim** (hay đặt CDN/proxy trước host): (1) PR thêm chứng chỉ gốc của CA đó vào
  `apps/chat-mobile/certs/tls-pins/` và một mục vào `pins` (tính pin như Kiểm tra › 2; chỉ lấy PEM từ kho chính thức
  của CA); (2) phát bản store mang pin mới; (3) đặt `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION` bằng bản đó và chờ đa số máy
  lên bản ấy (Sentry › Releases, Play Console, App Store Connect); (4) mới đổi CA. Bỏ qua bước 3 là khoá mọi iPhone còn
  bản cũ.
- **Thêm host** (đổi `LIVEKIT_URL`, thêm API host): thêm vào `hosts.<biến thể>` cùng PR với thay đổi deploy (test đỏ
  khi `deploy/app/env/uniwork-be.env` nêu host chưa ghim), chuỗi của host mới phải có một khoá đã ghim. Bản cũ không ghim
  host mới — không khoá ai, chỉ chưa được bảo vệ.
- **Gia hạn `expires`**: mỗi bản store giữ `expires` ≥ 12 tháng sau ngày phát; khi job cảnh báo, đẩy ngày trong PR và
  phát bản store. Bản cũ trên Android thôi ghim ở ngày cũ (hở, không khoá), iOS vẫn ghim.
- **Bỏ một pin**: chỉ khi không host nào còn dùng nó và vẫn còn ≥ 2 nhà CA; bản cũ giữ pin cũ, không sao.
- Mọi thay đổi pin là thay đổi native (fingerprint mới): cần bản store, OTA không mang được; test liên quan:
  `node --test scripts/mobile-tls-pins.test.mjs`, `npx vitest run app.config.test.ts` trong `apps/chat-mobile`.

### Sự cố: một host đã ghim đang phục vụ chuỗi không có pin

1. **Quay lại ngay CA đã ghim** — đây là cách nhanh duy nhất, phía app không có công tắc nào: trả `issuerRef` về
   `letsencrypt-http01` (hoặc GTS) và xoá secret `uniwork-tls` để cert-manager cấp lại, hay khôi phục secret cũ; gỡ
   proxy/CDN vừa đặt trước host. Kiểm lại bằng `node scripts/mobile-tls-pins.mjs`.
2. Không quay lại được Let's Encrypt (CA bị gỡ tin cậy, sự cố của CA): chuyển sang Google Trust Services như trên — đã
   ghim sẵn cho đúng tình huống này.
3. Không CA nào đã ghim dùng được: máy đang bị khoá — Android tới `expires` của bản đó, iPhone tới khi cài bản mới.
   Phát ngay bản store mang pin mới (iOS: xin App Review xét nhanh, "Request an Expedited App Review"); một bản OTA
   `critical` vẫn tới máy (`u.expo.dev` không bị ghim) và có thể hiện lời nhắn cập nhật từ store, nhưng không sửa
   được kết nối. Báo người dùng qua web/desktop (không ghim).

### Pin-set đã hết hạn

Đẩy `expires` (≥ 12 tháng), PR, phát bản store. Máy build EAS từ chối bản mới cho tới khi sửa; CI và OTA vẫn đọc được
config.

## Leo thang

- Chứng chỉ của `uniworkos.com`, cert-manager, `deploy/edge`: người giữ hạ tầng (cluster `reap-edge`).
- Máy LiveKit (`livekit.vn247.info`, `livekit.ubos.vn`) và chứng chỉ wildcard của nó: người giữ máy LiveKit.
- Bản store khẩn, App Review, Play: chủ epic UNI-1826 / người giữ tài khoản Apple và Google (UNI-1838).
- Quyết định đổi CA hay bỏ pin: chủ mobile cùng người giữ hạ tầng, theo mục Trước khi đổi.
