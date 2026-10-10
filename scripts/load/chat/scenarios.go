package main

import (
	"bytes"
	"fmt"
	"math/rand/v2"
	"mime/multipart"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const mib = 1 << 20

// arrivals records when each socket first saw each message id.
type arrivals struct {
	mu sync.Mutex
	at []struct {
		id string
		t  time.Time
	}
}

func (a *arrivals) add(id string) {
	a.mu.Lock()
	a.at = append(a.at, struct {
		id string
		t  time.Time
	}{id, time.Now()})
	a.mu.Unlock()
}

// latency joins arrivals with the send start of each message.
func (a *arrivals) latency(msgs []sent) (*samples, int) {
	start := make(map[string]time.Time, len(msgs))
	for _, m := range msgs {
		start[m.id] = m.start
	}
	s := &samples{}
	a.mu.Lock()
	defer a.mu.Unlock()
	matched := 0
	for _, x := range a.at {
		if t, ok := start[x.id]; ok {
			s.add(x.t.Sub(t))
			matched++
		}
	}
	return s, matched
}

// openSockets dials one reading socket per user, subscribed to room.
func (e *env) openSockets(users []*vu, room string, onFrame func(u *vu, f frame)) []*sock {
	socks := make([]*sock, len(users))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 32)
	for i, u := range users {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer func() { <-sem; wg.Done() }()
			s, err := e.dial(u, 25*time.Second, 0, func(f frame) { onFrame(u, f) })
			if err != nil {
				fatal("dial user%d: %v", u.i, err)
			}
			if err := s.subscribe(room); err != nil || !s.settled(1, 30*time.Second) || s.refused.Load() > 0 {
				fatal("subscribe user%d to %s refused", u.i, room)
			}
			socks[i] = s
		}()
	}
	wg.Wait()
	return socks
}

func closeAll(socks []*sock) {
	for _, s := range socks {
		if s != nil {
			s.close()
		}
	}
}

// (1) Fan-out by room size, no client simulation, 1 message/s (§3.2 A).
func scenarioFanout(e *env, r *result) {
	var cpu []float64
	for _, size := range e.fanout {
		us := e.need(size)
		room := e.channel(us[0], "fanout", us[1:])
		got := &arrivals{}
		socks := e.openSockets(us, room, func(_ *vu, f frame) {
			if f.Type == "chat.message.created" && f.str("room_id") == room {
				got.add(f.str("message_id"))
			}
		})
		_, idleCPU := e.idle(3 * time.Second)
		before := e.scrape()
		post := &samples{}
		msgs, failed := e.sendLoop(us[:1], room, 1, e.dur, post)
		time.Sleep(3 * time.Second)
		after := e.scrape()
		closeAll(socks)
		lat, frames := got.latency(msgs)
		perMsg := 1000 * (after.cpu - before.cpu - idleCPU*after.at.Sub(before.at).Seconds()) / float64(max(1, len(msgs)))
		cpu = append(cpu, perMsg)
		r.Metrics[fmt.Sprintf("room_%d", size)] = map[string]any{
			"sockets": size, "messages": len(msgs), "post_p50_ms": post.pct(.5), "post_p95_ms": post.pct(.95),
			"frame_p50_ms": lat.pct(.5), "frame_p95_ms": lat.pct(.95), "cpu_ms_per_message": round(perMsg),
		}
		r.atMost(fmt.Sprintf("room %d: POST p95 ms", size), post.pct(.95), 300)
		r.atMost(fmt.Sprintf("room %d: failed sends", size), float64(failed), 0)
		r.atMost(fmt.Sprintf("room %d: frames missed", size), float64(len(msgs)*size-frames), 0)
	}
	if len(cpu) > 1 && cpu[0] > 0 {
		// "CPU per message does not grow with members": allow 2x for noise.
		r.atMost("cpu per message, largest / smallest room", cpu[len(cpu)-1]/cpu[0], 2)
	}
}

