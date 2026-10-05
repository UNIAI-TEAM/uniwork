# Đánh giá tải hệ thống họp online: họp đồng thời nhiều cuộc và họp đông người

> **Ngày đánh giá:** 2026-10-05 · **Issue:** UNI-935 (đợt P0) · Đánh giá từ code, chưa có số đo tải thật: mọi ngưỡng là ước lượng, cần k6 ở mục 6 để xác nhận. Số dòng `path:line` đúng tại commit `952010c4`.

## 1. Kết luận ngắn

Hệ thống **chưa được tối ưu cho tải cao**, dù hướng thiết kế đúng. `/join` không gọi LiveKit và ký JWT tại chỗ. Lobby nhận push qua WS và có jitter. Webhook đi qua inbox, dedupe và `SKIP LOCKED`. Client bật `adaptiveStream`/`dynacast`. Nhưng hạ tầng và các đường fan-out vẫn ở quy mô "vài cuộc họp nhỏ".

- **Kịch bản (A), nhiều cuộc họp đồng thời.** Triển khai hiện tại gồm 1 pod BE 500m CPU/512Mi chạy cả API, WS và mọi worker, 1 node LiveKit dùng chung với lms-core. Vùng an toàn ước lượng (cần đo) là khoảng **10–20 cuộc họp × 10–30 người**, với điều kiện chúng không cùng bắt đầu trong một phút. Giới hạn chạm đầu tiên:
  1. Rate limit toàn cục **300 req/phút** chặn webhook LiveKit, vì cả platform chỉ có một key IP. Chỉ cần khoảng 50–100 người join trong cùng một phút là vượt, và từ đó attendance bị mất event.
  2. Outbox dispatcher xử lý tuần tự, trần **~50 row/s**. Nó dùng chung cho mọi tenant và gọi LiveKit **không có timeout**.
  3. Pool pgx không đặt kích thước, không có `statement_timeout`.
- **Kịch bản (B), một cuộc họp đông người.** Khoảng **30–50 người** chạy ổn. Từ **50–100** bắt đầu có refetch storm và lobby O(N²). Trên **100** thì chưa an toàn. Nếu người họp ngồi sau **một NAT văn phòng**, ngưỡng chỉ còn khoảng **30–60 người**, vì rate limit theo IP+path (60/phút cho GET chat/participants, 120/phút cho join/ballot) trả 429 trước khi CPU hay media chạm giới hạn. Với link mời, vài chục khách join cùng giây có thể làm **pool DB tự deadlock**.
- Chưa có load test nào chứng minh năng lực xử lý. Production cũng **không phát metrics** vì không đặt `METRICS_ADDR`, nên mọi con số trên là ước lượng từ code.

## 2. Bảng điểm theo khía cạnh

| Khía cạnh | Điểm/10 | Lý do |
|---|---|---|
| Join / admission / token | 5 | Đường ADMIT chỉ đọc và ký JWT local. Đường invite-link giữ 2 kết nối pool. Lobby O(N²). Mỗi lần retry lại ghi audit và outbox. |
| Lobby + realtime fan-out (WS hub, Redis relay) | 4 | Lobby dùng push, có xử lý slow consumer. Event trong phòng lại fan-out ra toàn workspace. Relay theo từng scope. Dispatcher outbox dùng chung. |
| Worker nền (webhook, outbox, reconcile) | 4 | Inbox, `SKIP LOCKED` và parallel theo identity đều tốt. Webhook bị rate limit toàn cục. Outbox tuần tự, không có timeout. Webhook at-most-once. |
| DB schema / index / query | 5 | Index cho đường nóng và partial unique làm invariant đều tốt. Thiếu retention, thiếu nhiều index `meeting_id`. Metering N+1. Pool chưa cấu hình. |
| Client trong phòng (render, refetch) | 4 | Media config tốt, tile phân trang và memo. ConferenceStage re-render theo mọi event. Mọi client refetch full list. |
| Tính năng trong phòng (chat, vote, transcript, AI, recording) | 4 | Đường ghi nhẹ, ballot khoá đúng chỗ. Đọc lại full list, rate limit theo NAT, LLM chạy trong dispatcher. |
| Media plane, triển khai, quan sát | 3 | 1 pod 500m, không HPA/PDB, ADR 0025 cấm scale. 1 node LiveKit dùng chung. Production không có metrics. |
| **Tổng thể** | **4** | Hướng thiết kế đúng nhưng chưa sẵn sàng cho tải đồng thời. |

## 3. Điểm đã làm tốt

- **`/join` không gọi provider.** `Join` chỉ đọc `GetOpenConferenceSession` và `conferenceSessionReady` rồi mới `IssueJoinCredential` (`server/internal/service/meeting_admission.go:52-83`). Token được ký local bằng `mintToken` (`server/internal/meetings/livekit.go:111-125`). Phòng IDLE được requeue qua CAS `MarkConferenceSessionResyncing` (`meeting_admission.go:178-203`).
- **Đường ADMIT cho member hoặc người có grant không mở transaction, không khoá row.** Chỉ có các lệnh đọc dùng index: `meeting_admission.go:87-161`, uidx 018 cho session đang mở, index 014 `(participant_id,status)` cho grant.
- **Lobby khách có push riêng theo cuộc họp.** WS lobby chỉ subscribe `ScopeMeeting` (`server/internal/realtime/meeting_lobby_ws.go:131-138`, `hub.go:363-365`). Publisher mirror các event lobby sang scope này (`realtime/publisher.go:52-61`). Client chỉ poll khi WS rớt hoặc khi đang ở `WAITING_FOR_PROVIDER` (`packages/views/meetings/use-lobby-join-retry.ts:81-92`). Retry do WS kích hoạt có jitter 0–3s (`room-connection.ts:15-20`).
- **Webhook ingest nhẹ.** Handler lọc theo loại event và theo phòng UniWork trước khi chạm DB (`server/internal/handler/meeting_token.go:62-97`). Sau đó chỉ một lệnh INSERT `ON CONFLICT DO NOTHING` (`server/pkg/db/queries/meeting_control.sql:363-366`). Claim dùng `SKIP LOCKED` kèm lease và commit trước khi xử lý (`meeting_control.sql:368-379`, `server/internal/service/meeting_webhook.go:52-67`). Xử lý song song 8 luồng, gom theo identity (`meeting_webhook.go:69-130`). Partial index 034 có hiệu lực.
- **State machine attendance chịu được thứ tự sai và idempotent.** Advisory lock theo participant (`meeting_control.sql:465-469`), xử lý SID và backdating (`meeting_room_sessions.go:47-73,223-241`), uidx 033, metering idempotent (`meeting_queries.go:122-126`).
- **Outbox claim an toàn khi nhiều replica.** Có lease 120s, commit claim trước khi deliver, retry backoff có jitter, DLQ sau 10 lần (`server/internal/outbox/outbox.go:32,43-52,139-230`).
- **Tín hiệu tần suất cao đi đường ephemeral.** Chat, transcript và `attendance.updated` không ghi audit hay outbox (`meeting_chat.go:66-80`, `meeting_ai.go:77-84,127-137`, `outbox/catalogue.go:197,210-216`). Raise hand và reaction đi qua data channel LiveKit (`use-meeting-signals.tsx:140`).
- **Hub WS xử lý slow consumer đúng cách.** Gửi non-blocking, buffer 256, evict ngoài RLock (`hub.go:528-556,649-692,872`). Có dedup theo event-id cho từng client (`hub.go:256-276`). Pool Redis cho blocking read tách riêng (`relay_read_client.go:10-21`).
- **Client gộp invalidation.** Cửa sổ cố định 250ms, transcript 1500ms (`packages/core/realtime/invalidate-scheduler.ts:7-34`). Có version guard cho meeting detail (`use-realtime-sync.ts:490-503`). React Query chỉ refetch query đang active.
- **Media phía client.** `adaptiveStream` và `dynacast` bật (`room-view.tsx:388-391`). simulcast, dtx, red là mặc định của SDK. Tile phân trang tối đa 16 (`room-preferences.ts:18-20`, `conference-layout.ts:5-7`), tile được memo (`meeting-participant-tile.tsx:456-469`). Token được làm mới tại chỗ, không remount phòng (`meeting-proactive-token-refresh.tsx:25-54`).
- **Rate limiter atomic và fail-open.** Dùng Lua INCR+EXPIRE, bỏ qua OPTIONS (`middleware/ratelimit.go:21-27,68-82`). `TRUSTED_PROXIES` được đặt nên key là IP thật của client (`deploy/app/env/uniwork-be.env:12`).
- **Reconcile chỉ đọc DB, không poll LiveKit theo từng phòng.** Các query có `LIMIT 50` (`meeting_reconcile.go:9-35`, `meeting_webhook.go:152-177`). End đóng mọi attendance trong cùng transaction CAS (`meeting_lifecycle.go:180-217`).

