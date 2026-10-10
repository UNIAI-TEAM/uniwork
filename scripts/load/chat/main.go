// chat-load drives the chat API and WebSocket the way the web client does
// (docs/chat-assessment.md §3.1) and checks the §8 thresholds. It prints a
// JSON summary and exits 1 when a checked threshold fails, 2 when it cannot
// run at all.
//
// Dataset: one organization from server/cmd/seed (user<N>@perf.local /
// password123, everyone in the default channel, user0 in every seeded group):
//
//	go run ./cmd/seed --orgs 1 --users 1200 --tasks 1000 --chat-groups 300
//
// The server needs TRUSTED_PROXIES covering this host: every virtual user
// sends its own X-Forwarded-For, otherwise the run measures 429s.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type env struct {
	base, metricsURL string
	hc               *http.Client
	dur              time.Duration
	fanout           []int
	channelUsers     int
	burstUsers       int
	votes            int
	abusers          int

	mu          sync.Mutex
	users       []*vu
	loggedAt    time.Time
	shed        atomic.Int64 // 503s retried after Retry-After
	wsID, room0 string       // the workspace and its default channel
}

type vu struct {
	i         int
	id, token string
	ip        string
}

func main() {
	e := &env{hc: &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{MaxIdleConnsPerHost: 512}}}
	scenarios := flag.String("scenarios", "fanout,channel,sidebar,burst,correctness,abuse", "comma-separated scenarios to run")
	reportOnly := flag.String("report-only", "", "scenarios whose failed checks are reported but do not fail the run")
	fanout := flag.String("fanout", "200,1000", "channel sizes for the fan-out scenario")
	out := flag.String("out", "", "also write the JSON summary to this file")
	flag.StringVar(&e.base, "base", "http://localhost:8080", "API origin")
	flag.StringVar(&e.metricsURL, "metrics", "http://127.0.0.1:9090/metrics", "the server's METRICS_ADDR /metrics")
	flag.DurationVar(&e.dur, "duration", 60*time.Second, "send phase of each scenario")
	flag.IntVar(&e.channelUsers, "channel-users", 200, "people with the default channel open (scenario channel)")
	flag.IntVar(&e.burstUsers, "burst-users", 300, "people opening chat within -duration (scenario burst)")
	flag.IntVar(&e.votes, "votes", 200, "concurrent poll votes (scenario correctness)")
	flag.IntVar(&e.abusers, "abusers", 20, "sockets that stop reading but keep pinging (scenario abuse)")
	flag.Parse()
	for _, s := range strings.Split(*fanout, ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && n > 1 {
			e.fanout = append(e.fanout, n)
		}
	}
	raiseFileLimit()

	all := map[string]func(*env, *result){
		"fanout": scenarioFanout, "channel": scenarioChannel, "sidebar": scenarioSidebar,
		"burst": scenarioBurst, "correctness": scenarioCorrectness, "abuse": scenarioAbuse,
	}
	soft := strings.Split(*reportOnly, ",")
	summary := struct {
		OK        bool      `json:"ok"`
		Base      string    `json:"base"`
		Scenarios []*result `json:"scenarios"`
	}{OK: true, Base: e.base}
	for _, name := range strings.Split(*scenarios, ",") {
		run, ok := all[strings.TrimSpace(name)]
		if !ok {
			fatal("unknown scenario %q", name)
		}
		r := &result{Name: name, ReportOnly: slices.Contains(soft, name), Metrics: map[string]any{}}
		fmt.Fprintf(os.Stderr, "== %s\n", name)
		start, shed := time.Now(), e.shed.Load()
		run(e, r)
		r.Seconds = time.Since(start).Seconds()
		r.Metrics["shed_503_retried"] = e.shed.Load() - shed
		r.OK = true
		for _, c := range r.Checks {
			r.OK = r.OK && c.OK
		}
		if !r.OK && !r.ReportOnly {
			summary.OK = false
		}
		summary.Scenarios = append(summary.Scenarios, r)
	}
	b, _ := json.MarshalIndent(summary, "", "  ")
	fmt.Println(string(b))
	if *out != "" {
		if err := os.WriteFile(*out, b, 0o644); err != nil {
			fatal("write %s: %v", *out, err)
		}
	}
	if !summary.OK {
		os.Exit(1)
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "chat-load: "+format+"\n", args...)
	os.Exit(2)
}

// --- results ---------------------------------------------------------------

type check struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Limit float64 `json:"limit"`
	OK    bool    `json:"ok"`
}

type result struct {
	Name       string         `json:"name"`
	OK         bool           `json:"ok"`
	ReportOnly bool           `json:"report_only,omitempty"`
	Seconds    float64        `json:"seconds"`
	Metrics    map[string]any `json:"metrics"`
	Checks     []check        `json:"checks"`
	Skipped    []string       `json:"skipped,omitempty"`
}

