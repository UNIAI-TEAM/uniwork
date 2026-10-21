package service

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Catch-up for a late joiner (scribe spec §5.1, B7): the chat catch-up's
// frame (askuni_catchup.go: numbered sources, ParseCatchUpJSON) over the
// meeting's notes and its transcript from the start, by the parent spec's
// §7.3 source rule. One brief per meeting and language is shared for
// meetingCatchUpTTL, so five late joiners cost one model call.

const (
	meetingCatchUpTTL = 2 * time.Minute
	// A stretch of speech is one source: about a minute of talk, so a point's
	// time is close to where it was said.
	meetingCatchUpChunkRunes = 600
	// 80 stretches is ~48k runes, the order of the summary's transcript budget.
	meetingCatchUpMaxSources = 80
	meetingCatchUpNotesRunes = 2000
	// meetingCatchUpMargin is the claim's time beyond the model call: the
	// transcript reads before it and the parse after it.
	meetingCatchUpMargin = 30 * time.Second
	meetingCatchUpPoll   = 250 * time.Millisecond
)

// MeetingCatchUpPoint is one key point and the stretch of speech it came from
// (SegmentID is its first segment); both are empty for a point from the notes.
type MeetingCatchUpPoint struct {
	Text      string     `json:"text"`
	SegmentID string     `json:"segment_id,omitempty"`
	SpokenAt  *time.Time `json:"spoken_at,omitempty"`
}

// MeetingCatchUpItem is a follow-up people agreed on, pointed like a point.
type MeetingCatchUpItem struct {
	Title     string     `json:"title"`
	Owner     string     `json:"owner,omitempty"`
	Due       string     `json:"due,omitempty"`
	SegmentID string     `json:"segment_id,omitempty"`
	SpokenAt  *time.Time `json:"spoken_at,omitempty"`
}

// MeetingCatchUpResult is the brief; it is cached as this JSON.
type MeetingCatchUpResult struct {
	Summary     string                `json:"summary"`
	Highlights  []MeetingCatchUpPoint `json:"highlights"`
	ActionItems []MeetingCatchUpItem  `json:"action_items"`
	GeneratedAt time.Time             `json:"generated_at"`
	// Partial: the oldest speech did not fit and was left out.
	Partial bool `json:"partial"`
}

// MeetingCatchUp answers POST /meetings/{meetingID}/catch-up for a workspace
// member (D17: anyone else is refused by authorize, 403/404) while the
// meeting runs.
func (s *AskUNIService) MeetingCatchUp(ctx context.Context, userID, meetingID, locale string) (MeetingCatchUpResult, error) {
	m, _, err := s.meetings.authorize(ctx, userID, meetingID)
	if err != nil {
		return MeetingCatchUpResult{}, err
	}
	if m.Status != MeetingInProgress || !m.ActualStartAt.Valid {
		return MeetingCatchUpResult{}, errInvalidState()
	}
	if !s.gw.Enabled() {
		return MeetingCatchUpResult{}, ai.ErrDisabled
	}
	if err := s.rateLimit(ctx, userID); err != nil {
		return MeetingCatchUpResult{}, err
	}
	if locale != "en" {
		locale = "vi"
	}
	body, err := s.catchUps.do(ctx, "uw:meeting:catch-up:"+m.ID+":"+locale, func(ctx context.Context) ([]byte, bool, error) {
		res, asked, err := s.meetingCatchUp(ctx, userID, m, locale)
		if err != nil {
			return nil, false, err
		}
		b, err := json.Marshal(res)
		// A brief made without the model (nothing to read yet) is not
		// shared: the next joiner may find speech.
		return b, asked, err
	})
	if err != nil {
		return MeetingCatchUpResult{}, err
	}
	var res MeetingCatchUpResult
	err = json.Unmarshal(body, &res)
	return res, err
}

// catchUpSource is a numbered source and where its points lead.
type catchUpSource struct {
	src ai.Source
	seg *db.MeetingTranscriptSegment
}