## 4. Điểm nghẽn và rủi ro (đã gộp các phát hiện trùng, xếp theo mức độ)

### Nghiêm trọng (critical)

**G1. Webhook LiveKit bị rate limit toàn cục 300/phút với đúng một key.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng: `server/internal/handler/router/router.go:69` áp `mw.ExceptPaths(mw.RateLimit(d.Redis, 300, ...), "/healthz", "/readyz")`, route webhook không được miễn (`router/meetings.go:241`). Key là `limit:path:ip` (`middleware/ratelimit.go:74-75,170-174`). LiveKit gửi từ `10.244.217.192` (`deploy/livekit/allow-hostnetwork-uniwork-webhook.yaml:26,46-47`) và không có XFF, nên mọi webhook dùng chung một key `RemoteAddr`. Khi vượt, server trả 429 với `Retry-After: 60`. Notifier của LiveKit có `QueueSize 100` và `DropWhenFull` (`protocol@v1.50.4 webhook/url_notifier.go:43-46,111-116`).
- Tác động: mỗi người sinh khoảng 6 event (joined, track pub/unpub, left), nên chỉ khoảng 50 người join trong một phút trên toàn platform là vượt. Ví dụ 3–5 phòng × 20–30 người cùng bắt đầu lúc 9:00. Khi đó LiveKit ngủ 60s, queue đầy và event bị drop. Hậu quả: attendance và số phút họp sai, mất `room_finished`, mất `egress_ended`. Tăng replica không giúp được vì counter nằm trong Redis dùng chung.
- Cách sửa: thêm `/api/v1/integrations/livekit/webhook` vào `ExceptPaths`, vì đã có HMAC và NetworkPolicy bảo vệ. Cấu hình `include_events` ở LiveKit nếu version hỗ trợ. Thêm alert 429 theo route.

**G2. Join qua invite-link giữ một connection trong transaction rồi lấy thêm connection thứ hai, có thể làm pool tự deadlock. Pool chưa đặt kích thước, không có timeout.** Kịch bản: cả hai, rõ nhất ở webinar. Trạng thái: **đã xác minh cơ chế**; kích thước pool thực tế **cần đo thêm** vì nằm trong secret `DATABASE_URL`.
- Bằng chứng: `meeting_admission.go:132` đưa mọi request có `InviteLinkID` vào `evaluateInviteLink`. Tại `:231` hàm gọi `s.pool.Begin`, sau đó `:244` `lookupPrincipal` và `:250` `ListActiveGrantsForParticipant` lại chạy trên `s.q` (pool), không chạy trên tx. Đường này chạy cho mọi lần join, refresh token và rejoin của khách, kể cả khách đã có grant (`room-view.tsx:122-127`). `cmd/server/main.go:69-78` không đặt `MaxConns`, nên pgx dùng mặc định `max(4, NumCPU của node)`. Không có `statement_timeout`, `idle_in_transaction_session_timeout`, `WriteTimeout` hay timeout theo request (`main.go:471-481`). Chính `workspace.go:217-220` đã ghi lại anti-pattern này.
- Tác động: khi số join qua link đồng thời bằng `MaxConns`, mỗi request giữ connection A và chờ B mãi. API, outbox và mọi worker trong cùng process đứng hình cho đến khi client ngắt kết nối. Tình huống này xảy ra khi khoảng 10–30 khách mở link cùng giây, hoặc khi refresh token đồng loạt. Ngoài ra, join lần đầu bị tuần tự hoá trên row link vì `ConsumeInviteLinkUse` chạy trước materialize (`meeting_admission.go:267-283`).
- Cách sửa: chạy verify, lookup và kiểm tra grant **trước** `Begin`, chỉ mở tx cho phần materialize lần đầu. Dời `ConsumeInviteLinkUse` xuống cuối, bỏ qua khi `max_uses IS NULL`. Đặt `pool_max_conns`, `statement_timeout` (~5s), `lock_timeout` (~2s), `idle_in_transaction_session_timeout` và context timeout cho mỗi request.

**G3. Outbox dispatcher duy nhất, tuần tự, không có timeout: bị chặn đầu hàng bởi LiveKit, LLM và web push; có trần ~50 row/s; push "đã được duyệt" của lobby cũng đi qua đây.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng:
  - Một dispatcher cho cả process (`main.go:314-367`), đăng ký ProviderConsumer (LiveKit), realtime, audit export, notification, push, chat-task sync và `ChatVoiceSummaryConsumer` (LLM).
  - `Run` chỉ gọi `Process` một lần mỗi tick, không lặp khi batch đầy (`outbox.go:121-134`). Row được deliver tuần tự, consumer cũng chạy tuần tự (`:163-190`). Batch 50, tick 1s (`config.go:144-145`, `uniwork-be.env:54-55`).
  - `lksdk.NewRoomServiceClient` dùng `&http.Client{}` không có Timeout (server-sdk-go v2.12.2 `roomclient.go:38`). `runCtx` không có deadline (`main.go:367`). LLM có thể chạy tới 60s (`chat_voice_summary.go:58-150`, `ai/gateway.go:90-93`). Webpush cũng không có timeout (`notification/push.go:50`), nhưng hiện đang tắt vì `VAPID_PUBLIC_KEY` rỗng.
  - `join_request.*` dùng `DeliveryOutbox` (`catalogue.go:205-208`).
  - `ReleaseStaleOutboxClaims` chỉ chạy ở đầu `Process` (`outbox.go:143`), nên khi `Process` đang treo thì không gì giải phóng claim.
