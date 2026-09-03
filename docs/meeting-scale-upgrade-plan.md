# Kế hoạch nâng cấp scale — Meeting Control Plane

Tài liệu kế hoạch nâng cấp sau P0–P3 (D08a + scale hardening). Bổ sung cho
`meeting-livekit-implementation-plan.md` và `meeting-livekit-architecture-diagrams.md`.

**Mục tiêu:** tối ưu tốc độ hot path, giảm RPS không cần thiết, tăng throughput
worker, hỗ trợ **500+ người chờ lobby** và **100+ người join đồng thời** trên
một cuộc họp (control plane); media plane (LiveKit SFU) scale riêng theo hạ tầng.

**Ngày lập:** 2026-03-03  
**Cập nhật triển khai:** 2026-03-03 — **P4 + P5 ✅** (code merged); **P6** chưa làm.

---

## 1. SLO mục tiêu (staging benchmark)

| Metric | Hiện tại (ước lượng) | Mục tiêu sau P4–P6 |
| --- | --- | --- |
| `POST /join` p95 (ADMIT path) | ~200–500ms (có sync LiveKit) | **< 150ms** (read-only provider check) |
| `POST /join` p95 (WAITING_*) | ~100ms | **< 80ms** |
| Lobby RPS (1000 waiters) | ~17–100 RPS (guest backoff) | **< 5 RPS** (push-driven) |
| Outbox lag p99 | alert > 30s | **< 5s** under 200 concurrent joins |
| Webhook inbox lag p99 | không đo đủ | **< 10s** under 200 participant webhooks |
| Error rate `/join` under load | chưa baseline đầy đủ | **< 0.5%** (không tính 429 intentional) |
| WS event → lobby retry | immediate (no jitter) | jitter 0–3s, không thundering herd |

**Công cụ đo:** k6 (`scripts/load/`), Prometheus gauges
(`uniwork_meeting_outbox_oldest_pending_seconds`, `uniwork_meeting_webhook_inbox_oldest_pending_seconds`),
`uniwork_meeting_join_decisions_total`.

---

## 2. Tổng quan phase

| Phase | Tên | Effort | Impact | Trạng thái |
| --- | --- | --- | --- | --- |
| **P4** | Hot path & lobby push | ~1–2 sprint | 🔴 Cao | ✅ |
| **P5** | Worker throughput & DB | ~0.5–1 sprint | 🟡 Trung bình | ✅ |
| **P6** | In-room UI & dài hạn | ~1–2 sprint | 🟢 Thấp–TB (≤50 vs 100+ camera) | ⏳ Later |

Thứ tự triển khai: **P4 → P5 → P6**. P4 item 4.1–4.3 có thể song song với 4.4–4.5.

---

## 3. Phase P4 — Hot path & lobby push (ưu tiên cao nhất)

### 4.1 Bỏ sync `ensureProviderSession` khỏi HTTP `/join`

**Vấn đề:** Mỗi request ADMIT khi session chưa SYNCED gọi LiveKit `CreateRoom`/`ListRooms`
đồng bộ → thundering herd khi host start + hàng trăm người retry join.

**Giải pháp (đã triển khai):**

1. `Join()` **chỉ đọc** `conferenceSessionReady(sess)` — không gọi provider.
2. Nếu chưa ready → trả `WAITING_FOR_PROVIDER` ngay (1 DB read).
3. Ensure room **chỉ** qua:
   - Sync best-effort sau Start/Instant (giữ nguyên)
   - Outbox worker `provider.ensure_session` (giữ nguyên)
   - `ReconcileProviderDesync` auto-enqueue outbox (P5.2)
4. Khi worker ensure thành công → publish WS `conference.session_ready` (payload:
   `meeting_id`, `conference_session_id`, `version`).

**File đã sửa:**

- `server/internal/service/meeting_admission.go`
- `server/internal/service/meeting_queries.go` — `recordConferenceEnsure` publish event
- `packages/core/types/events.ts` — `conference.session_ready`
- `packages/views/meetings/room-connection.ts` — `LOBBY_JOIN_WS_EVENTS`

**Test:**

- Unit: join khi PENDING → `WAITING_FOR_PROVIDER`, **không** gọi fake provider EnsureSession
- Integration: start meeting → outbox ensure → session SYNCED → join ADMIT
- Regression: desync IDLE vẫn heal qua reconcile/outbox (5.2)

