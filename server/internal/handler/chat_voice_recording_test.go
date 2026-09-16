package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type fakeDownloadPresigner struct {
	url string
	err error
}

func (f fakeDownloadPresigner) PresignGetWithContentDisposition(
	_ context.Context, _ string, _ time.Duration, _ string,
) (string, error) {
	return f.url, f.err
}

func TestPresignRecordingPlaybackURL(t *testing.T) {
	t.Parallel()
	url, expiresAt, err := presignRecordingPlaybackURL(
		context.Background(),
		fakeDownloadPresigner{url: "https://signed.example/rec.mp4"},
		"chat-voice/rec.mp4",
	)
	if err != nil || url != "https://signed.example/rec.mp4" {
		t.Fatalf("presign = %q err=%v", url, err)
	}
	if expiresAt.Before(time.Now().UTC()) {
		t.Fatalf("expiresAt in the past: %v", expiresAt)
	}
}

func TestStreamRecordingObjectNilStorage(t *testing.T) {
	t.Parallel()
	h := &handlers{Deps: Deps{Log: slog.Default()}}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.streamRecordingObject(w, req, "key", "rec-id")
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestStreamRecordingObjectLocalStorage(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://uploads.test")
	store := storage.NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("local storage init failed")
	}

	key := "chat-voice/rec.mp4"
	if err := os.MkdirAll(filepath.Join(dir, "chat-voice"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := []byte("fake-mp4-bytes")
	if err := os.WriteFile(filepath.Join(dir, key), body, 0o644); err != nil {
		t.Fatal(err)
	}

	h := &handlers{Deps: Deps{Storage: store, Log: slog.Default()}}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.streamRecordingObject(w, req, key, "rec-id")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "video/mp4" {
		t.Fatalf("content-type = %q", got)
	}
	if got, err := io.ReadAll(w.Body); err != nil || string(got) != string(body) {
		t.Fatalf("body = %q err=%v", got, err)
	}
}

func TestChatVoiceRecordingDTO(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	dto := chatVoiceRecordingDTO(db.ChatVoiceRecording{
		ID: "rec-1", RoomID: "room-1", CallID: "call-1",
		Status: service.RecordingComplete, StartedBy: "user-1",
		StartedAt: pgtype.Timestamptz{Time: now, Valid: true},
		FileUrl:   pgtype.Text{String: "https://bucket/rec.mp4", Valid: true},
		EndedAt:   pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
	})
	if dto.ID != "rec-1" || dto.FileURL != "https://bucket/rec.mp4" || dto.EndedAt == "" {
		t.Fatalf("dto = %#v", dto)
	}
	listItem := chatVoiceRecordingListItemDTO(db.ChatVoiceRecording{
		ID: "rec-2", RoomID: "room-1", CallID: "call-2",
		Status: service.RecordingProcessing, StartedBy: "user-1",
		StartedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if listItem.ID != "rec-2" || listItem.FileURL != "" {
		t.Fatalf("list item = %#v", listItem)
	}
}

func TestChatVoiceRecordingHTTP(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://uploads.test")

	f := setupChatFixture(t, "voice-rec")
	srv, tokA, tokB := f.srv, f.tokens["a"], f.tokens["b"]
	voiceBase := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.groupRoomID + "/voice"
	recBase := voiceBase + "/recordings"
	callID := "550e8400-e29b-41d4-a716-446655440099"

	res, out := doJSON(t, srv, "POST", voiceBase+"/invite", tokA, map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", voiceBase+"/accept", tokB, map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("accept: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", voiceBase+"/recording/start", tokA, map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start recording: %d %v", res.StatusCode, out)
	}
	rec := out["recording"].(map[string]any)
	recID := rec["id"].(string)

	res, out = doJSON(t, srv, "GET", voiceBase+"/recording/active?call_id="+callID, tokA, nil)
	if res.StatusCode != http.StatusOK || out["recording"].(map[string]any)["id"] != recID {
		t.Fatalf("active: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", recBase, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	recordings := out["recordings"].([]any)
	if len(recordings) != 1 {
		t.Fatalf("recordings = %v", recordings)
	}

	res, out = doJSON(t, srv, "POST", voiceBase+"/recording/stop", tokB, map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stop recording: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "GET", recBase+"/"+recID+"/playback-url", tokA, nil)
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("playback-url with local storage: %d", res.StatusCode)
	}

	key := "chat-voice/rec-http.mp4"
	fileURL := "http://uploads.test/uploads/" + key
	if err := os.MkdirAll(filepath.Join(dir, "chat-voice"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, key), []byte("mp4"), 0o644); err != nil {
		t.Fatal(err)
	}

	q := db.New(testPool)
	stored, err := q.GetChatVoiceRecordingByID(context.Background(), db.GetChatVoiceRecordingByIDParams{
		ID: recID, WorkspaceID: f.wsID, RoomID: f.groupRoomID,
	})
	if err != nil {
		t.Fatal(err)
	}
	finished, err := q.FinishChatVoiceRecordingByEgress(context.Background(), db.FinishChatVoiceRecordingByEgressParams{
		EgressID: stored.EgressID,
		Status:   service.RecordingComplete,
		FileUrl:  pgtype.Text{String: fileURL, Valid: true},
	})
	if err != nil || finished.ID != recID {
		t.Fatalf("finish egress: %+v err=%v", finished, err)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+recBase+"/"+recID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+tokA)
	res, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stream content: %d", res.StatusCode)
	}
}

func TestMeetingRecordingHTTP(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://uploads.test")

	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "meeting-rec@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Rec Org", "slug": "rec-org"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Rec WS", "slug": "rec-ws"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Rec"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	recPath := "/api/v1/meetings/" + meetingID + "/recordings"

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/start", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start recording: %d %v", res.StatusCode, out)
	}
	rec := out["recording"].(map[string]any)
	recID := rec["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/stop", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stop recording: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", recPath, token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list recordings: %d %v", res.StatusCode, out)
	}

	key := "meetings/rec-http.mp4"
	fileURL := "http://uploads.test/uploads/" + key
	if err := os.MkdirAll(filepath.Join(dir, "meetings"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, key), []byte("mp4"), 0o644); err != nil {
		t.Fatal(err)
	}

	q := db.New(testPool)
	stored, err := q.GetMeetingRecordingByID(context.Background(), db.GetMeetingRecordingByIDParams{
		ID: recID, MeetingID: meetingID,
	})
	if err != nil {
		t.Fatal(err)
	}
	finished, err := q.FinishRecordingByEgress(context.Background(), db.FinishRecordingByEgressParams{
		EgressID: stored.EgressID,
		Status:   service.RecordingComplete,
		FileUrl:  pgtype.Text{String: fileURL, Valid: true},
	})
	if err != nil || finished.ID != recID {
		t.Fatalf("finish egress: %+v err=%v", finished, err)
	}

	res, _ = doJSON(t, srv, "GET", recPath+"/"+recID+"/playback-url", token, nil)
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("playback-url with local storage: %d", res.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+recPath+"/"+recID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stream content: %d", res.StatusCode)
	}
}