- Tác động: một lời gọi LiveKit chậm hoặc treo, hay một voice summary, làm đông cứng `meeting.started`, `join_request.approved`, task và notification của **mọi tenant**. 50 cuộc họp start cùng lúc × 3s CreateRoom tương đương khoảng 150s nghẽn. Đợt 9:00 có 100 cuộc họp, hoặc lobby 200 khách (khoảng 400 row `join_request`), làm frame realtime trễ 5–10s trở lên. Trần 50 row/s cũng là trần của cả cluster vì `replicaCount: 1`.
- Cách sửa: thêm `context.WithTimeout` (~5s) cho mọi lời gọi provider và cho từng consumer trong `Dispatcher.deliver`. Truyền `http.Client` có Timeout cho lksdk. Lặp `Process` khi batch còn đầy. Tách lane (realtime / provider / notification / AI) với worker pool riêng và giữ thứ tự theo meeting/workspace. Chuyển LLM sang job queue bất đồng bộ. Đưa `join_request.approved/rejected` vào lane ưu tiên, hoặc publish trực tiếp sau commit (outbox giữ bản bền vững). Mark done theo lô (`id = ANY($1)`).

**G4. Rate limit theo IP+path chặn cuộc họp đông người sau NAT văn phòng.** Kịch bản: B. Trạng thái: **đã xác minh**.
- Bằng chứng: `router.go:69-73` đặt global 300, credential 60, join 120, lobby-ws 30 mỗi phút. Key gồm IP và `r.URL.Path` có meetingID, nên mỗi bucket tính theo từng cuộc họp, từng IP (`ratelimit.go:74-75`). Áp dụng cụ thể (`router/meetings.go`):
  - GET `/participants` (`:200`) và GET `/chat` (`:203`): 60/phút.
  - POST `/join` (`:188`), POST `/chat` (`:206`), ballot (`:219`), transcript/agent (`:223`): 120/phút.
  - `/lobby-ws` (`:199`): 30/phút.
  - `/api/v1/ws` (`router.go:96`) dùng chung bucket global 300 của mọi người trong văn phòng.

  Riêng `/motions` đã được gỡ khỏi budget credential vì đúng lý do NAT (`meetings.go:210-213`). Khi gặp 429, lobby dừng mọi retry tự động vì `waiting=false` khi `hasJoinError` (`use-lobby-join-retry.ts:36`, `room-view.tsx:222`). Thêm vào đó, `retry:1` (`packages/core/query-client.ts:6`) nhân đôi số request bị từ chối.
- Tác động: với 30–60 người cùng IP, chỉ 1–2 tin chat là hết budget GET `/chat`, và chat bị treo 60s. Ngay cả một người dùng đơn lẻ cũng chạm 60/phút khi phòng chat khoảng 1 tin/giây. Người bỏ phiếu thứ 121 từ cùng văn phòng bị 429. Khách đã được duyệt nhưng gặp 429 sẽ kẹt ở màn hình lỗi. Một văn phòng 300+ người chỉ mở được 300 kết nối WS mỗi phút sau mỗi lần deploy.
- Cách sửa: với request đã xác thực (JWT hoặc guest session), key theo `user_id`/`guest_id` + meeting. Giữ trần IP thô khoảng 3000/phút làm chốt chống DoS. Bỏ 429 cho các GET do push kích hoạt (dùng ETag/304). Hook lobby coi 429/503 là lỗi có thể retry và tôn trọng `Retry-After` kèm jitter. Không retry 429 trong query client.

**G5. Một pod BE 500m CPU gánh API, WS và khoảng 15 worker; không HPA/PDB; ADR 0025 cấm scale ngang; rolling update vẫn chạy 2 bản.** Kịch bản: cả hai. Trạng thái: **đã xác minh**. Ngưỡng tải cụ thể **cần đo thêm**.
- Bằng chứng: `deploy/app/uniwork/values.yaml:20-31` (`replicaCount: 1`, limits 500m/512Mi). `deployment-be.yaml` không khai báo strategy, preStop, HPA hay PDB. `docs/adr/0025-mot-process-cho-api-va-worker.md:47-51,66` ghi "replicaCount > 1 là lỗi". RollingUpdate mặc định (maxSurge 1) nên mỗi lần deploy vẫn có 2 pod chạy cùng lúc. Go 1.27 nhận biết cgroup, nên ~2 P chạy trên quota 50ms/100ms và dễ bị CFS throttle khi có join storm.
- Tác động: control plane của mọi tenant nằm trên nửa core, tranh CPU với AI, email và office. Pod OOM hoặc restart là mất join, lobby và attendance cùng lúc. Ước lượng nghẽn ở khoảng 20–50 cuộc họp song song, hoặc vài trăm join/phút.
- Cách sửa: hoàn tất mục 3 của ADR 0025 (leader lock cho digest, IMAP, RunAutoEnd), rồi đặt ≥2 replica, PDB, HPA. Tách `SERVER_ROLE=api|worker`. Tạm thời nâng limit lên 1–2 CPU/1Gi và đặt `GOMEMLIMIT`.

### Cao (high)

**G6. Lobby herd O(N²): mỗi lần approve hoặc reject đánh thức mọi người đang chờ, và mỗi lần retry lại ghi thêm audit và outbox.** Kịch bản: B, lan sang A qua outbox. Trạng thái: **đã xác minh**.
- Bằng chứng: client chỉ lọc theo `meeting_id` (`packages/views/meetings/room-connection.ts:5-12,33-40`). Mỗi event đặt một timer riêng, không gộp (`use-lobby-join-retry.ts:57-66`). Payload đã có sẵn `join_request_id` (`meeting_admission.go:555,586`, chuyển nguyên vẹn qua `realtime_consumer.go:66-92`). `ensureJoinRequest` gọi `s.record` vô điều kiện, kể cả khi row PENDING đã tồn tại (`meeting_admission.go:353-385`, tương tự ở `:259-261`). `admitAll` approve tuần tự (`use-join-request-actions.ts:61-73`). Hai lần knock đồng thời trúng unique violation và trả 500 (`meeting_control.sql:151-156`).
- Tác động: W người chờ cần khoảng W²/2 lần POST `/join`. 50 người là khoảng 1.250 lần, 100 người khoảng 5.000 lần, 200 người khoảng 20.000 lần. Mỗi lần là một transaction ghi audit và outbox, nên 100 người chờ để lại khoảng 5.000 audit row vĩnh viễn và khoảng 100s lag outbox cho mọi tenant (G3). Bắt đầu đáng kể từ khoảng 30–50 người chờ.
- Cách sửa: client chỉ phản ứng khi `payload.join_request_id` khớp với request của chính mình, và giữ đúng một timer đang chờ. Bổ sung `join_request_id` vào cả 3 bản catalogue. `ensureJoinRequestTx` trả cờ `created`; chỉ `record` khi thực sự insert. Thêm endpoint bulk-approve phát một event. Dùng `ON CONFLICT DO NOTHING` rồi đọc lại row.

**G7. Refetch storm trong phòng: mỗi event khiến mọi client tải lại toàn bộ danh sách.** Kịch bản: B. Trạng thái: **đã xác minh**.
- Bằng chứng:
  - Chat: `useMeetingChatUnread` luôn mount chat query cho mọi người trong phòng (`meeting-room-announcers.tsx:121-124`, `meeting-conference.tsx:265`). Query có `staleTime 0` (`packages/core/meetings/hooks.ts:412-421`) và trả tối đa 5.000 row (`meeting_chat.go:15`, `meeting_chat.sql:8`).
  - Motions: mỗi lần GET tốn khoảng 9–10 query (`meeting_motion_views.go:59-120`) và trả **mọi voter công khai của mọi motion đã đóng** (`meeting_motions.sql:130-137`).
  - Participants: refetch theo mọi event `participant.*` và `join_request.*`, không có LIMIT (`meeting_control.sql:17-19`).
  - Transcript: tải lại toàn bộ mỗi 1,5s.
  - Phía khách, `use-meeting-lobby-sync.ts:25-56` invalidate ngay theo từng event, không qua scheduler.
  - Người gửi đã patch cache nhưng vẫn nhận lại frame của chính mình và refetch thêm lần nữa.