// (2) Default channel with N people looking at it, client simulation on,
// 1 message/s (§3.2 B). Each viewer does what the web client does on a
// frame: GET the message by id after 250 ms + jitter
// (chat-realtime-patch-scheduler.ts) and refetch the sidebar, coalesced,
// on chat.room.activity.
func scenarioChannel(e *env, r *result) {
	us := e.need(e.channelUsers + 1)
	room, viewers := e.room0, us[1:]
	shown, getFails := &arrivals{}, atomic.Int64{}
	var pending sync.Map
	socks := e.openSockets(viewers, room, func(u *vu, f frame) {
		switch {
		case f.Type == "chat.message.created" && f.str("room_id") == room:
			id := f.str("message_id")
			time.AfterFunc(jitter(250*time.Millisecond, 250*time.Millisecond), func() {
				if st, _ := e.call(u, "GET", e.ws("/chat/rooms/"+room+"/messages/"+id), nil, nil); ok(st) {
					shown.add(id)
				} else {
					getFails.Add(1)
				}
			})
		case f.Type == "chat.room.activity":
			if _, busy := pending.LoadOrStore(u.i, true); !busy {
				time.AfterFunc(jitter(250*time.Millisecond, 250*time.Millisecond), func() {
					defer pending.Delete(u.i)
					if st, _ := e.call(u, "GET", e.ws("/chat/rooms"), nil, nil); !ok(st) {
						getFails.Add(1)
					}
				})
			}
		}
	})
	idleStmts, _ := e.idle(3 * time.Second)
	before := e.scrape()
	post := &samples{}
	msgs, failed := e.sendLoop(us[:1], room, 1, e.dur, post)
	time.Sleep(3 * time.Second)
	after := e.scrape()
	closeAll(socks)
	lat, _ := shown.latency(msgs)
	stmts := after.stmts - before.stmts - idleStmts*after.at.Sub(before.at).Seconds()
	perRecipient := stmts / float64(max(1, len(msgs)*len(viewers)))
	r.Metrics["viewers"] = len(viewers)
	r.Metrics["messages"] = len(msgs)
	r.Metrics["post_p95_ms"] = post.pct(.95)
	r.Metrics["shown_p50_ms"] = lat.pct(.5)
	r.Metrics["statements_per_message"] = round(stmts / float64(max(1, len(msgs))))
	r.atMost("message shown p95 ms", lat.pct(.95), 1000)
	r.atMost("messages never shown", float64(len(msgs)*len(viewers)-lat.n()), 0)
	r.atMost("statements per message per recipient", perRecipient, 5)
	r.atMost("db pool waits", after.waits-before.waits, 0)
	r.atMost("failed sends + client GETs", float64(failed)+float64(getFails.Load()), 0)
}

// (4) Sidebar for a person in every seeded group (§3.2 E).
func scenarioSidebar(e *env, r *result) {
	u := e.need(1)[0]
	var body roomsBody
	e.call(u, "GET", e.ws("/chat/rooms"), nil, &body) // warm-up, and the room count
	idleStmts, _ := e.idle(3 * time.Second)
	before := e.scrape()
	lat, fails, calls := &samples{}, 0, 20
	for range calls {
		st, took := e.call(u, "GET", e.ws("/chat/rooms"), nil, nil)
		if !ok(st) {
			fails++
		}
		lat.add(took)
	}
	after := e.scrape()
	stmts := (after.stmts - before.stmts - idleStmts*after.at.Sub(before.at).Seconds()) / float64(calls)
	r.Metrics["rooms"] = len(body.Rooms)
	r.Metrics["p50_ms"] = lat.pct(.5)
	r.atMost("GET /chat/rooms p95 ms", lat.pct(.95), 300)
	r.atMost("statements per GET /chat/rooms", stmts, 10)
	r.atMost("failed calls", float64(fails), 0)
}