**Acceptance:** k6 100 VU join sau start, p95 < 150ms, fake provider EnsureSession được gọi ≤ 1 lần/meeting (worker), không phải N lần/VU.

---

### 4.2 WS event `conference.session_ready` + lobby listen

**Vấn đề:** Client `WAITING_FOR_PROVIDER` luôn backoff poll dù WS đã connected.

**Giải pháp:**

- Backend publish `conference.session_ready` sau ensure SYNCED.
- FE `useLobbyJoinRetry`: thêm event vào trigger list (cùng `meeting.started`).
- Guest route vẫn thiếu WS → xem 4.3.

**File sửa:**

- `packages/views/meetings/use-lobby-join-retry.ts`
- `packages/views/meetings/room-connection.ts`
- i18n: không cần copy mới (lobby state giữ nguyên)

**Test:** FE unit `shouldTriggerLobbyJoin` với event mới; integration lobby provider wait.

---

### 4.3 Guest lobby push — meeting-scoped realtime

**Vấn đề:**

- `/invite/meeting/{linkId}/room` không có `WSProvider` → chỉ backoff poll.
- `public-invite-view.tsx` lobby **không** auto-retry.

**Giải pháp (đã triển khai — phương án A):**

- Endpoint: `GET /api/v1/meetings/{meetingID}/lobby-ws` (public, off OpenAPI spec).
- Auth: guest cookie `uw_guest` hoặc member JWT; không cần workspace membership.
- Hub scope `meeting:{meeting_id}`; publisher dual-fanout lobby events từ workspace relay.
- Lobby-safe events: `meeting.started`, `meeting.ended`, `meeting.canceled`, `join_request.approved`, `conference.session_ready`.
- Rate limit: **30 connect/min/IP**.
- FE: `MeetingLobbyWSProvider` + `useOptionalMeetingLobbyWS` trên invite routes; `public-invite-view` có `useLobbyJoinRetry`.

**File đã sửa:**

- `server/internal/realtime/meeting_lobby_ws.go`, `publisher.go`, `broadcaster.go` (`ScopeMeeting`)
- `server/internal/service/meeting_lobby.go` — `AllowLobbyListen`
- `server/internal/handler/ws.go`, `router/meetings.go`
- `packages/core/realtime/meeting-lobby-provider.tsx`
- `packages/views/meetings/public-invite-view.tsx`
- `apps/web/app/invite/meeting/[linkId]/room/page.tsx`

**Test:** E2E guest wait → host start → auto join không manual click; k6 lobby 500 VU → RPS < 5.

**Acceptance:** 500 guest waiters, host start, 95% join thành công trong 30s mà không vượt 429.

---

### 4.4 Jitter trên WS-triggered join retry

**Vấn đề:** Tất cả lobby client retry `/join` cùng lúc khi nhận `meeting.started`.

**Giải pháp:**

- Trong `useLobbyJoinRetry`, khi WS event trigger: `setTimeout(onRetry, random(0, 3000))`.
- Giữ immediate retry trên WS reconnect (ít client hơn).

**File:** `packages/views/meetings/use-lobby-join-retry.ts`, test trong `room-connection.test.ts`.

**Acceptance:** k6 burst scenario — p99 join không spike > 3× median.

---

### 4.5 Rate limit tinh chỉnh cho public meeting routes

**Vấn đề:** Public group dùng `credentialLimit` 60 req/min/IP — quá chặt cho NAT/guest.

**Giải pháp (đã triển khai):**

| Route | Limit thực tế |
| --- | --- |
| `POST .../resolve` | 60 req/min/IP (`credentialLimit`) |
| `POST .../join` | **120 req/min/IP** (`joinLimit`) |
| `POST .../join-requests`, cancel | 60 req/min/IP |
| `GET .../lobby-ws` | **30 connect/min/IP** (`lobbyWSLimit`) |

**File:** `server/internal/handler/router/router.go`, `router/meetings.go`, middleware helper.

**Test:** router test rate limit keys; k6 không 429 oan ở 100 VU/5 phút.

---

## 4. Phase P5 — Worker throughput & DB

### 5.1 Index webhook inbox pending queue

**Vấn đề:** Claim query filter `status='PENDING' AND next_attempt_at <= now()` — thiếu index composite.

**Migration 034:**

```sql
CREATE INDEX CONCURRENTLY idx_webhook_inbox_pending
  ON webhook_inbox (status, next_attempt_at)
  WHERE status = 'PENDING';
```