- Tác động:
  - Phòng 200 người chat 1 tin/giây: khoảng 200 GET/giây, mỗi GET trả toàn bộ lịch sử chat.
  - Vote 200 phiếu trong 5s: khoảng 4.000 GET `/motions`, tức khoảng 40k query.
  - Đại hội cổ đông có 15 nghị quyết công khai đã đóng × 500 voter: khoảng 7.500 row cho mỗi GET.

  Bắt đầu đáng kể từ 50–100 người trong một phòng hoạt động sôi nổi.
- Cách sửa: chat và transcript dùng cursor `?after=` rồi append qua `setQueryData`. Gom `motion.ballot_cast` phía server (tally mỗi ~1s), hoặc đưa tally vào frame (cần ADR giống ADR 0015). Chỉ tải voter khi người dùng mở một motion. Tách `my_ballot` thành query riêng. Gộp chuỗi kiểm tra quyền thành một query (`meeting_participant_access.go:17-26`, `meeting_duties.go:24-40` đang đọc lại 2–3 lần). Lobby khách dùng `createInvalidateScheduler`. Client bỏ qua event do chính mình gây ra.

**G8. Event trong phòng fan-out ra cả workspace; member không được subscribe scope meeting; heartbeat presence broadcast toàn workspace.** Kịch bản: A. Trạng thái: **đã xác minh**.
- Bằng chứng: mọi row meeting, participant, motion, join_request, chat và transcript đều có `Scope: ScopeWorkspace` (`outbox/catalogue.go:183-216`). `publisher.go:53` luôn gọi `BroadcastToWorkspace`. `hub.go:1008-1017` từ chối `ScopeMeeting` cho socket member. Heartbeat presence chạy mỗi 15s trên mọi trang shell, kể cả phòng họp (`packages/core/chat/use-chat-presence-heartbeat.ts:6,28-29`, `dashboard-layout.tsx:57`). Mỗi beat chạy `RequireMember` rồi publish đồng bộ ra workspace (`chat_signal.go:141-167`). Throttle phía server cũng là 15s (`chat_presence_throttle.go:9`), bằng đúng chu kỳ client.
- Tác động: client không trong phòng không refetch, nên chi phí rơi vào server: ghi WS, marshal, XADD ×2. Với workspace 500 socket và 20 cuộc họp sôi nổi, mỗi giây có khoảng 5k lần ghi WS trên 0,5 core. Riêng presence với U=500 tạo khoảng 17–33 publish/s, tức khoảng 8–17k frame/s. Văn phòng khoảng 8 người sau một NAT đã vượt 30/phút trên route presence.
- Cách sửa: mở `ScopeMeeting` cho socket member qua `authorizeActiveParticipant` (có cache). Chuyển các topic trong phòng (chat, transcript, attendance, participant.updated, motion.*, recording.*, join_request.*, session_ready) sang scope meeting ở cả 3 bản catalogue. Presence lưu trong Redis (SETEX/ZSET), chỉ publish khi trạng thái chuyển, heartbeat gộp vào app ping WS 25s, rate limit key theo user.

**G9. Production không phát metrics; alert không phủ webhook, WS hay provider; lag collector mù đúng lúc tải cao.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng: registry chỉ được tạo khi có `METRICS_ADDR` (`metrics/config.go:13-19`, `main.go:119-129,230-231`), mà `uniwork-be.env` không đặt biến này, còn `OTEL_EXPORTER_OTLP_ENDPOINT` để rỗng (`:98`). `deploy/alerts.yml` chỉ có 8 alert, không có alert nào cho webhook inbox, `slow_evictions`, `redis_xread_errors` hay 429. `OutboxLagCollector` quét toàn bảng với `context.Background()` (`metrics/audit.go:124-130`). `meeting_lag.go:46-58` nuốt lỗi Scan và trả về 0.
- Tác động: G1, G3 và G6 hỏng mà không ai biết. Khi DB quá tải, scrape timeout, `OutboxLagHigh` không thể fire.
- Cách sửa: đặt `METRICS_ADDR=0.0.0.0:9090` kèm ServiceMonitor và PrometheusRule. Thêm alert `WebhookInboxLagHigh`, webhook DLQ, 429 theo route, evictions, xread errors, histogram latency provider và join. Lag query chạy trên partial index, có timeout, phát metric scrape-error thay vì 0.

**G10. Redis relay theo từng scope; `ShardedStreamRelay` chưa được nối; key và consumer group rò rỉ; client mới nhận replay event cũ.** Kịch bản: A, và B qua lobby. Trạng thái: **đã xác minh**.
- Bằng chứng: `main.go:155-159` dùng `NewRedisRelayWithClients` và `NewDualWriteBroadcaster`. `NewShardedStreamRelay` và `NewMirroredRelay` không có caller nào ngoài test. Mỗi scope có một goroutine và một XREADGROUP Block 5s, pool tối đa 1024 (`redis_relay.go:282-349`, `relay_read_client.go:10`). Không có `XGROUP DESTROY` hay EXPIRE. `MAXLEN 10000` (`:29`). Group được tạo một lần tại `$` rồi giữ nguyên last-delivered-id, nên khi một room lobby được lấp lại, XREADGROUP `>` giao toàn bộ backlog cho client mới, client này có `markSeen` rỗng (`redis_relay.go:305-331,346`). `NodesKey` được ghi nhưng không ai đọc.
- Tác động: vượt khoảng 1.000 scope mỗi pod thì gặp lỗi xread và backoff. Hiện chưa mất event vì DualWrite đã giao local trước. Memory Redis tăng theo từng scope từng dùng và theo mỗi lần deploy. Khách vào lobby sau khi host đã duyệt 200 người có thể nhận khoảng 200 approval cũ, tương đương khoảng 200 POST `/join`. Đây là rào cản chính để scale ngang.
- Cách sửa: nối `ShardedStreamRelay` sau `MirroredRelay` như thiết kế. Trước mắt, khi room chuyển từ 0 lên 1 client thì chạy `XGROUP SETID <group> $`, hoặc bỏ envelope cũ hơn thời điểm subscribe. Bỏ qua envelope có `NodeID == r.nodeID`. Cho phép tắt relay khi chỉ có 1 replica.

**G11. Media plane: một node LiveKit dùng chung với lms-core, không giới hạn số phòng hay participant, config nằm ngoài repo.** Kịch bản: cả hai. Trạng thái: **đã xác minh** phần có trong repo; ngưỡng **cần đo thêm**.
- Bằng chứng: `deploy/livekit/README.md:7-10`, `allow-hostnetwork-uniwork-webhook.yaml:12,26` (một node). `MaxParticipants` được truyền ở `livekit.go:97` nhưng không caller nào đặt giá trị (`meeting_lifecycle.go:139-142`, `meeting_queries.go:150-152`). Webhook dùng chung API key với lms-core (`meeting_token.go:45-46`).
- Tác động: SFU là SPOF và chịu noisy neighbour. Không có admission control theo tổ chức.
- Cách sửa: tách cluster hoặc project LiveKit riêng (multi-node, Redis riêng, TURN/TLS). Đặt `MaxParticipants` theo entitlement và thêm entitlement `concurrent_rooms`. Scrape `prometheus_port` của LiveKit. Chạy `lk load-test`.