// atMost records a threshold: value must not exceed limit.
func (r *result) atMost(name string, value, limit float64) {
	r.Checks = append(r.Checks, check{Name: name, Value: round(value), Limit: limit, OK: value <= limit})
	fmt.Fprintf(os.Stderr, "   %-48s %10.2f  (≤ %g)\n", name, value, limit)
}

func round(v float64) float64 { return float64(int64(v*100)) / 100 }

// samples is a concurrent bag of durations in milliseconds.
type samples struct {
	mu sync.Mutex
	ms []float64
}

func (s *samples) add(d time.Duration) {
	s.mu.Lock()
	s.ms = append(s.ms, float64(d.Microseconds())/1000)
	s.mu.Unlock()
}

func (s *samples) pct(p float64) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return percentile(s.ms, p)
}

func (s *samples) n() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.ms)
}

// percentile is nearest-rank; 0 for no samples.
func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return 0
	}
	c := slices.Clone(v)
	slices.Sort(c)
	i := int(float64(len(c))*p+0.999999) - 1
	return c[max(0, min(i, len(c)-1))]
}

// --- HTTP ------------------------------------------------------------------

// call sends one request as u (nil u: anonymous) and decodes a 2xx body into
// out. A transport error is status 0.
//
// A 503 (load shed) is retried after its Retry-After, up to four times, as
// the web client's retry loops do; the duration then covers every attempt.
func (e *env) call(u *vu, method, path string, body, out any) (int, time.Duration) {
	var payload []byte
	ct := "application/json"
	switch b := body.(type) {
	case nil:
	case *multipartBody:
		payload, ct = b.raw, b.ct
	default:
		payload, _ = json.Marshal(b)
	}
	start := time.Now()
	for attempt := 0; ; attempt++ {
		req, _ := http.NewRequest(method, e.base+path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", ct)
		if u != nil {
			req.Header.Set("X-Forwarded-For", u.ip)
			if u.token != "" {
				req.Header.Set("Authorization", "Bearer "+u.token)
			}
		}
		res, err := e.hc.Do(req)
		if err != nil {
			return 0, time.Since(start)
		}
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode == http.StatusServiceUnavailable && attempt < 4 {
			e.shed.Add(1)
			wait, err := strconv.Atoi(res.Header.Get("Retry-After"))
			if err != nil || wait < 1 {
				wait = 1
			}
			time.Sleep(time.Duration(wait) * time.Second)
			continue
		}
		if out != nil && res.StatusCode/100 == 2 {
			_ = json.Unmarshal(raw, out)
		}
		return res.StatusCode, time.Since(start)
	}
}

type multipartBody struct {
	raw []byte
	ct  string
}

func ok(status int) bool { return status/100 == 2 }

// tally counts response statuses for the summary.
type tally struct {
	mu sync.Mutex
	by map[string]int
}

func (t *tally) add(status int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.by == nil {
		t.by = map[string]int{}
	}
	t.by[strconv.Itoa(status)]++
}

func clientIP(i int) string { return fmt.Sprintf("10.88.%d.%d", (i>>8)&255, i&255) }

// need returns users 0..n-1, logging in the ones not seen yet. Access tokens
// live 15 minutes, so a batch older than 10 logs in again: every scenario
// starts with at least 5 minutes of token left.
func (e *env) need(n int) []*vu {
	e.mu.Lock()
	defer e.mu.Unlock()
	if time.Since(e.loggedAt) > 10*time.Minute {
		e.users, e.loggedAt = nil, time.Now()
	}
	if have := len(e.users); have < n {
		fresh := make([]*vu, n-have)
		var wg sync.WaitGroup
		var failed atomic.Int64
		jobs := make(chan int)
		for range 16 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range jobs {
					u := &vu{i: i, ip: clientIP(i)}
					var res struct {
						AccessToken string `json:"access_token"`
						User        struct {
							ID string `json:"id"`
						} `json:"user"`
					}
					st, _ := e.call(u, "POST", "/api/v1/auth/login", map[string]string{
						"email": fmt.Sprintf("user%d@perf.local", i), "password": "password123",
					}, &res)
					if !ok(st) || res.AccessToken == "" {
						failed.Add(1)
						fmt.Fprintf(os.Stderr, "login user%d: %d\n", i, st)
					}
					u.token, u.id = res.AccessToken, res.User.ID
					fresh[i-have] = u
				}
			}()
		}
		for i := have; i < n; i++ {
			jobs <- i
		}
		close(jobs)
		wg.Wait()
		if failed.Load() > 0 {
			fatal("%d of %d logins failed (is the dataset seeded with ≥ %d users and TRUSTED_PROXIES set?)", failed.Load(), n-have, n)
		}
		e.users = append(e.users, fresh...)
	}
	if e.wsID == "" {
		var ws struct {
			Workspaces []struct {
				ID string `json:"id"`
			} `json:"workspaces"`
		}
		e.call(e.users[0], "GET", "/api/v1/workspaces", nil, &ws)
		if len(ws.Workspaces) == 0 {
			fatal("user0 has no workspace")
		}
		e.wsID = ws.Workspaces[0].ID
		var room struct {
			RoomID string `json:"room_id"`
		}
		e.call(e.users[0], "GET", e.ws("/chat/room"), nil, &room)
		if room.RoomID == "" {
			fatal("the workspace has no default channel: run server/cmd/seed")
		}
		e.room0 = room.RoomID
	}
	return e.users[:n]
}