// (6) Morning burst: N people open the chat page within -duration (§3.2 G).
// Each runs the page-load chain, then connects and lazily subscribes up to 25
// rooms from its sidebar, and stays connected until the burst ends.
func scenarioBurst(e *env, r *result) {
	us := e.need(e.burstUsers + 1)[1:] // user0's 300-room sidebar is scenario sidebar's
	stop := make(chan struct{})
	maxRSS, healthFails, watched := e.watch(stop)
	ready := &samples{}
	var reqFails, subFails, dialFails atomic.Int64
	var mu sync.Mutex
	var socks []*sock
	var wg sync.WaitGroup
	for _, u := range us {
		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(time.Duration(rand.Int64N(int64(e.dur))))
			t0 := time.Now()
			var rooms roomsBody
			for _, step := range []struct {
				method, path string
				out          any
			}{
				{"GET", "/chat/rooms", &rooms},
				{"GET", "/chat/room", nil},
				{"POST", "/chat/room", nil},
				{"GET", "/chat/rooms/" + e.room0 + "/messages?limit=50", nil},
			} {
				if st, _ := e.call(u, step.method, e.ws(step.path), nil, step.out); !ok(st) {
					reqFails.Add(1)
				}
			}
			s, err := e.dial(u, 25*time.Second, 0, func(frame) {})
			if err != nil {
				dialFails.Add(1)
				return
			}
			mu.Lock()
			socks = append(socks, s)
			mu.Unlock()
			// The client subscribes lazily, at most 25 rooms.
			subs := []string{e.room0}
			for _, room := range rooms.Rooms {
				if len(subs) < 25 && room.ID != e.room0 {
					subs = append(subs, room.ID)
				}
			}
			for _, room := range subs {
				_ = s.subscribe(room)
			}
			if !s.settled(len(subs), 60*time.Second) {
				subFails.Add(1)
			}
			subFails.Add(s.refused.Load())
			ready.add(time.Since(t0))
		}()
	}
	wg.Wait()
	close(stop)
	<-watched
	closeAll(socks)
	r.Metrics["people"] = len(us)
	r.Metrics["ready_p50_ms"] = ready.pct(.5)
	r.Metrics["ready_p95_ms"] = ready.pct(.95)
	r.Metrics["max_rss_mib"] = maxRSS.Load() / mib
	r.atMost("slowest client ready ms", ready.pct(1), 10_000)
	r.atMost("subscriptions failed", float64(subFails.Load()), 0)
	r.atMost("page-load requests failed + sockets not opened", float64(reqFails.Load()+dialFails.Load()), 0)
	r.atMost("max RSS MiB", float64(maxRSS.Load())/mib, 400)
	r.atMost("healthz failures", float64(healthFails.Load()), 0)
}

type roomsBody struct {
	Rooms []struct {
		ID string `json:"id"`
	} `json:"rooms"`
}

// (9) Correctness (§3.2 J): a room taking 7 messages/s, paged back with the
// web client's cursor, must show every message; 200 concurrent votes on one
// poll must all count.
func scenarioCorrectness(e *env, r *result) {
	us := e.need(max(8, e.votes+1))
	senders := us[1:8] // 1 message/s each stays inside the per-user write budget
	room := e.channel(us[0], "paging", senders)
	msgs, failed := e.sendLoop(senders, room, 7, e.dur, nil)
	seen, pages := map[string]int{}, 0
	before := ""
	for pages < 10_000 {
		var page struct {
			Messages []struct {
				ID        string `json:"id"`
				CreatedAt string `json:"created_at"`
			} `json:"messages"`
		}
		path := "/chat/rooms/" + room + "/messages?limit=50"
		if before != "" {
			path += "&before=" + before
		}
		if st, _ := e.call(us[0], "GET", e.ws(path), nil, &page); !ok(st) {
			fatal("page %d: %d", pages, st)
		}
		pages++
		oldest := ""
		for _, m := range page.Messages {
			seen[m.ID]++
			if oldest == "" || m.CreatedAt < oldest {
				oldest = m.CreatedAt
			}
		}
		next := clientCursor(oldest)
		if len(page.Messages) < 50 || next == "" || next == before {
			break
		}
		before = next
	}
	missed, dup := 0, 0
	for _, m := range msgs {
		if seen[m.id] == 0 {
			missed++
		}
	}
	for _, n := range seen {
		dup += n - 1
	}
	r.Metrics["messages_sent"] = len(msgs)
	r.Metrics["pages"] = pages
	r.atMost("messages missed paging back", float64(missed), 0)
	r.atMost("messages shown twice", float64(dup), 0)
	r.atMost("failed sends", float64(failed), 0)

	voters := us[1 : e.votes+1]
	pollRoom := e.channel(us[0], "votes", voters)
	var poll struct {
		Message struct {
			ID   string `json:"id"`
			Poll struct {
				Options []struct {
					ID    string `json:"id"`
					Votes int    `json:"votes"`
				} `json:"options"`
			} `json:"poll"`
		} `json:"message"`
	}
	st, _ := e.call(us[0], "POST", e.ws("/chat/rooms/"+pollRoom+"/messages"), map[string]any{
		"poll": map[string]any{"question": "load", "options": []string{"A", "B"}},
	}, &poll)
	if !ok(st) || len(poll.Message.Poll.Options) < 2 {
		fatal("create poll: %d", st)
	}
	votePath := e.ws("/chat/rooms/" + pollRoom + "/messages/" + poll.Message.ID + "/poll/vote")
	gate := make(chan struct{})
	var wg sync.WaitGroup
	var accepted, refused atomic.Int64
	statuses := &tally{}
	for i, v := range voters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-gate
			st, _ := e.call(v, "POST", votePath, map[string]string{"option_id": poll.Message.Poll.Options[i%2].ID}, nil)
			statuses.add(st)
			if ok(st) {
				accepted.Add(1)
			} else {
				refused.Add(1)
			}
		}()
	}
	close(gate)
	wg.Wait()
	e.call(us[0], "GET", e.ws("/chat/rooms/"+pollRoom+"/messages/"+poll.Message.ID), nil, &poll)
	counted := 0
	for _, o := range poll.Message.Poll.Options {
		counted += o.Votes
	}
	r.Metrics["votes_accepted"] = accepted.Load()
	r.Metrics["votes_counted"] = counted
	r.Metrics["vote_statuses"] = statuses.by
	r.atMost("votes lost", float64(accepted.Load()-int64(counted)), 0)
	r.atMost("votes refused", float64(refused.Load()), 0)
}

