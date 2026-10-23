# UniChat mobile — đối chiếu OWASP MASVS (L1)

> **Trạng thái:** shipped · cập nhật 2026-10-22 (audit "Security & privacy", no-masvs-baseline)

Bảng này là baseline bảo mật của `apps/chat-mobile` theo [OWASP MASVS v2](https://mas.owasp.org/MASVS/), mức L1.
Mỗi kiểm soát chỉ ra **cái giữ nó** — một test, một luật lint, một bước CI — chứ không chỉ mô tả. Một PR làm
một dòng sai đi thì sửa dòng đó cùng PR; dòng "chưa có" là nợ đã biết, kèm lý do và chỗ theo dõi.

## MASVS-STORAGE

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Token chỉ trong kho an toàn của hệ điều hành | Phiên (access + refresh) và người dùng cuối trong Keychain/Keystore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, một writer tuần tự | `data/secure-storage.test.ts`, `data/auth/last-user.test.ts` |
| Dữ liệu offline mã hoá | MMKV AES-256, khoá ngẫu nhiên trong Keychain/Keystore (this device only) | `data/storage/native-device-store.test.ts` |
| Không sao lưu, không chuyển máy | `android.allowBackup: false`, data extraction rules loại mọi vùng (Android 12+) | `app.config.test.ts`, `android-manifest.test.ts` (thuộc tính `application`, luật của plugin) |
| Đăng xuất / bị thu hồi xoá dấu vết | Cache ảnh expo-image, thông báo trong khay, badge, hàng đợi, cache truy vấn, workspace | `data/local-wipe.test.ts`, `data/auth/store.test.ts` |
| Tệp của tin chưa gửi | Bản sao ảnh, tệp, tin thoại chưa gửi ở `Documents/outbox`, xoá khi server nhận và khi đăng xuất; Android không sao lưu gì. **Nợ đã biết:** trên iOS, `Documents` vào bản sao lưu iCloud/Finder cho tới khi có lệnh native đặt `isExcludedFromBackup` (expo-file-system không có) — chuyển sang `Caches` thì hệ điều hành có thể xoá tệp của tin đang chờ | `data/outbox-files.test.ts`, `data/local-wipe.test.ts`; iOS: runbook › Kiểm tra bảo mật trên máy |
| Gỡ app là đăng xuất (iOS giữ Keychain) | Dấu cài đặt trong MMKV; lần mở đầu của bản cài mới bỏ phiên cũ và thu hồi thiết bị | `data/install-marker.test.ts`, `data/auth/session.test.ts`, `data/auth/store.test.ts` |
| Log và báo crash không lộ dữ liệu | Console chỉ ở dev; Sentry `sendDefaultPii: false`, không ảnh màn hình/replay; app không đưa nội dung tin hay tên vào báo cáo, và `beforeSend` còn lọc token, email, query URL, push token, mọi đoạn trong ngoặc kép, cả lời của server trong `ApiError` | `data/logger.test.ts`, `data/sentry.test.ts`, `lib/redact.test.ts`, lint `no-console` (`lib/lint-quality.test.ts`) |

## MASVS-CRYPTO

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Số ngẫu nhiên an toàn | PKCE verifier, khoá MMKV, token launch của cuộc gọi đều từ CSPRNG (`expo-crypto`, `SecureRandom`) | `data/auth/pkce.test.ts`; Kotlin `CallLaunchTokens.kt` (chỉ kiểm được trên máy) |
| Không tự chế thuật toán | AES-256 của MMKV, SHA-256 (S256) của PKCE, so sánh hằng thời gian (`equalSecret`, `MessageDigest.isEqual`) | `data/auth/callback.test.ts` |

## MASVS-AUTH

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Đăng nhập theo RFC 8252/7636 | Trình duyệt hệ thống, PKCE S256, `state`, một lần thử 10 phút, callback kiểm chặt | `data/auth/pkce.test.ts`, `data/auth/callback.test.ts`, `data/auth/session.test.ts` |
| Callback đăng nhập trên Android | Custom scheme `uniworkchat://auth/callback`: một app khác đăng ký cùng scheme có thể nhận code. PKCE (verifier chỉ trong bộ nhớ) và `state` chặn nó đổi code của lượt người dùng; lượt nó tự khởi phải qua màn đồng ý có nút bấm và CSRF (`desktop_auth.go` › Consent/Approve). **Nợ đã biết:** redirect https đã xác minh (App Link) cho production, cần kiểm Custom Tabs trên máy trước khi đổi | `data/auth/callback.test.ts`, `server/internal/service/desktop_auth_test.go` |
| Trang đăng nhập đúng nguồn | `authorization_url` phải cùng origin với `appUrl` (https ở bản phát hành) | `data/auth/transport.test.ts` |
| Refresh xoay vòng, phát hiện dùng lại | Server thu hồi cả họ token; app kết thúc phiên ngay khi server nói | `server/internal/service/desktop_auth_test.go`, `data/auth/session-refresh.test.ts` |
| Thu hồi thiết bị có hiệu lực ngay | Mọi request kiểm `device_revoked`; push của thiết bị bị gỡ | `server/internal/middleware/auth_device_test.go`, `server/internal/service/desktop_auth_test.go` |
| Khoá ứng dụng (tuỳ chọn, tổ chức bắt buộc được) | Face ID / vân tay / mã máy khi mở lạnh và sau thời gian ở nền; owner/admin bắt buộc khoá và chặn chụp màn hình cho mọi máy của tổ chức (`/orgs/{org}/mobile-security-policy`), app coi là mức tối thiểu, lưu trong Keychain để áp từ lần mở lạnh; khoá đang bật thì thông báo không có Trả lời, câu trả lời gõ từ màn khoá bị từ chối | `lib/app-lock.test.ts`, `data/privacy-settings.test.ts`, `components/app/privacy-floor-sync.test.tsx`, `components/app/privacy-guard.test.tsx`, `components/app/chat-category-sync.test.tsx`, `data/chat-notification-actions.test.ts`, `components/settings/privacy-section.test.tsx`, `server/internal/service/mobile_security_policy_test.go`, `server/internal/handler/mobile_security_policy_test.go` |

## MASVS-NETWORK

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Chỉ TLS ở bản phát hành | `UNICHAT_API_URL`/`UNICHAT_APP_URL` phải `https://` với staging/production; socket `wss://` suy từ đó; không ngoại lệ ATS hay cleartext | `app.config.test.ts`, `android-manifest.test.ts` (`usesCleartextTraffic`, `networkSecurityConfig` rỗng khi không ghim) |
| Token chỉ tới API của mình | Bearer chỉ gắn vào `apiUrl` + đường cố định; mọi request mang credential (API JSON, route đăng nhập) đi qua `data/auth/strict-fetch.ts` (`expo/fetch`: OkHttp/URLSession thật sự từ chối 3xx — fetch của React Native bỏ qua `redirect`); upload multipart còn ở fetch của RN (Android OkHttp bỏ `Authorization` khi đổi host; iOS chưa kiểm trên máy); server không route bearer nào trả 3xx; socket xác thực bằng frame đầu | `data/auth/strict-fetch.test.ts`, `data/api.test.ts`, `data/auth/transport.test.ts`, `data/auth/flow.test.ts`, `server/internal/arch_test.go › TestOnlyBrowserFlowsRedirect`, `data/realtime/ws-client.test.ts` |
| Ghim khoá TLS (MASVS-NETWORK-2, L2) | Sẵn sàng, tắt mặc định: `UNICHAT_TLS_PINS` + `UNICHAT_TLS_PIN_EXPIRES` bật pin-set Android (có hạn) và `NSPinnedDomains` iOS cho API, web và host LiveKit (`UNICHAT_TLS_PIN_HOSTS`); bật trước lần nộp production đầu tiên là việc của chủ tài khoản (cần pin thật của CA đang dùng) | `app.config.test.ts`, `android-manifest.test.ts`; bật và xoay vòng: runbook `unichat-mobile-release` › Khắc phục 19 |
| Push có xác thực | Server production bắt buộc `EXPO_ACCESS_TOKEN` (enhanced push security) | `server/internal/config/config_test.go` |

## MASVS-PLATFORM

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Deep link không tự hành động | Chỉ hai dạng link, cùng origin; URL khác (kể cả `uniworkchat://account`, App Link tới màn trong) về `/`, không mở màn nó nêu; `answer=` bị bỏ qua (Nghe chỉ từ PendingIntent có token); `dm=` hỏi trước khi tạo phòng | `lib/deep-link.test.ts` (mỗi route trong một case), `lib/deep-link-target.test.ts`, `components/chat/use-deep-link-target.test.tsx` |
| Màn khoá chỉ cho cuộc gọi thật | Activity hiện trên màn khoá chỉ khi launch mang token của lần đổ chuông | `CallLaunchTokens.kt` (runbook › kiểm bằng `adb am start` với extra giả) |
| Quyền tối thiểu | Danh sách quyền và dịch vụ cuối cùng của bản release được ghim; quyền thừa của thư viện bị gỡ | `android-manifest.test.ts` |
| Nội dung không lộ ngoài app | Thông báo tin riêng tư trên màn khoá Android; tuỳ chọn ẩn nội dung trong push (người dùng, tổ chức) — ẩn thì cả tiêu đề không còn tên người, phòng, việc hay tài liệu; chặn chụp màn hình và che trình chuyển app (tuỳ chọn, tổ chức bắt buộc được) | `data/notification-channels.test.ts`, `server/internal/notification/push_preview_test.go`, `components/app/privacy-guard.test.tsx` |
| WebView | Không có WebView; trang web mở bằng trình duyệt hệ thống | — (không có gì để kiểm) |

## MASVS-CODE

| Kiểm soát | Cách làm | Cái giữ nó |
| --- | --- | --- |
| Dữ liệu từ mạng và từ đĩa qua schema | `parseWithFallback` + zod cho mọi endpoint; frame realtime decode theo catalogue; cache đĩa đọc lại qua schema | `data/*-api.test.ts` (case malformed), `data/realtime/frames.test.ts`, `data/persisted-cache.test.ts` |
| Bản cập nhật OTA được ký | Bản production phải nhúng chứng chỉ ký; OTA kênh production không phát khi chưa ký | `app.config.test.ts`, `scripts/mobile-workflows.test.mjs` |
| Ép cập nhật bản cũ | `min_supported_mobile_version` từ server chặn cả app | `components/app/update-gate.test.tsx` |
| Phụ thuộc có lỗ hổng | `pnpm audit --audit-level high` ở `ci.yml`; `expo install --check` | `.github/workflows/ci.yml`, `.github/workflows/mobile-verify.yml` |
| Quét binary đã dựng | APK release của CI: không credential trong mọi file (dex, bundle Hermes, `.so`, asset), không debuggable/testOnly, không backup/cleartext, không component export không permission ngoài baseline; dex định nghĩa mọi lớp mã native hay Android tìm theo tên (`REQUIRED_DEX_CLASSES`, mỗi luật `-keep` của `ANDROID_KEEP_RULES` có ít nhất một lớp ở đó); AAB production trên EAS: quét credential và dex trước khi submit | `scripts/mobile-apk-scan.mjs` (+ `.test.mjs`), `apps/chat-mobile/apk-scan-baseline.json`, `mobile-verify.yml › android-release`, `chat-mobile-production.yml` |

## Kiểm trên máy

Các dòng trên chỉ ra test và cấu hình. Phần chỉ nền tảng mới chứng minh được (Keychain sau gỡ cài, nội dung bản sao
lưu, ảnh màn đa nhiệm, chặn chụp, ghim TLS dưới MITM, link từ ngoài) có lượt kiểm trên máy ở runbook
`unichat-mobile-release` › Kiểm tra bảo mật trên máy: Android mỗi bản store; **iOS chưa có bản build nào, nên mọi kiểm
soát iOS ở đây chưa được kiểm trên máy** — lượt kiểm iOS là điều kiện của bản iOS đầu tiên.

## MASVS-RESILIENCE (L2 — chưa bắt buộc ở L1)

| Kiểm soát | Trạng thái |
| --- | --- |
| Play Integrity / App Attest trên `/auth/desktop/exchange` | Chưa có. Cần tài khoản Play Console (Play Integrity API bật cho app) và Apple (App Attest), rồi server kiểm verdict ở exchange và refresh, bắt đầu ở chế độ chỉ ghi nhận; việc của chủ tài khoản trước, code sau |
| Phát hiện root/jailbreak | Chưa có; khi có Play Integrity thì verdict `MEETS_DEVICE_INTEGRITY` là tín hiệu (tag Sentry, không chặn người dùng) — không tự viết heuristic root |
| Rút gọn mã | R8 + shrink tài nguyên ở bản release Android (`app.config.ts`, `ANDROID_KEEP_RULES`) |