func (e *env) ws(path string) string { return "/api/v1/workspaces/" + e.wsID + path }

// channel creates a public channel owned by owner with members in it.
func (e *env) channel(owner *vu, name string, members []*vu) string {
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.id
	}
	var res struct {
		Room struct {
			ID string `json:"id"`
		} `json:"room"`
	}
	st, _ := e.call(owner, "POST", e.ws("/chat/channels"), map[string]any{
		"name": fmt.Sprintf("%s-%d", name, time.Now().UnixMilli()), "visibility": "public", "member_user_ids": ids,
	}, &res)
	if res.Room.ID == "" {
		fatal("create channel %s: %d", name, st)
	}
	return res.Room.ID
}

type sent struct {
	id        string
	createdAt string
	start     time.Time
}

// sendLoop posts rate messages per second into room for d, rotating senders,
// and returns what the server accepted. POST latencies go to post.
func (e *env) sendLoop(senders []*vu, room string, rate float64, d time.Duration, post *samples) (out []sent, failed int) {
	var mu sync.Mutex
	var wg sync.WaitGroup
	tick := time.NewTicker(time.Duration(float64(time.Second) / rate))
	defer tick.Stop()
	stop := time.After(d)
	for n := 0; ; n++ {
		select {
		case <-stop:
			wg.Wait()
			return out, failed
		case <-tick.C:
		}
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			var res struct {
				Message struct {
					ID        string `json:"id"`
					CreatedAt string `json:"created_at"`
				} `json:"message"`
			}
			start := time.Now()
			st, took := e.call(senders[n%len(senders)], "POST", e.ws("/chat/rooms/"+room+"/messages"), map[string]string{
				"body": fmt.Sprintf("load %d", n), "client_msg_id": fmt.Sprintf("load-%d-%d", start.UnixNano(), n),
			}, &res)
			mu.Lock()
			defer mu.Unlock()
			if !ok(st) {
				failed++
				return
			}
			if post != nil {
				post.add(took)
			}
			out = append(out, sent{res.Message.ID, res.Message.CreatedAt, start})
		}(n)
	}
}

// --- WebSocket -------------------------------------------------------------

type frame struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

func (f frame) str(k string) string { s, _ := f.Payload[k].(string); return s }

type sock struct {
	c       *websocket.Conn
	wmu     sync.Mutex
	acks    atomic.Int64
	refused atomic.Int64
	done    chan struct{}
	once    sync.Once
}

// dial opens /api/v1/ws like the web client: the handshake, an `auth` first
// frame, then a {"type":"ping"} every ping. onFrame nil means the socket
// never reads after auth_ack (the C1 abuse case); rcvBuf > 0 shrinks the
// kernel receive buffer so such a socket backs up quickly.
func (e *env) dial(u *vu, ping time.Duration, rcvBuf int, onFrame func(frame)) (*sock, error) {
	d := websocket.Dialer{HandshakeTimeout: 30 * time.Second}
	if rcvBuf > 0 {
		nd := net.Dialer{Control: func(_, _ string, c syscall.RawConn) error {
			return c.Control(func(fd uintptr) {
				_ = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, rcvBuf)
			})
		}}
		d.NetDialContext = nd.DialContext
	}
	wsURL := strings.Replace(e.base, "http", "ws", 1) + "/api/v1/ws?client_platform=load&workspace_id=" + url.QueryEscape(e.wsID)
	c, res, err := d.Dial(wsURL, http.Header{"X-Forwarded-For": {u.ip}})
	if err != nil {
		if res != nil {
			return nil, fmt.Errorf("ws %s: %d", u.ip, res.StatusCode)
		}
		return nil, err
	}
	s := &sock{c: c, done: make(chan struct{})}
	if err := s.write(map[string]any{"type": "auth", "payload": map[string]string{"token": u.token}}); err != nil {
		c.Close()
		return nil, err
	}
	_ = c.SetReadDeadline(time.Now().Add(15 * time.Second))
	var ack frame
	if err := c.ReadJSON(&ack); err != nil || ack.Type != "auth_ack" {
		c.Close()
		return nil, fmt.Errorf("auth: %v %+v", err, ack)
	}
	_ = c.SetReadDeadline(time.Time{})
	if onFrame != nil {
		go func() {
			defer s.close()
			for {
				var f frame
				if err := c.ReadJSON(&f); err != nil {
					return
				}
				switch f.Type {
				case "subscribe_ack":
					s.acks.Add(1)
				case "subscribe_error":
					s.refused.Add(1)
				}
				onFrame(f)
			}
		}()
	}
	go func() {
		t := time.NewTicker(ping)
		defer t.Stop()
		for {
			select {
			case <-s.done:
				return
			case <-t.C:
				if s.write(map[string]string{"type": "ping"}) != nil {
					return
				}
			}
		}
	}()
	return s, nil
}