**File:** `server/migrations/034_webhook_inbox_pending_idx.up.sql` (+ down).

---

### 5.2 Auto-heal provider desync

**Vấn đề:** `ReconcileProviderDesync` chỉ audit + metric, không enqueue ensure.

**Giải pháp:**

- Với mỗi meeting IN_PROGRESS + session IDLE: enqueue `provider.ensure_session` (idempotent).
- Giới hạn: max 1 outbox ensure/meeting/5 phút (tránh loop).
- Publish `conference.session_ready` khi heal xong.

**File:** `server/internal/service/meeting_reconcile.go`, outbox insert helper.

**Test:** unit desync → outbox row created; không duplicate trong 5 phút.

---

### 5.3 Tăng worker throughput

**Vấn đề:** Tick 2s, batch 20, xử lý tuần tự → ~10 job/s/node.

**Giải pháp:**

| Param | Hiện tại | Đề xuất | Env |
| --- | --- | --- | --- |
| Worker tick | 2s | **1s** | `MEETING_WORKER_TICK` |
| Outbox batch | 20 | **50** | `MEETING_OUTBOX_BATCH` |
| Webhook batch | 20 | **50** | `MEETING_WEBHOOK_BATCH` |
| Webhook concurrency | 1 | **8** (bounded goroutine pool) | `MEETING_WEBHOOK_CONCURRENCY` |

- Webhook rows độc lập → xử lý parallel với bounded goroutine pool (`sync.WaitGroup` + semaphore).

**Env (defaults mới):**

```env
MEETING_WORKER_TICK=1s
MEETING_OUTBOX_BATCH=50
MEETING_WEBHOOK_BATCH=50
MEETING_WEBHOOK_CONCURRENCY=8
```

**File:** `server/internal/service/meeting_webhook.go`, `meeting_outbox.go` (nếu tách),
`server/internal/config/config.go`.

**Test:** concurrent webhook claim test; benchmark 200 inbox rows < 30s.

---

### 5.4 Join path read optimization (optional, nếu p95 vẫn cao)

**Giải pháp nhẹ:**

- Cache in-process (TTL 2s) `conferenceSessionReady` per session ID — invalidation khi worker ensure.
- Hoặc single query join admission: meeting + participant + grant + session (sqlc view).

**Chỉ làm nếu profiling sau P4 vẫn > 150ms p95.**

---

## 5. Phase P6 — In-room UI & dài hạn

### 6.1 Active speaker layout (50+ participants)

**Vấn đề:** `MeetingConference` render mọi tile → O(n) DOM + hooks.

**Giải pháp:**

- Stage chính: active speaker (1–2 tiles lớn).
- Filmstrip: tối đa 8 thumbnail, scroll horizontal.
- `onlySubscribed: true` giữ nguyên; thêm pagination cho host view.

**File:** `packages/views/meetings/meeting-conference.tsx`, tile components.

**Acceptance:** 50 simulated tracks — FPS ổn trên laptop mid-range; memory không linear tăng vô hạn.

---

### 6.2 WS event attendance (Should)

**Vấn đề:** Attendance chỉ cập nhật qua webhook DB, không push host UI.

**Giải pháp:** Publish `participant.attendance_opened` / `participant.attendance_closed`
(id-only, meeting_id + version) sau webhook worker — **không** trên hot webhook handler.

Invalidate: `meetingParticipants`, `activity` keys.

---

### 6.3 Pagination list endpoints

**Endpoints:** `ListMeetingParticipants`, `ListJoinRequests`, `activity` (cursor/limit).

Cần khi host panel lag với 100+ participants — ưu tiên thấp hơn lobby.

---

### 6.4 Partition & archive (Later — >50M rows)

Theo `meeting-livekit-architecture-diagrams.md` §19:

- Range partition `meeting_attendance_sessions`, `meeting_audit_logs` theo tháng.
- Chạy benchmark trước production enable.

---

## 6. Load test suite mở rộng

Bổ sung `scripts/load/`:

| Script | Mô tả | SLO |
| --- | --- | --- |
| `meeting-burst-join.k6.js` | Host start → 100 VU join trong 5s | p95 < 500ms, errors < 1% |
| `meeting-guest-lobby.k6.js` | 500 VU WAITING + resolve/join guest | RPS < 5 sau WS, no 5xx |
| `meeting-provider-wait.k6.js` | Join khi session PENDING | transition to ADMIT < 30s |
| `meeting-webhook-storm.k6.js` | Mock/simulate 200 webhook posts | inbox lag < 10s |