**G12. Không có retention cho `outbox_events`, `webhook_inbox`, `meeting_provider_events`, trong khi chúng bị quét định kỳ.** Kịch bản: A, tăng dần theo thời gian. Trạng thái: **đã xác minh**.
- Bằng chứng: không có DELETE nào cho các bảng này trong `server/`. `ReleaseStaleWebhookInbox` (`WHERE status='PROCESSING'`) chạy mỗi giây (`meeting_control.sql:381-385`, `meeting_webhook.go:52`), nhưng index 034 chỉ phủ PENDING. `OutboxLagCollector` aggregate toàn bảng mỗi 15s.
- Tác động: với 1.000 cuộc họp/ngày, hàng triệu row mỗi tháng. Các lần quét này lên 100ms–1s chỉ sau vài tuần và chiếm connection trong pool.
- Cách sửa: thêm job retention theo lô (DONE/DEAD cũ hơn 7–14 ngày, mỗi lô 5k), đăng ký trong chuỗi shutdown. Thêm partial index `webhook_inbox(next_attempt_at) WHERE status='PROCESSING'` và outbox `(created_at) WHERE status IN ('PENDING','PROCESSING')`. Lưu ý `meeting_provider_events` đang phục vụ re-entry của `recording_ended` (`meeting_queries.go:47-56`).

### Trung bình (medium)

**G13. Thiếu index theo `meeting_id`, gây seq scan xuyên tenant, có lúc ngay trong transaction End/Cancel.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng: `meeting_join_requests` chỉ có partial uidx 016/017 (PENDING), nên `GetLatestJoinRequestFor*` và `ListJoinRequests` không dùng được index (`meeting_control.sql:172-188`). `ExpirePendingJoinRequests` và `RevokeGrantsForMeeting` chạy trong transaction End/Cancel trong khi giữ khoá row meeting (`meeting_lifecycle.go:218-219,267`). Index còn thiếu: `meeting_access_grants(meeting_id)`, `meeting_invitations(meeting_id)`, `meeting_recordings(egress_id)`, `meeting_notes(meeting_id)`, `meetings(ends_at|starts_at) WHERE status=...`. Lookup participant bất kể trạng thái chỉ dựa vào index 010 (`meeting_control.sql:31-43`). Reminder và auto-end quét `meetings` xuyên tenant mỗi phút.
- Tác động: với khoảng 10⁶ row grant, mỗi End chậm thêm 100–200ms. 50 cuộc họp kết thúc lúc :00 là 50 lần full scan song song.
- Cách sửa: tạo các index trên bằng `CONCURRENTLY`, mỗi index một file migration. Xoá `MeetingCounts`/`MeetingListStats` vì là dead code.

**G14. Metering số phút họp chạy N+1, đồng bộ trong request End và trong luồng webhook.** Kịch bản: B. Trạng thái: **đã xác minh**.
- Bằng chứng: `meeting_lifecycle.go:236-240` chạy trên ctx của request. `meterAttendance` tốn khoảng 8–10 round-trip mỗi session (`meeting_queries.go:101-131`, `entitlement.go:283-341`). Lỗi bị nuốt. Reconcile 5 phút chạy chung goroutine với webhook (`meeting_webhook.go:188-197`).
- Tác động: kết thúc một cuộc họp 300 người tốn khoảng 2.000–3.000 round-trip, tức 2–5s. Nếu client ngắt kết nối, số phút còn lại bị mất. Sau một sự cố, một lần reconcile có thể chặn inbox rất lâu.
- Cách sửa: meter theo lô (`INSERT ... SELECT` hoặc unnest, kèm idempotency key, một lần cộng tổng), chạy bất đồng bộ. Tách reconcile ra goroutine riêng.

**G15. Webhook xử lý at-most-once: dedupe được commit trước khi xử lý, mọi lỗi DB đều `return nil`.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng: `meeting_queries.go:41-67`, `meeting_room_sessions.go:88-215` (comment ghi "best effort... a retry would be skipped"). `RunWorkers`/`RunAutoEnd` là goroutine trần, không được chờ khi shutdown (`main.go:362-363`). `room_started`/`room_finished` dùng `time.Now()` thay vì `OccurredAt` (`meeting_queries.go:70-80`).
- Tác động: khi DB chịu áp lực, và ở mỗi lần deploy, join/leave biến mất lặng lẽ. Số phút bị phồng lên theo backlog (đặc biệt khi kết hợp với 429 ở G1).
- Cách sửa: ghi `meeting_provider_events` trong cùng transaction với thay đổi trạng thái và trả lỗi thật để retry/DLQ hoạt động. Dùng `LEAST(now(), occurred_at)`. Đưa worker vào chuỗi shutdown.

**G16. Ensure gọi 2 lần mỗi lần Start/instant, và lần ensure dư ở worker có thể hạ cấp một session đang khoẻ.** Kịch bản: A. Trạng thái: **đã xác minh**.
- Bằng chứng: Start enqueue rồi gọi đồng bộ (`meeting_lifecycle.go:121-133`), instant cũng vậy (`:69,80`). `recordConferenceEnsure` ghi READY/FAILED mà không kiểm tra trạng thái hiện tại (`meeting_queries.go:168-197`). `requeueIdleProviderSession` chỉ sửa trường hợp IDLE+SYNCED (`meeting_admission.go:179`).
- Tác động: 100 lần start sinh 200 CreateRoom. Một lỗi tạm thời ở lần gọi dư đưa mọi join và refresh của phòng đang họp vào `WAITING_FOR_PROVIDER` trong vài giây đến vài phút (backoff tới 5 phút). LiveKitAdapter còn khởi tạo client lazy mà không có `sync.Once` (data race), và tạo `EgressClient` mới mỗi lần gọi (`livekit.go:76-82,159-161`).
- Cách sửa: bỏ ensure đồng bộ, hoặc bỏ qua bước worker khi session đã SYNCED. Chỉ cập nhật trạng thái khi đang ở IDLE/RESYNCING. Khởi tạo client một lần và dùng `http.Client` có timeout.

**G17. Render trong phòng: mọi event LiveKit làm re-render toàn bộ `ConferenceStage`; tự động subscribe mọi track; tab People không ảo hoá; mic và camera bật mặc định.** Kịch bản: B. Trạng thái: C1, C6, C7, C8 **đã xác minh**; C2 (autoSubscribe) **cần đo thêm**.
- Bằng chứng:
  - `useTracks` không có `updateOnlyOn`, nhiều hook `useParticipants()` chạy với event mặc định, closure inline (`meeting-conference.tsx:219-240,294-341,480-496`, `meeting-stage-header.tsx:130-151`).
  - Không có `autoSubscribe:false` (`room-view.tsx:368-391`).
  - Tab People sort bằng `localeCompare`, không memo hay ảo hoá (`meeting-room-people-tab.tsx:38-114`).
  - Thứ tự speaker không có hysteresis, đẩy mọi tile lùi một chỗ (`conference-layout.ts:103-125`).
  - `useState(true)` cho mic và camera (`meeting-prejoin.tsx:40-41`).
  - `mute_request` broadcast cho mọi người (`use-meeting-signals.tsx:142-156`).
