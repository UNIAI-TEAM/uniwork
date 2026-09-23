package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"
	"time"
)

// newListWorkspace registers a verified user with an organization and a
// workspace, and returns the token and the workspace id.
func newListWorkspace(t *testing.T, srv *httptest.Server, slug string) (string, string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": slug + "@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": slug + "-org"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": slug + "-ws"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	return token, out["workspace"].(map[string]any)["id"].(string)
}

func TestMeetingListSortStartsAtFollowsTheCalendarGroups(t *testing.T) {
	srv := newTestServer(t)
	token, wsID := newListWorkspace(t, srv, "list-sort")

	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}
	now := time.Now().In(loc)
	day := func(offset, hour int) time.Time {
		return time.Date(now.Year(), now.Month(), now.Day()+offset, hour, 0, 0, 0, loc)
	}
	// Created in an order unrelated to their start times, so created_at DESC
	// (the default sort) would give a different page.
	plan := []struct {
		title string
		start time.Time
	}{
		{"yesterday-16", day(-1, 16)},
		{"plus2-10", day(2, 10)},
		{"today-15", day(0, 15)},
		{"minus3-09", day(-3, 9)},
		// 01:00 in Ho Chi Minh is the previous day in UTC: only the zone puts it on today.
		{"today-01", day(0, 1)},
		{"tomorrow-08", day(1, 8)},
		{"yesterday-09", day(-1, 9)},
	}
	ctx := context.Background()
	for _, p := range plan {
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings", token, map[string]any{
			"title":     p.title,
			"starts_at": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			"ends_at":   time.Now().Add(25 * time.Hour).UTC().Format(time.RFC3339),
		})
		if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
			t.Fatalf("create %s: %d %v", p.title, res.StatusCode, out)
		}
		id := out["meeting"].(map[string]any)["id"].(string)
		if _, err := testPool.Exec(ctx, `UPDATE meetings SET starts_at = $2, ends_at = $3 WHERE id = $1`,
			id, p.start, p.start.Add(30*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}

	want := []string{"today-01", "today-15", "tomorrow-08", "plus2-10", "yesterday-09", "yesterday-16", "minus3-09"}
	titles := func(out map[string]any) []string {
		var got []string
		for _, m := range out["meetings"].([]any) {
			got = append(got, m.(map[string]any)["title"].(string))
		}
		return got
	}
	base := "/api/v1/workspaces/" + wsID + "/meetings?sort=starts_at&tz=" + url.QueryEscape("Asia/Ho_Chi_Minh")

	res, out := doJSON(t, srv, "GET", base, token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	if got := titles(out); !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}

	// Pages cut the same sequence: page two starts where page one stopped.
	res, out = doJSON(t, srv, "GET", base+"&limit=3&offset=3", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("page 2: %d %v", res.StatusCode, out)
	}
	if got := titles(out); !slices.Equal(got, want[3:6]) {
		t.Fatalf("page 2 = %v, want %v", got, want[3:6])
	}
	if out["total"].(float64) != float64(len(want)) {
		t.Fatalf("total = %v", out["total"])
	}

	// The default order is unchanged for other callers: newest created first.
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/meetings", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("default list: %d %v", res.StatusCode, out)
	}
	if got := titles(out); got[0] != "yesterday-09" || got[len(got)-1] != "yesterday-16" {
		t.Fatalf("default order = %v", got)
	}

	for _, bad := range []string{"?sort=title", "?sort=starts_at&tz=Mars/Olympus", "?sort=starts_at&tz=Local"} {
		res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/meetings"+bad, token, nil)
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: %d %v", bad, res.StatusCode, out)
		}
	}
}

func TestMeetingListFlagsPlayableRecordings(t *testing.T) {
	srv := newTestServer(t)
	token, wsID := newListWorkspace(t, srv, "list-rec")

	ids := map[string]string{}
	for _, title := range []string{"with-file", "processing", "none"} {
		res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": title})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("instant %s: %d %v", title, res.StatusCode, out)
		}
		ids[title] = out["meeting"].(map[string]any)["id"].(string)
	}
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `INSERT INTO meeting_recordings (id, meeting_id, status, file_url, started_by)
		VALUES ('rec-file', $1, 'COMPLETED', 'recordings/a.mp4', 'u'), ('rec-proc', $2, 'PROCESSING', NULL, 'u')`,
		ids["with-file"], ids["processing"]); err != nil {
		t.Fatal(err)
	}

	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/meetings", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	got := map[string]any{}
	for _, m := range out["meetings"].([]any) {
		row := m.(map[string]any)
		got[row["title"].(string)] = row["has_playable_recording"]
	}
	if got["with-file"] != true || got["processing"] != false || got["none"] != false {
		t.Fatalf("has_playable_recording = %v", got)
	}
}