Cập nhật `meeting-lobby-wait.k6.js`: sleep 10–60s khớp client backoff.

**Gate CI:** không chạy full load trong `make check`; chạy manual staging + nightly optional.

---

## 7. Observability bổ sung

| Metric / alert | Ngưỡng | Phase |
| --- | --- | --- |
| `uniwork_meeting_join_duration_seconds` (histogram) | p95 > 200ms 5m | P4 |
| `uniwork_meeting_lobby_ws_connections` (gauge) | — | P4 |
| `uniwork_meeting_join_429_total` | spike > baseline 3× | P4 |
| `uniwork_meeting_ensure_session_calls_total{source}` | source=http vs worker | P4 |
| Grafana: join decisions stacked + outbox lag | dashboard | P5 |

---

## 8. Rollout & rủi ro

### Rollout

1. Deploy P4 backend trước (join read-only) + worker publish event.
2. Deploy FE jitter + `conference.session_ready` listen.
3. Deploy guest WS/SSE + public invite retry.
4. P5 migration index (CONCURRENTLY — zero downtime).
5. Tune worker env vars theo staging k6.

### Rủi ro

| Rủi ro | Mitigation |
| --- | --- |
| Bỏ sync ensure → user stuck WAITING_FOR_PROVIDER nếu worker chết | Alert outbox lag; reconcile auto-heal; manual ops run ensure |
| Guest WS tăng surface auth | Chỉ lobby-safe events; rate limit connect; không leak participant list |
| Parallel webhook → race attendance | Giữ idempotent upsert + partial unique index |
| Jitter 3s → cảm giác chậm hơn | Chỉ WS-trigger; hiển thị "Đang kết nối…" |

### Feature flags (khuyến nghị)

- `MEETING_JOIN_SYNC_ENSURE=false` (default false sau P4)
- `MEETING_LOBBY_WS_ENABLED=true`
- `MEETING_WEBHOOK_CONCURRENCY=8`

---

## 9. Checklist triển khai

### P4

- [x] 4.1 Join read-only provider check
- [x] 4.2 `conference.session_ready` event
- [x] 4.3 Guest lobby WS + public invite retry
- [x] 4.4 WS retry jitter
- [x] 4.5 Rate limit per-route
- [ ] k6 burst + guest lobby scripts
- [x] Cập nhật `meeting-livekit-architecture-diagrams.md` §7, §14

### P5

- [x] 5.1 Migration 034 index
- [x] 5.2 Desync auto-heal outbox
- [x] 5.3 Worker tuning + parallel webhook
- [ ] 5.4 Join read opt (chỉ khi profiling p95 > 150ms)

### P6

- [ ] 6.1 Active speaker layout
- [ ] 6.2 Attendance WS events
- [ ] 6.3 List pagination
- [ ] 6.4 Partition plan (doc only until volume)

---

## 10. Ước lượng effort

| Phase | Backend | Frontend | Test/ops | Tổng |
| --- | --- | --- | --- | --- |
| P4 | 3–5 ngày | 2–4 ngày | 2 ngày | **~1.5–2 sprint** |
| P5 | 2–3 ngày | — | 1 ngày | **~0.5–1 sprint** |
| P6 | 1–2 ngày | 3–5 ngày | 1 ngày | **~1–1.5 sprint** |

*1 sprint ≈ 2 tuần, 1 dev full-time. Có thể rút ngắn nếu song song BE/FE.*

---

## 11. Tham chiếu mã nguồn (điểm chạm chính)

| Hạng mục | File |
| --- | --- |
| Join hot path | `server/internal/service/meeting_admission.go` |
| Ensure session | `server/internal/service/meeting_lifecycle.go` |
| Workers | `server/internal/service/meeting_webhook.go` |
| Reconcile | `server/internal/service/meeting_reconcile.go` |
| Rate limit | `server/internal/handler/router/router.go` |
| Lobby retry FE | `packages/views/meetings/use-lobby-join-retry.ts` |
| Meeting lobby WS | `server/internal/realtime/meeting_lobby_ws.go`, `packages/core/realtime/meeting-lobby-provider.tsx` |
| Public invite | `packages/views/meetings/public-invite-view.tsx` |
| Realtime dual-publish | `server/internal/realtime/publisher.go` |
| Load tests | `scripts/load/` |
| Kế hoạch scale | `docs/meeting-scale-upgrade-plan.md` (tài liệu này) |