// meetingCatchUp builds the brief; asked reports whether the model wrote it.
func (s *AskUNIService) meetingCatchUp(ctx context.Context, userID string, m db.Meeting, locale string) (res MeetingCatchUpResult, asked bool, err error) {
	src, err := s.q.TranscriptSources(ctx, m.ID)
	if err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	segs, err := s.q.ListTranscriptSegmentsLatest(ctx, db.ListTranscriptSegmentsLatestParams{
		MeetingID: m.ID, RowLimit: summaryTranscriptRows,
		Rich: src.HasAgent || len(src.TranscriptionIds) > 0, TranscriptionIds: src.TranscriptionIds,
	})
	if err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	slices.Reverse(segs)
	if _, err := s.meetings.nameSpeakers(ctx, m.ID, segs, locale); err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	notes, err := s.q.ListMeetingNotes(ctx, m.ID)
	if err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	now := s.now().UTC()
	sources, partial := catchUpSources(segs, notes, meetingClock(m))
	partial = partial || len(segs) >= summaryTranscriptRows
	if len(sources) == 0 {
		empty := "Chưa có lời nói hay ghi chú nào để tóm tắt."
		if locale == "en" {
			empty = "Nothing has been said or noted yet."
		}
		return MeetingCatchUpResult{Summary: empty, Highlights: []MeetingCatchUpPoint{}, ActionItems: []MeetingCatchUpItem{}, GeneratedAt: now}, false, nil
	}
	pack := make([]ai.Source, len(sources))
	for i := range sources {
		pack[i] = sources[i].src
	}
	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: Human(userID), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Capability: ai.CapMeetingCatchUp, PromptID: ai.PromptMeetingCatchUp,
		Vars: map[string]any{
			"locale": locale, "title": m.Title, "now": now.Format(time.RFC3339),
			"started": m.ActualStartAt.Time.UTC().Format(time.RFC3339), "sources": ai.RenderSources(pack),
		},
		Sources: pack, Truncated: partial,
	})
	if err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	parsed, err := ai.ParseCatchUpJSON(resp.Text, pack)
	if err != nil {
		return MeetingCatchUpResult{}, false, err
	}
	// ParseCatchUpJSON already cleared source ids the pack does not hold.
	at := func(id string) (string, *time.Time) {
		for _, c := range sources {
			if c.src.ID == id && c.seg != nil {
				t := c.seg.SpokenAt.Time
				return c.seg.ID, &t
			}
		}
		return "", nil
	}
	out := MeetingCatchUpResult{
		Summary: parsed.Summary, Highlights: make([]MeetingCatchUpPoint, 0, len(parsed.Highlights)),
		ActionItems: make([]MeetingCatchUpItem, 0, len(parsed.ActionItems)), GeneratedAt: now, Partial: partial,
	}
	for _, h := range parsed.Highlights {
		id, t := at(h.SourceID)
		out.Highlights = append(out.Highlights, MeetingCatchUpPoint{Text: h.Text, SegmentID: id, SpokenAt: t})
	}
	for _, a := range parsed.ActionItems {
		id, t := at(a.SourceID)
		out.ActionItems = append(out.ActionItems, MeetingCatchUpItem{Title: a.Title, Owner: a.Owner, Due: a.Due, SegmentID: id, SpokenAt: t})
	}
	return out, true, nil
}

// catchUpSources numbers the notes (one source) and the transcript cut into
// stretches of about meetingCatchUpChunkRunes, oldest first. Past
// meetingCatchUpMaxSources the oldest stretches are dropped (partial), as the
// summary keeps the newest lines.
func catchUpSources(segs []db.MeetingTranscriptSegment, notes []db.ListMeetingNotesRow, clock func(time.Time) string) ([]catchUpSource, bool) {
	var out []catchUpSource
	var b strings.Builder
	for _, n := range notes {
		if body := strings.TrimSpace(n.Body); body != "" {
			b.WriteString("- " + body + "\n")
		}
	}
	if b.Len() > 0 {
		out = append(out, catchUpSource{src: ai.Source{Kind: "notes", Title: "Ghi chú", Excerpt: capRunes(strings.TrimSpace(b.String()), meetingCatchUpNotesRunes, "…")}})
	}
	var stretches []catchUpSource
	for i := 0; i < len(segs); {
		head := &segs[i]
		b.Reset()
		for ; i < len(segs) && (b.Len() == 0 || utf8.RuneCountInString(b.String()) < meetingCatchUpChunkRunes); i++ {
			if text := strings.TrimSpace(segs[i].Text); text != "" {
				b.WriteString(segs[i].SpeakerName + ": " + text + "\n")
			}
		}
		if b.Len() > 0 {
			stretches = append(stretches, catchUpSource{src: ai.Source{Kind: "transcript", Title: clock(head.SpokenAt.Time), Excerpt: strings.TrimSpace(b.String())}, seg: head})
		}
	}
	partial := false
	if room := meetingCatchUpMaxSources - len(out); len(stretches) > room {
		stretches, partial = stretches[len(stretches)-room:], true
	}
	out = append(out, stretches...)
	for i := range out {
		out[i].src.ID = "S" + strconv.Itoa(i+1)
	}
	return out, partial
}