// clientCursor is what native-chat-message-panel.tsx sends as `before`:
// new Date(oldest.ts).toISOString(), i.e. UTC truncated to milliseconds.
func clientCursor(createdAt string) string {
	t, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return ""
	}
	return t.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

// (10) Abuse (§8.10, C1/C6/C7): sockets that stop reading but keep pinging
// while their room is flooded, a 1 MiB poll, and five ~25 MiB uploads at
// once. The process must stay up, under the RSS limit, and keep delivering
// to a socket that does read.
func scenarioAbuse(e *env, r *result) {
	const senderN = 20
	us := e.need(2 + e.abusers + senderN)
	observer, abusers, senders := us[1], us[2:2+e.abusers], us[2+e.abusers:]
	room := e.channel(us[0], "abuse", us[1:])
	stop := make(chan struct{})
	maxRSS, healthFails, watched := e.watch(stop)
	before := e.scrape()

	got := &arrivals{}
	obs := e.openSockets([]*vu{observer}, room, func(_ *vu, f frame) {
		if f.Type == "chat.message.created" && f.str("room_id") == room {
			got.add(f.str("message_id"))
		}
	})
	var bad []*sock
	for _, u := range abusers {
		// Pings every second, never reads, 4 KiB receive buffer.
		s, err := e.dial(u, time.Second, 4096, nil)
		if err != nil {
			fatal("dial abuser user%d: %v", u.i, err)
		}
		_ = s.subscribe(room)
		bad = append(bad, s)
	}
	// 1.5 messages/s per sender stays inside the per-user write budget.
	msgs, failed := e.sendLoop(senders, room, 1.5*senderN, e.dur, nil)

	options := make([]string, 1024)
	for i := range options {
		options[i] = strings.Repeat("x", 1023)
	}
	pollStatus, _ := e.call(us[0], "POST", e.ws("/chat/rooms/"+room+"/messages"), map[string]any{
		"poll": map[string]any{"question": "1 MiB", "options": options},
	}, nil)

	var wg sync.WaitGroup
	var upload5xx atomic.Int64
	uploads := &tally{}
	for i := range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var buf bytes.Buffer
			mw := multipart.NewWriter(&buf)
			fw, _ := mw.CreateFormFile("file", fmt.Sprintf("load-%d.txt", i))
			_, _ = fw.Write(bytes.Repeat([]byte("load test upload\n"), 24*mib/17))
			_ = mw.Close()
			st, _ := e.call(senders[i], "POST", e.ws("/chat/rooms/"+room+"/messages/file"), &multipartBody{&buf, mw.FormDataContentType()}, nil)
			uploads.add(st)
			if st == 0 || st >= 500 {
				upload5xx.Add(1)
			}
		}()
	}
	wg.Wait()
	time.Sleep(3 * time.Second)
	close(stop)
	<-watched
	closeAll(append(obs, bad...))
	_, frames := got.latency(msgs)
	r.Metrics["messages"] = len(msgs)
	r.Metrics["poll_1mib_status"] = pollStatus
	r.Metrics["upload_statuses"] = uploads.by
	// 0 means the kernel buffers absorbed the flood and the slow-socket
	// eviction path (C1) was not reached on this host.
	r.Metrics["slow_sockets_evicted"] = e.scrape().evictions - before.evictions
	r.Metrics["max_rss_mib"] = maxRSS.Load() / mib
	r.atMost("healthz failures (process down)", float64(healthFails.Load()), 0)
	r.atMost("frames missed by the reading socket", float64(len(msgs)-frames), 0)
	r.atMost("failed sends", float64(failed), 0)
	r.atMost("1 MiB poll accepted (1 = yes)", b2f(ok(pollStatus)), 0)
	r.atMost("uploads answered 5xx or dropped", float64(upload5xx.Load()), 0)
	r.atMost("max RSS MiB", float64(maxRSS.Load())/mib, 400)
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
