package handler

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Buoc 0 regression pins for the recording lane (UNI-746) at the HTTP edge:
// who may stream a meeting recording, how the legacy Range handling behaves on
// each storage backend, and the two-organization guess. The FileService
// migration may edit these assertions deliberately; it must not delete them.

// registerRecordingUser registers and verifies one user and creates their own
// organization plus workspace, the way the onboarding flow does. Each caller
// therefore owns a distinct organization, which is what the isolation case
// needs.
func registerRecordingUser(t *testing.T, srv *httptest.Server, tag string) (token, email, wsID string) {
	t.Helper()
	email = tag + "@example.com"
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": tag,
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register %s: %d %v", tag, res.StatusCode, out)
	}
	token = out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org " + tag, "slug": "org-" + tag})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org %s: %d %v", tag, res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS " + tag, "slug": "ws-" + tag})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create workspace %s: %d %v", tag, res.StatusCode, out)
	}
	wsID = out["workspace"].(map[string]any)["id"].(string)
	return token, email, wsID
}

// inviteToWorkspace walks the real invitation flow so a second user joins the
// host's workspace as a plain member.
func inviteToWorkspace(t *testing.T, srv *httptest.Server, hostToken, wsID, memberToken, memberEmail string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", hostToken, map[string]any{
		"emails": []string{memberEmail}, "role": "member",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", memberToken, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list invitations: %d %v", res.StatusCode, out)
	}
	invitations, _ := out["invitations"].([]any)
	if len(invitations) == 0 {
		t.Fatalf("no invitation for the member: %v", out)
	}
	invitationToken := invitations[0].(map[string]any)["token"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+invitationToken+"/accept", memberToken, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("accept invitation: %d %v", res.StatusCode, out)
	}
}

// getWithHeaders is the raw variant of doJSON for the streaming route: the
// caller needs its own Range and guest-session headers and the raw body.
func getWithHeaders(t *testing.T, srv *httptest.Server, path, token string, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, body
}