func TestParseByteRange(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		header string
		size   int64
		start  int64
		end    int64
		ok     bool
	}{
		{name: "full", header: "", size: 100, start: 0, end: 99, ok: true},
		{name: "suffix", header: "bytes=-10", size: 100, start: 90, end: 99, ok: true},
		{name: "open", header: "bytes=50-", size: 100, start: 50, end: 99, ok: true},
		{name: "closed", header: "bytes=0-9", size: 100, start: 0, end: 9, ok: true},
		{name: "past end clamped", header: "bytes=95-200", size: 100, start: 95, end: 99, ok: true},
		{name: "zero size", header: "", size: 0, ok: false},
		{name: "invalid unit", header: "items=0-1", size: 100, ok: false},
		{name: "multi range", header: "bytes=0-1,2-3", size: 100, ok: false},
		{name: "start past size", header: "bytes=100-", size: 100, ok: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			start, end, ok := parseByteRange(tc.header, tc.size)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if !ok {
				return
			}
			if start != tc.start || end != tc.end {
				t.Fatalf("range = %d-%d, want %d-%d", start, end, tc.start, tc.end)
			}
		})
	}
}

func TestStreamRecordingObjectFullMissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://uploads.test")
	store := storage.NewLocalStorageFromEnv()
	if store == nil {
		t.Fatal("local storage init failed")
	}

	h := &handlers{Deps: Deps{Storage: store, Log: slog.Default(), Cfg: config.Config{}}}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.streamRecordingObjectFull(w, req, "missing.mp4", "rec-id")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d", w.Code)
	}
}