func (s *sock) write(v any) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.c.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.c.WriteJSON(v)
}

func (s *sock) subscribe(room string) error {
	return s.write(map[string]any{"type": "subscribe", "payload": map[string]string{"scope": "chat", "id": room}})
}

// settled waits until n subscriptions were answered (acked or refused).
func (s *sock) settled(n int, timeout time.Duration) bool {
	for end := time.Now().Add(timeout); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		if s.acks.Load()+s.refused.Load() >= int64(n) {
			return true
		}
	}
	return false
}

func (s *sock) close() {
	s.once.Do(func() {
		close(s.done)
		s.c.Close()
	})
}

// --- server metrics --------------------------------------------------------

// snap is the slice of the server's /metrics this tool reads.
type snap struct {
	at                                time.Time
	stmts, waits, cpu, rss, evictions float64
}

func (e *env) scrape() snap {
	res, err := e.hc.Get(e.metricsURL)
	if err != nil {
		fatal("metrics %s: %v", e.metricsURL, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return parseMetrics(string(raw), time.Now())
}

// parseMetrics sums each family over its labels.
func parseMetrics(text string, at time.Time) snap {
	s := snap{at: at}
	for _, line := range strings.Split(text, "\n") {
		name, rest, found := strings.Cut(line, " ")
		if !found || strings.HasPrefix(line, "#") {
			continue
		}
		name, _, _ = strings.Cut(name, "{")
		if i := strings.LastIndexByte(line, ' '); i > 0 {
			rest = line[i+1:]
		}
		v, err := strconv.ParseFloat(rest, 64)
		if err != nil {
			continue
		}
		switch name {
		case "uniwork_db_query_duration_seconds_count":
			s.stmts += v
		case "uniwork_db_pool_empty_acquire_count":
			s.waits += v
		case "process_cpu_seconds_total":
			s.cpu += v
		case "process_resident_memory_bytes":
			s.rss += v
		case "uniwork_realtime_slow_evictions_total":
			s.evictions += v
		}
	}
	return s
}

// idle measures the server's background statement and CPU rates (outbox
// loops, workers) so a phase can subtract them.
func (e *env) idle(d time.Duration) (stmtsPerSec, cpuPerSec float64) {
	a := e.scrape()
	time.Sleep(d)
	b := e.scrape()
	s := b.at.Sub(a.at).Seconds()
	return (b.stmts - a.stmts) / s, (b.cpu - a.cpu) / s
}

// livenessTimeout is livenessProbe.timeoutSeconds in
// deploy/app/uniwork/templates/deployment-be.yaml: a slower /healthz is a
// restart in production, so it counts as a failure here.
const livenessTimeout = 3 * time.Second

// watch samples RSS and /healthz once a second until stop is closed.
func (e *env) watch(stop <-chan struct{}) (maxRSS *atomic.Int64, healthFails *atomic.Int64, done <-chan struct{}) {
	maxRSS, healthFails = &atomic.Int64{}, &atomic.Int64{}
	fin := make(chan struct{})
	go func() {
		defer close(fin)
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			if st, took := e.call(nil, "GET", "/healthz", nil, nil); st != http.StatusOK || took > livenessTimeout {
				healthFails.Add(1)
			} else if rss := int64(e.scrape().rss); rss > maxRSS.Load() {
				maxRSS.Store(rss)
			}
			select {
			case <-stop:
				return
			case <-t.C:
			}
		}
	}()
	return maxRSS, healthFails, fin
}

func jitter(base, spread time.Duration) time.Duration {
	return base + time.Duration(rand.Int64N(int64(spread)))
}

func raiseFileLimit() {
	var l syscall.Rlimit
	if syscall.Getrlimit(syscall.RLIMIT_NOFILE, &l) == nil && l.Cur < l.Max {
		l.Cur = min(l.Max, 1<<16)
		_ = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &l)
	}
}