func TestMeetingRecordingHTTPPlaybackAuthorization(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "http://uploads.test")

	srv := newTestServer(t)
	hostToken, _, hostWS := registerRecordingUser(t, srv, "rec-host")
	memberToken, memberEmail, _ := registerRecordingUser(t, srv, "rec-member")
	outsiderToken, _, _ := registerRecordingUser(t, srv, "rec-outsider")
	inviteToWorkspace(t, srv, hostToken, hostWS, memberToken, memberEmail)

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+hostWS+"/meetings/instant", hostToken, map[string]string{"title": "Rec auth"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	recPath := "/api/v1/meetings/" + meetingID + "/recordings"

	// Start and stop over the legacy routes; the test server runs the fake
	// provider with recording enabled.
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/start", hostToken, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start recording: %d %v", res.StatusCode, out)
	}
	rec := out["recording"].(map[string]any)
	recID := rec["id"].(string)
	if rec["status"] != service.RecordingActive {
		t.Fatalf("started recording: %v", rec)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/start", hostToken, nil)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "recording_active" {
		t.Fatalf("second start: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/stop", hostToken, nil)
	if res.StatusCode != http.StatusOK || out["recording"].(map[string]any)["status"] != service.RecordingProcessing {
		t.Fatalf("stop recording: %d %v", res.StatusCode, out)
	}
	// A non-host member may not drive the recording.
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/recording/stop", memberToken, nil)
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_host" {
		t.Fatalf("member stop: %d %v", res.StatusCode, out)
	}

	// The provider webhook would finish the row; the fake provider uploads
	// nothing, so the fixture writes the object and the COMPLETE row the
	// webhook would produce.
	key := "meetings/" + hostWS + "/" + recID + ".mp4"
	body := []byte("legacy-recording-bytes")
	if err := os.MkdirAll(filepath.Join(dir, "meetings", hostWS), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, key), body, 0o644); err != nil {
		t.Fatal(err)
	}
	q := db.New(testPool)
	stored, err := q.GetMeetingRecordingByID(context.Background(), db.GetMeetingRecordingByIDParams{ID: recID, MeetingID: meetingID})
	if err != nil {
		t.Fatal(err)
	}
	fileURL := "http://uploads.test/uploads/" + key
	if _, err := q.FinishRecordingByEgress(context.Background(), db.FinishRecordingByEgressParams{
		EgressID: stored.EgressID, Status: service.RecordingComplete, FileUrl: pgtype.Text{String: fileURL, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	// Host: the proxy streams the object.
	res, got := getWithHeaders(t, srv, recPath+"/"+recID+"/content", hostToken, nil)
	if res.StatusCode != http.StatusOK || string(got) != string(body) {
		t.Fatalf("host content: %d body=%q", res.StatusCode, got)
	}
	if ct := res.Header.Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("host content type = %q", ct)
	}
	// Local backend: a Range request still gets the whole object and no
	// Accept-Ranges, because only the S3 branch implements byte ranges.
	res, got = getWithHeaders(t, srv, recPath+"/"+recID+"/content", hostToken, map[string]string{"Range": "bytes=0-4"})
	if res.StatusCode != http.StatusOK || string(got) != string(body) || res.Header.Get("Content-Range") != "" || res.Header.Get("Accept-Ranges") != "" {
		t.Fatalf("local range: %d body=%q content-range=%q accept-ranges=%q",
			res.StatusCode, got, res.Header.Get("Content-Range"), res.Header.Get("Accept-Ranges"))
	}
	// Without a download presigner the playback-url route answers 501 before
	// any authorization check - the S3-only fast path.
	res, out = doJSON(t, srv, "GET", recPath+"/"+recID+"/playback-url", hostToken, nil)
	if res.StatusCode != http.StatusNotImplemented || errorCode(out) != "storage_unavailable" {
		t.Fatalf("playback-url on the local backend: %d %v", res.StatusCode, out)
	}

	// Same workspace, not the host: allowed to list and stream.
	res, out = doJSON(t, srv, "GET", recPath, memberToken, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("member list: %d %v", res.StatusCode, out)
	}
	if rows, _ := out["recordings"].([]any); len(rows) != 1 {
		t.Fatalf("member recordings: %v", out)
	}
	res, got = getWithHeaders(t, srv, recPath+"/"+recID+"/content", memberToken, nil)
	if res.StatusCode != http.StatusOK || string(got) != string(body) {
		t.Fatalf("member content: %d body=%q", res.StatusCode, got)
	}

	// Another organization that guessed meeting and recording ids: blocked on
	// both the list and the stream.
	res, out = doJSON(t, srv, "GET", recPath, outsiderToken, nil)
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "forbidden" {
		t.Fatalf("outsider list: %d %v", res.StatusCode, out)
	}
	res, got = getWithHeaders(t, srv, recPath+"/"+recID+"/content", outsiderToken, nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider content: %d body=%q", res.StatusCode, got)
	}

	// No principal at all.
	res, _ = getWithHeaders(t, srv, recPath+"/"+recID+"/content", "", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous content: %d", res.StatusCode)
	}

	// Guest session: only an ACTIVE participant row in this meeting opens the
	// stream.
	guestID := util.NewID()
	if _, err := q.CreateMeetingGuest(context.Background(), guestID); err != nil {
		t.Fatal(err)
	}
	signed := meetings.SignGuestCookie(guestID, []byte("test"))
	res, _ = getWithHeaders(t, srv, recPath+"/"+recID+"/content", "", map[string]string{meetings.GuestSessionHeader: signed})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("guest without participant row: %d", res.StatusCode)
	}
	if _, err := q.CreateMeetingParticipant(context.Background(), db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: meetingID, PrincipalType: service.PrincipalGuest,
		GuestID: pgtype.Text{String: guestID, Valid: true}, DisplayNameSnapshot: "Guest",
		Role: service.RoleAttendee, SourceType: service.GrantInviteLink,
		SourceID: pgtype.Text{String: "link", Valid: true}, AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	res, got = getWithHeaders(t, srv, recPath+"/"+recID+"/content", "", map[string]string{meetings.GuestSessionHeader: signed})
	if res.StatusCode != http.StatusOK || string(got) != string(body) {
		t.Fatalf("guest content: %d body=%q", res.StatusCode, got)
	}
	// A tampered guest session is not a principal.
	res, _ = getWithHeaders(t, srv, recPath+"/"+recID+"/content", "", map[string]string{meetings.GuestSessionHeader: "tampered.signature"})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("tampered guest session: %d", res.StatusCode)
	}
}