- Tác động: chi phí main-thread thấy rõ từ khoảng 50–80 người, nặng hơn trên 150. Mic mở trong phòng 50+ người tạo nhiễu và tăng churn event speaker.
- Cách sửa: tách leaf `StageTiles`, memo header/sidebar/control bar, đặt `updateOnlyOn` cho roster. Mặc định tắt mic khi phòng trên ~10 người, thêm mute-all, dùng h540 cho phòng lớn. Dùng LRU slot giữ chỗ 2–3s. Ảo hoá danh sách. Gửi `mute_request` kèm `destinationIdentities`. Với phòng lớn: subscribe có chọn lọc.

**G18. Chat và transcript sắp xếp ASC + LIMIT 5000, nên mất dữ liệu mới nhất; AI summary chỉ đọc phần đầu cuộc họp.** Kịch bản: B. Trạng thái: **đã xác minh**.
- Bằng chứng: `meeting_chat.sql:8`, `meeting_ai.sql:8`, `meeting_ai.go:31-32,210,220` (chat 500 dòng đầu).
- Tác động: cuộc họp dài có STT vượt 5.000 segment thì transcript đứng yên trong khi vẫn refetch 5.000 dòng mỗi lần. Summary bỏ sót phần kết luận ở cuối.
- Cách sửa: lấy N dòng mới nhất (DESC rồi đảo lại) kèm cursor. Summary dùng cửa sổ ưu tiên phần cuối hoặc map-reduce theo khoảng thời gian.

**G19. Ballot tuần tự hoá trên row motion với khoảng 8 round-trip trong lock; OpenMotion insert từng row.** Kịch bản: B. Trạng thái: **cần đo thêm**.
- Bằng chứng: `meeting_motion_votes.go:232-285` (có `GetWorkspaceByID` dư trong tx, `meeting.go:432-434`), `:76-120`.
- Tác động: khoảng 100–300 phiếu/giây cho mỗi motion. Chỉ đáng lo khi burst vượt khoảng 200/s, hoặc khi pool đã bị G2 bóp nghẹt. Mở vote cho 500 người khoá row meeting khoảng 0,5–1s.
- Cách sửa: `INSERT ... SELECT unnest`, dùng `m.OrganizationID`, đọc meeting trước khi lock, đếm khi đóng vote.

**G20. Job nhắc lịch xử lý lại mọi cuộc họp trong cửa sổ 10 phút ở mỗi tick 1 phút, và lần đầu đổ một đợt lớn vào outbox ngay trước giờ họp.** Kịch bản: A. Trạng thái: **đã xác minh** (theo critic).
- Bằng chứng: `server/internal/notification/reminder.go:17,36-88`, `consumer.go:115-157`. Query `ListMeetingsStartingBetween` quét `meetings` xuyên tenant (`notifications.sql:159-162`). Một lỗi làm dừng cả tick (`reminder.go:62-68,85-86`).
- Tác động: 200 cuộc họp × 20 người lúc 9:00 tạo khoảng 8.000 row outbox lúc 8:50, tức 2–3 phút backlog (G3) đúng trước giờ họp. Các tick sau lặp lại khoảng 17k câu lệnh mỗi phút mà không làm gì.
- Cách sửa: thêm `reminded_at` (one-shot) và partial index `(starts_at) WHERE status='SCHEDULED'`. Insert theo lô. Gặp lỗi thì bỏ qua cuộc họp đó và tiếp tục. Đưa vào lane ưu tiên thấp.

**G21. Redis chậm (nhưng chưa sập) làm mọi request chậm vài chục giây vì rate limiter không có deadline.** Kịch bản: cả hai. Trạng thái: **cần đo thêm**.
- Bằng chứng: `main.go:90-95` dùng giá trị mặc định của go-redis (ReadTimeout 5s, MaxRetries 3). `ratelimit.go:75-82` dùng `r.Context()`. Các route `/join`, chat, ballot chồng 2 limiter.
- Tác động: mỗi request có thể chờ khoảng 20–40s trước khi fail-open, ảnh hưởng mọi tenant và cả webhook.
- Cách sửa: dùng client riêng cho limiter với timeout 50–100ms và `MaxRetries=0`. Thêm circuit breaker. Gộp hai limiter vào một lần EVAL.

**G22. Load test không đo đúng câu hỏi đang được hỏi.** Kịch bản: cả hai. Trạng thái: **đã xác minh**.
- Bằng chứng: `scripts/load/meeting-join.k6.js:5-17,44` dùng 1 token, 1 meeting, 1 IP, 100 VU. Khi có Redis, khoảng 98% request bị 429. `meeting-lobby-wait.k6.js:9,31-42` coi mọi phản hồi không phải 5xx là đạt. `.github/workflows/perf-nightly.yml:86-98` không chạy hai script meeting này. Không có script WS, webhook, nhiều phòng hay LiveKit.
- Cách sửa: xem mục 6.

**G23. AI summary đồng bộ, không giới hạn đồng thời, không single-flight, không retry.** Kịch bản: A. Trạng thái: **đã xác minh**.
- Bằng chứng: `meeting_ai.go:187-292`, `ai/gateway.go:107-180`.
- Tác động: lỗi 502 hàng loạt khi chạm TPM vào giờ chẵn. Phạm vi ảnh hưởng gói gọn trong tính năng summary.
- Cách sửa: chuyển thành job bất đồng bộ với unique partial index, thêm semaphore và backoff.

**G24. Readiness kiểm tra cả Redis và S3 trên pod duy nhất.** Trạng thái: **đã xác minh**.
- Bằng chứng: `service/readiness.go:87-100`.
- Tác động: S3 hoặc Redis chập chờn khoảng 15s là pod NotReady, kéo theo 5xx cho mọi cuộc họp.
- Lưu ý: CLAUDE.md chủ ý giữ Redis trong `/readyz`, nên muốn đổi cần một ADR. Có ≥2 replica thì tác động giảm.

### Thấp hoặc cần đo

- **Recording**: kiểm tra rồi mới tạo (check-then-act), không có unique index; Egress không timeout; vòng auto-end chạy trên root ctx (`meeting_ai.go:450-452,864-911`, `livekit.go:238,256-258`). Hiện chưa có tải vì `LIVEKIT_RECORDING_BUCKET` rỗng. Phải nâng lên mức medium trước khi bật recording.
- **Deploy cắt mọi WS cùng lúc.** Lần reconnect đầu dồn vào 0,8–1,2s (`ws-client.ts:196-212`), không có preStop. Socket bị dựng lại mỗi lần xoay token 15 phút và có thể mất event trong khe hở đó (RT-8, DEP-2). **Cần đo thêm.**
- **Tracing 100% không có exporter.** Mọi request, SQL và lệnh Redis tạo span rồi bỏ đi (`telemetry/tracer.go:59-86`, `uniwork-be.env:98-99`). Tốn vài phần trăm CPU trên pod đang bị throttle.
- **Danh sách meetings sort bằng biểu thức CASE và chạy thêm `count(*)`**, chi phí O(toàn bộ lịch sử workspace) cho mỗi lần refetch (`meetings.sql:16-55`).
- **FE là 1 pod Next 500m, không có CDN** (`values.yaml:52-64`). Gây đứng ở lần tải đầu khi khách đổ vào cùng lúc.
- **TTL token không thống nhất**: `.env.example:204` là 2m, trong khi config và deploy là 30m. Refresh không có jitter.
- **POST `/join` ẩn danh insert `meeting_guests` trước khi validate** (`meeting_guest.go:29`).
- **Hub dùng một RWMutex toàn cục** (RT-7). Không phải nút thắt dưới khoảng 5k socket mỗi pod.
- **DualWrite loopback** đọc lại event của chính node (RT-5). Không lặp lại phần ghi WS.
- **STT agent mới là stub** (`deploy/meeting-stt-agent/agent.py:59-86`). Secret được so sánh bằng `!=` (`handler/meeting_ai.go:76`).

