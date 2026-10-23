# Chat DoD và hardening (C-13.10 / UNI-516, đóng F-12)

> **Trạng thái:** in-progress

Checklist rà soát chat sau chín lát C-13.1–C-13.9. Không thay spec nghiệp vụ mới.

## Audit (`internal/audit`)

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| `chat.room.created`, `member_added`, `member_removed` | done | `audit_coverage_test` |
| `chat.channel.updated`, `chat.channel.archived` | done | |
| Link / thread task / FollowUps | done | |
| `chat.message.deleted` cùng transaction xóa tin | done | Chỉ `audit_events`; realtime ephemeral publish trực tiếp (catalogue `DeliveryEphemeral`) |
| `chat.room.member_updated` (role, `send_restricted`) | done | Audit-only; UI vẫn nhận `chat.room.updated` ephemeral |
| Tạo/sửa tin nhắn **không** audit | n/a | OPEN_QUESTIONS A4 |

## Quyền và cách ly

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Ma trận HTTP tenant (`TestIsolationMatrix`) | done | Mọi route chat đăng ký |
| Kênh riêng: không đọc/ghi khi chưa là thành viên | done | `chat_channels_test.go` |
| Ma trận quyền kênh SQL tập trung | partial | Rải trong `chat_*_test`; bổ sung khi có regression |

## Tải và realtime

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| k6 đọc kênh + tin (`chat-read-5000.k6.js`) | done | Báo cáo nightly; WS 5k VU — backlog |
| k6 WS thread fan-out 5k VU | backlog | Cần seed + scenario riêng |

## i18n và E2E

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Parity `chat.*` vi/en | done | `scripts/i18n-chat-key-parity.test.mjs` |
| Playwright luồng gửi tin workspace | done | `e2e/chat-smoke.spec.ts` |
| Playwright file/voice | done | `e2e/files-chat.spec.ts` |

## Compliance và dọn API

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Export/xóa dữ liệu chat (C-06) | backlog | Phụ thuộc epic tenant export |
| Gỡ `GET/POST …/chat/room`, `…/chat/messages` | backlog | Chờ mobile C-08 / clients chuyển hết |

## Phụ thuộc epic

- **UNI-513** (C-13.7 AI CatchUp) còn `in_progress` — đóng epic C-13 sau khi 513 done và checklist trên ở trạng thái ship.