// fakeS3Object serves one object with HEAD and byte-range GET, which is what
// the S3 streaming branch uses.
func fakeS3Object(t *testing.T, bucket, key string, body []byte) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		object, ok := strings.CutPrefix(strings.TrimPrefix(r.URL.Path, "/"), bucket+"/")
		if !ok || object != key {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.Method {
		case http.MethodHead:
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.Header().Set("ETag", `"legacy"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			rangeHeader := r.Header.Get("Range")
			if rangeHeader == "" {
				w.Header().Set("Content-Length", strconv.Itoa(len(body)))
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(body)
				return
			}
			start, end, ok := parseByteRange(rangeHeader, int64(len(body)))
			if !ok {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
			w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(body[start : end+1])
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestMeetingRecordingContentRangeS3LegacyBehavior(t *testing.T) {
	key := "meetings/ws-a/rec-s3.mp4"
	body := []byte("0123456789abcdef")
	s3 := fakeS3Object(t, "test-bucket", key, body)

	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "AKID")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "SECRET")
	t.Setenv("AWS_ENDPOINT_URL", s3.URL)
	t.Setenv("S3_USE_PATH_STYLE", "1")

	store := storage.NewS3StorageFromEnv()
	if store == nil {
		t.Fatal("S3 storage init failed")
	}
	h := &handlers{Deps: Deps{Storage: store, Log: slog.Default()}}

	// No Range: the whole object with the size advertised up front.
	w := httptest.NewRecorder()
	h.streamRecordingObject(w, httptest.NewRequest(http.MethodGet, "/", nil), key, "rec-id")
	res := w.Result()
	defer res.Body.Close()
	full, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(full) != string(body) {
		t.Fatalf("s3 full: %d body=%q", res.StatusCode, full)
	}
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(body)) {
		t.Fatalf("s3 full content-length = %q", got)
	}
	if got := res.Header.Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("s3 full accept-ranges = %q", got)
	}
	if got := res.Header.Get("Content-Range"); got != "" {
		t.Fatalf("s3 full content-range = %q", got)
	}

	// A seek: the player re-requests a byte window.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=2-5")
	w = httptest.NewRecorder()
	h.streamRecordingObject(w, req, key, "rec-id")
	res = w.Result()
	defer res.Body.Close()
	partial, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || string(partial) != "2345" {
		t.Fatalf("s3 range: %d body=%q", res.StatusCode, partial)
	}
	if got := res.Header.Get("Content-Range"); got != "bytes 2-5/16" {
		t.Fatalf("s3 range content-range = %q", got)
	}
	if got := res.Header.Get("Content-Length"); got != "4" {
		t.Fatalf("s3 range content-length = %q", got)
	}

	// Unsatisfiable and malformed ranges are refused, so a player cannot ask
	// for nonsense.
	for _, header := range []string{"bytes=99-", "bytes=5-2", "items=0-1", "bytes=0-1,3-4"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Range", header)
		w := httptest.NewRecorder()
		h.streamRecordingObject(w, req, key, "rec-id")
		res := w.Result()
		_ = res.Body.Close()
		if res.StatusCode != http.StatusRequestedRangeNotSatisfiable {
			t.Fatalf("range %q: status=%d", header, res.StatusCode)
		}
		if got := res.Header.Get("Content-Range"); got != "" {
			t.Fatalf("range %q: content-range=%q", header, got)
		}
	}

	// A missing object is a 404, not an empty 200.
	w = httptest.NewRecorder()
	h.streamRecordingObject(w, httptest.NewRequest(http.MethodGet, "/", nil), "meetings/ws-a/missing.mp4", "rec-id")
	res = w.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("missing object: %d", res.StatusCode)
	}
}