## 5. Đối chiếu `docs/meeting-scale-upgrade-plan.md` với code

Tài liệu ghi "**P4 + P5 ✅, P6 chưa làm**" (dòng 11, 37-39).

**Đúng với code:**
- 4.1: Join chỉ đọc, không gọi provider (`meeting_admission.go:52-83`). Việc vẫn giữ "sync best-effort sau Start/Instant" là có chủ ý, và đó chính là nguồn ensure ×2 (G16).
- 4.2: `conference.session_ready` được publish và nằm trong `LOBBY_JOIN_WS_EVENTS`.
- 4.3: lobby-ws theo scope meeting đã có (`meeting_lobby_ws.go`, `publisher.go`).
- 4.4: jitter 0–3s đã có (`room-connection.ts:15-20`).
- 4.5: `joinLimit` 120 và `lobbyWSLimit` 30 đã có (`router.go:71-73`).
- 5.1: migration 034 đã có.
- 5.2: reconcile có enqueue `provider.ensure_session` (`meeting_reconcile.go:30-33`).
- 5.3: giá trị mặc định 1s/50/50/8 khớp (`config.go:144-147`, `uniwork-be.env:54-57`), semaphore cho webhook đã có.

**Không đúng, hoặc đúng nhưng chưa đủ:**
- **Danh sách event lobby**: tài liệu liệt kê 5 event, code mirror 19 event, gồm cả chat, motion và recording (`publisher.go:13-33`).
- **Jitter ở 4.4 không giải quyết herd**: không gộp timer, không lọc theo `join_request_id`, nên lobby vẫn O(N²) (G6). Mục tiêu "500 guest waiters, không 429" không thể đạt với rate limit theo IP+path (G4).
- **Rate limit ở 4.5** vẫn key theo IP+path. Vấn đề NAT mà tài liệu nêu chỉ được nới, chưa được giải (G4). Webhook LiveKit hoàn toàn không được tính đến (G1).
- **5.2 ghi "max 1 ensure/meeting/5 phút, không duplicate"**: không có dedupe nào ngoài chu kỳ 5 phút. Query lọc theo `session.status`, không theo `provider_sync_status` (`meeting_control.sql:441-453`), nên vẫn enqueue lại các session mà join path đã đánh dấu.
- **5.3 nâng throughput lên mức nào**: chỉ đổi tham số. Outbox vẫn một batch mỗi tick và tuần tự, không timeout, nên trần thực tế khoảng 50 row/s cho mọi domain, và còn thấp hơn khi consumer chậm (G3).
- **Acceptance 4.1 "EnsureSession ≤ 1 lần/meeting"** sai: thực tế là 2 lần cho mỗi Start/instant.
- **Mục 7 (Observability)**: các metric `uniwork_meeting_join_duration_seconds`, `uniwork_meeting_lobby_ws_connections`, `uniwork_meeting_join_429_total`, `uniwork_meeting_ensure_session_calls_total` **không tồn tại** (grep `server/` không ra kết quả). Production cũng không bật metrics (G9).
- **Feature flag** `MEETING_JOIN_SYNC_ENSURE` và `MEETING_LOBBY_WS_ENABLED` **không tồn tại** trong `server/`, `.env.example` hay `deploy/`.
- **Mục 6 (Load test)**: các script `meeting-burst-join`, `meeting-guest-lobby`, `meeting-provider-wait`, `meeting-webhook-storm` **không có**. Checklist có ghi nhận đúng là chưa làm. Script hiện có đo sai profile (G22).
- **SLO ở mục 1** (join p95 < 150ms, outbox lag p99 < 5s, webhook lag < 10s) **chưa được đo** trên production và không có bằng chứng benchmark nào.
- **5.4** (tối ưu join path) chưa làm. Join hiện tốn 5–7 round-trip, `Auth.Me` cộng presign avatar, và `verifyInviteLink` chạy 2 lần (`handler/meeting_control.go:304-308`, `meeting_admission.go:110,237`).
- **P6 "chưa làm" chỉ đúng một phần**: `attendance.updated` và `attendance.marked` đã có (`packages/core/types/events.ts:102,105`), `conference-layout.ts:98-125` đã có speaker promotion (nhưng thiếu hysteresis), danh sách meetings đã clamp 50. Chat và transcript vẫn chưa phân trang. Partition chưa làm.
- **Phần "Rủi ro"** mới chỉ nêu "alert outbox lag" làm biện pháp giảm thiểu. Nó không lường tới việc provider call không timeout làm treo dispatcher, cũng như rate limit chặn webhook.

## 6. Lộ trình đề xuất