// meetingClock writes a time as the meeting's own clock shows it.
func meetingClock(m db.Meeting) func(time.Time) string {
	loc, err := time.LoadLocation(m.Timezone)
	if err != nil || m.Timezone == "" {
		loc = time.UTC
	}
	return func(t time.Time) string { return t.In(loc).Format("15:04") }
}

// briefCache shares one result per key for its ttl: in Redis when configured,
// so every node serves it, and always in this process. A node that finds
// another one already asking the model waits for that answer.
type briefCache struct {
	rdb *redis.Client
	ttl time.Duration
	// claimTTL outlives the work fn does, so no node pays while one is still
	// asking the model.
	claimTTL time.Duration
	mu       sync.Mutex
	mem      map[string]briefEntry
	sf       singleflight.Group
}

type briefEntry struct {
	body  []byte
	until time.Time
}

// newBriefCache sizes its cross-node claim from callTimeout, the longest the
// model call inside fn can take.
func newBriefCache(rdb *redis.Client, ttl, callTimeout time.Duration) *briefCache {
	return &briefCache{rdb: rdb, ttl: ttl, claimTTL: callTimeout + meetingCatchUpMargin, mem: map[string]briefEntry{}}
}

// do returns the cached body for key, or runs fn once for every caller in
// this process (and, through a Redis claim, across nodes). fn runs detached
// from the first caller's cancellation, since others wait on it; keep says
// whether its body may be shared.
func (c *briefCache) do(ctx context.Context, key string, fn func(context.Context) ([]byte, bool, error)) ([]byte, error) {
	if b, ok := c.get(ctx, key); ok {
		return b, nil
	}
	ch := c.sf.DoChan(key, func() (any, error) {
		ctx := context.WithoutCancel(ctx)
		if b, ok := c.get(ctx, key); ok {
			return b, nil
		}
		if !c.claim(ctx, key) {
			if b, ok := c.await(ctx, key); ok {
				return b, nil
			}
		}
		b, keep, err := fn(ctx)
		if err == nil && keep {
			c.put(ctx, key, b)
		}
		c.unclaim(ctx, key)
		return b, err
	})
	select {
	case r := <-ch:
		if r.Err != nil {
			return nil, r.Err
		}
		return r.Val.([]byte), nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *briefCache) get(ctx context.Context, key string) ([]byte, bool) {
	c.mu.Lock()
	e, ok := c.mem[key]
	c.mu.Unlock()
	if ok && time.Now().Before(e.until) {
		return e.body, true
	}
	if c.rdb == nil {
		return nil, false
	}
	rctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	b, err := c.rdb.Get(rctx, key).Bytes()
	return b, err == nil
}

func (c *briefCache) put(ctx context.Context, key string, b []byte) {
	now := time.Now()
	c.mu.Lock()
	for k, e := range c.mem {
		if now.After(e.until) {
			delete(c.mem, k)
		}
	}
	c.mem[key] = briefEntry{body: b, until: now.Add(c.ttl)}
	c.mu.Unlock()
	if c.rdb != nil {
		rctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
		defer cancel()
		_ = c.rdb.Set(rctx, key, b, c.ttl).Err()
	}
}

// claim reports whether this node asks the model. Without Redis, or when
// Redis does not answer, it does (fail open: at worst a second call).
func (c *briefCache) claim(ctx context.Context, key string) bool {
	if c.rdb == nil {
		return true
	}
	rctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	ok, err := c.rdb.SetNX(rctx, key+":run", "1", c.claimTTL).Result()
	return ok || err != nil
}

func (c *briefCache) unclaim(ctx context.Context, key string) {
	if c.rdb == nil {
		return
	}
	rctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	_ = c.rdb.Del(rctx, key+":run").Err()
}

// await polls for another node's brief while its claim stands: the claim
// outlives that node's model call, so it ends with a brief, or goes away when
// the node failed or kept nothing (then this node asks itself).
func (c *briefCache) await(ctx context.Context, key string) ([]byte, bool) {
	for {
		time.Sleep(meetingCatchUpPoll)
		if b, ok := c.get(ctx, key); ok {
			return b, true
		}
		rctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
		n, err := c.rdb.Exists(rctx, key+":run").Result()
		cancel()
		if err != nil || n == 0 {
			return nil, false
		}
	}
}