### Ngay (P0, khoảng 1 tuần, thay đổi nhỏ, gỡ các nút thắt có thể làm sập hệ thống)
1. Miễn route webhook LiveKit khỏi global limiter và thêm alert 429 cho nó (G1).
2. Thêm `context.WithTimeout` (~5s) cho mọi lời gọi LiveKit và Egress, `http.Client` có Timeout cho lksdk, timeout cho từng consumer trong `Dispatcher.deliver`. Chuyển `ChatVoiceSummaryConsumer` ra khỏi dispatcher (G3).
3. Sửa `evaluateInviteLink`: đọc trước khi `Begin`, không dùng `s.q` trong lúc đang giữ tx. Đặt `pool_max_conns`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` và timeout cho mỗi request (G2).
4. Lặp `Process` khi batch đầy và đưa tick về 500ms (G3).
5. Lobby: lọc theo `join_request_id`, gộp về một timer, coi 429/503 là retryable. `ensureJoinRequest` chỉ `record` khi insert mới (G6).
6. Rate limit cho route trong phòng key theo user/guest. Áp cách xử lý của `/motions` cho GET `/participants`, `/chat`, `/recordings` (G4).
7. Bật `METRICS_ADDR` và scrape, nạp `alerts.yml` (G9). Limiter Redis dùng timeout 100ms, không retry (G21).
8. Bỏ ensure đồng bộ trong Start/instant hoặc chặn ghi đè trạng thái khi session đã SYNCED (G16).

### Ngắn hạn (2–6 tuần)
- Chia outbox thành lane (realtime / provider / notification / AI) với worker pool riêng và giữ thứ tự theo meeting. `join_request.approved` đi lane ưu tiên. Mark done theo lô.
- Scope meeting cho member và chuyển các topic trong phòng sang đó. Thiết kế lại presence (Redis cộng publish khi chuyển trạng thái) (G8).
- Chat và transcript dùng cursor, sort DESC, append delta. Gom tally motion, tải voter khi cần, tách `my_ballot`. Lobby khách dùng scheduler (G7, G18).
- Thêm index `CONCURRENTLY` cho G13. Job retention và partial index cho outbox/inbox. Viết lại lag collector (G12, G9).
- Metering theo lô, bất đồng bộ. Webhook at-least-once (dedupe cùng transaction, trả lỗi thật). Dùng `occurred_at` (G14, G15).
- Reminder one-shot (G20). Relay: `XGROUP SETID` khi room chuyển 0→1, bỏ qua loopback theo NodeID (G10).
- Client: tách `StageTiles` và memo, mặc định tắt mic cho phòng lớn, mute-all, đặt `MaxParticipants` theo entitlement (G17, G11).
- Tracing: dùng `NeverSample` khi không có exporter. Thêm CDN hoặc proxy-cache cho `/_next/static`, FE ≥2 replica.

### Dài hạn (1–3 tháng)
- Hoàn tất mục 3 của ADR 0025 (leader lock), rồi BE ≥2 replica + HPA/PDB, tách `SERVER_ROLE=api|worker`, limit 1–2 CPU (G5).
- Nối `ShardedStreamRelay` và `MirroredRelay`, bỏ relay theo từng scope (G10).
- Cluster LiveKit riêng cho UniWork (multi-node, egress pool riêng, entitlement `concurrent_rooms` và `concurrent_recordings`) (G11, recording).
- Subscribe có chọn lọc (`autoSubscribe:false` khi phòng vượt ngưỡng), ảo hoá roster, LRU speaker slot. Partition hoặc archive các bảng sự kiện khi khối lượng lớn.

### Load test cần bổ sung để chứng minh năng lực (đưa vào `perf-nightly.yml`)
1. **`meeting-concurrent-rooms.k6.js`**: seed N user × M meeting. Với N = 20, 50, 100 phòng × 20 người, start trong cùng 10 giây. Mỗi VU dùng IP khác nhau qua XFF từ proxy tin cậy. Đo `/join` p95, thời gian từ start đến ADMIT, outbox lag, `uniwork_db_pool_acquired_conns`. Ngưỡng đạt: p95 < 300ms, lag < 5s, 0 lỗi 5xx.
2. **`meeting-knock-approve.k6.js`**: W = 50, 100, 200 người chờ duyệt, host bấm admit-all. Đếm số POST `/join`, số row audit và outbox, thời gian đến khi người cuối được vào. Mục tiêu tuyến tính, không phải W².
3. **`meeting-invite-burst.k6.js`**: 50–100 khách mở cùng một invite link trong 1 giây, thêm một vòng refresh token đồng loạt. Phát hiện deadlock pool (G2).
4. **`meeting-webhook-storm.k6.js`**: POST webhook có chữ ký từ một IP, 200 participant × 6 event trong 60s. Kiểm tra không có 429, inbox lag < 10s, attendance đầy đủ.
5. **`meeting-inroom-chat-vote.k6.js`**: phòng 200 VU, chạy hai biến thể "cùng một IP" và "nhiều IP". Chat 1 tin/giây, 200 phiếu trong 5 giây. Đo tỉ lệ 429, RPS GET `/chat` và `/motions`, DB QPS.
6. **`meeting-ws-fanout.k6.js`** (k6/ws): 1.000 socket workspace và 500 socket lobby, chạy 20 phòng song song. Đo latency frame, `slow_evictions_total`, `redis_xread_errors_total`, CPU pod.
7. **Fault injection**: dùng toxiproxy thêm 5s latency hoặc black-hole cho LiveKit API, Redis và LLM. Kiểm tra realtime của tenant khác không bị treo.
8. **Media**: `lk load-test` với 1 phòng × 100 publisher, và 20 phòng × 10 người. Kết hợp Playwright trace (long task, FPS, heap) ở client 100 người.

Mọi script phải chạy với `LIVEKIT_TOKEN_TTL=30m`, giống production.
## 7. Trạng thái xử lý

Cập nhật 2026-10-05. Số dòng ở các mục trên vẫn là của `952010c4`; code đã đổi theo hai đợt dưới đây.

### UNI-935 (P0): đã xử lý

G1 (webhook bị rate limit), G2 (invite-link giữ hai connection, pool chưa đặt kích thước), G3 phần timeout và drain, G4 (rate limit theo user/guest thay cho IP), G6 (lobby herd, ghi audit lặp), G16 (ensure hạ cấp session READY), G21 (limiter Redis không có deadline).

### UNI-936 (P1): đã xử lý

| Gap | Đã làm | Còn lại |
| --- | --- | --- |
| G3 | Outbox chia năm lane (realtime, notify, provider, push, slow); các consumer của một dòng chạy song song; đánh dấu xong theo lô | Topic vừa realtime vừa notification đi lane `notify`; chưa có trạng thái giao theo từng consumer |
| G7, G18 | Chat và transcript phân trang theo cursor, client chỉ đọc phần mới; danh sách motion không còn voter và `my_ballot`; `motion.ballot_cast` refetch tối đa 1 lần/giây; tóm tắt AI ưu tiên phần cuối cuộc họp | Mỗi frame vẫn kéo theo một GET nhỏ (bỏ hẳn cần ADR giống ADR 0015); cuộc họp > 2000 đoạn transcript chưa có map-reduce |
| G8 | Event trong phòng chuyển sang scope meeting, socket member xin vào qua `AuthorizeMeetingScope`; presence lưu ở Redis, chỉ phát khi đổi trạng thái, limiter theo user | Tab mở từ trước khi deploy không nhận event trong phòng cho tới khi tải lại |
| G9 | Bật `METRICS_ADDR`; alert mới cho webhook inbox, 429, eviction, lỗi XREAD, lag không đọc được; tracing không ghi span khi không có exporter | Ops cần đặt `networkPolicy.metricsScrapeNamespace` và nạp `deploy/alerts.yml` vào Prometheus của cụm |
| G10 | Relay đặt lại consumer group khi scope đi từ 0 lên 1, bỏ qua envelope của chính node, key có TTL | Chưa nối `ShardedStreamRelay` (dài hạn) |
| G12, G13 | Job retention theo lô; index `CONCURRENTLY` cho các query nóng; lag collector có timeout và báo lỗi bằng metric `*_lag_up` | Cửa sổ retention đang cố định trong code (7/30/14 ngày) |
| G14, G15 | Webhook at-least-once (ghi dedupe cùng transaction, trả lỗi thật), dùng `occurred_at`; metering theo lô ngoài request; reconcile chạy goroutine riêng; worker được chờ khi shutdown | Một tổ chức lỗi metering chặn cả lô; `recording_ended` vẫn nuốt lỗi |
| G17 | Tách `StageTiles`, `updateOnlyOn`, People tab có memo và windowing, giữ chỗ speaker; mic mặc định tắt khi phòng đông; `mute_request` gửi đúng người; host có "tắt mic mọi người" | Subscribe chọn lọc (`autoSubscribe:false`) chưa làm |
| G19 | Đọc trước khi khoá motion, bỏ lần đọc workspace dư, insert danh sách cử tri một câu lệnh | Đếm phiếu khi đóng (phiếu kín không lưu lựa chọn nên chưa bỏ được bộ đếm) |
| G20 | Nhắc lịch one-shot qua bảng `meeting_reminders`, lỗi một cuộc họp không dừng cả lượt | Đổi giờ họp sau khi đã nhắc thì không nhắc lại |

Chưa làm (cần quyết định hạ tầng hoặc sản phẩm): CDN cho `/_next/static`, `MaxParticipants` theo gói, cluster LiveKit riêng, scale ngang BE (ADR 0025), load test k6 ở mục 6.
