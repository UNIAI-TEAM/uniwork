package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestOfficeLaunchCreateRouteBindsTicketToDocumentAndHidesItFromNonMembers(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createMarkdownFile(t, "# launch\n")

	res, body := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "edit", "client_id": "uniwork-office", "deployment_id": "default",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create launch = %d %v", res.StatusCode, body)
	}
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("launch cache policy = %q", got)
	}
	ticket, _ := body["launch_ticket"].(string)
	launchURL, _ := body["launch_url"].(string)
	if !strings.HasPrefix(ticket, "ticket_") || ticket == "" {
		t.Fatalf("launch ticket = %q", ticket)
	}
	u, err := url.Parse(launchURL)
	if err != nil || u.Scheme != "uniwork-office" || u.Host != "open" || u.Path != "" {
		t.Fatalf("launch URL = %q (%v)", launchURL, err)
	}
	values := u.Query()
	if len(values) != 1 || len(values["ticket"]) != 1 || values.Get("ticket") != ticket {
		t.Fatalf("launch URL query = %#v", values)
	}
	if got, _ := body["document_id"].(string); got != documentID {
		t.Fatalf("document binding = %q", got)
	}

	res, body = doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.outsiderToken(t), map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default",
	})
	if res.StatusCode != 404 {
		t.Fatalf("non-member create = %d %v", res.StatusCode, body)
	}
	raw, _ := json.Marshal(body)
	if strings.Contains(string(raw), ticket) {
		t.Fatal("non-member response echoed another account's launch ticket")
	}
}

func TestOfficeLaunchCreateRouteNoneHintDoesNotOfferDeepLink(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createMarkdownFile(t, "# no handoff\n")
	res, body := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default", "return_hint": "none",
	})
	if res.StatusCode != 201 {
		t.Fatalf("none-hint create = %d %v", res.StatusCode, body)
	}
	if _, ok := body["launch_url"]; ok {
		t.Fatalf("none-hint response offered launch_url: %v", body)
	}
}

func TestOfficeLaunchRevokeRouteHidesAnotherAccountsReceipt(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createMarkdownFile(t, "# revoke\n")
	res, body := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create launch = %d %v", res.StatusCode, body)
	}
	ticket, _ := body["launch_ticket"].(string)
	if ticket == "" {
		t.Fatal("create launch omitted ticket")
	}
	sum := sha256.Sum256([]byte(ticket))
	row, err := w.q.GetOfficeLaunchSessionByHash(context.Background(), base64.RawURLEncoding.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("look up launch receipt for test = %v", err)
	}

	// An account that did not mint the receipt must receive the same 404 as a
	// random id; a 403 would reveal that the opaque id exists.
	res, body = doJSON(t, w.srv, "DELETE", "/api/v1/office/sessions/"+row.ID, w.outsiderToken(t), nil)
	if res.StatusCode != 404 {
		t.Fatalf("cross-account revoke = %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, w.srv, "DELETE", "/api/v1/office/sessions/01J8X4NOTHINGATALL000000", w.outsiderToken(t), nil)
	if res.StatusCode != 404 {
		t.Fatalf("unknown revoke = %d %v", res.StatusCode, body)
	}

	// The owner can still cancel the untouched session after the probe.
	res, body = doJSON(t, w.srv, "DELETE", "/api/v1/office/sessions/"+row.ID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner revoke = %d %v", res.StatusCode, body)
	}
}

// G8-07 §3: the launch ticket carries an optional comment_id. Present, it is
// validated against the document's own tenant pair, stored and echoed back;
// absent, the behaviour is unchanged.
func TestOfficeLaunchCreateRouteCarriesOptionalCommentID(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createMarkdownFile(t, "# comment launch\n")

	// A discussion comment on the document, through the API.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/comments", w.token, map[string]any{"body": "mở ở đây"})
	if res.StatusCode != 201 {
		t.Fatalf("create comment: %d %v", res.StatusCode, out)
	}
	commentID := out["comment"].(map[string]any)["id"].(string)

	// Absent: unchanged behaviour, no comment_id in the answer.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default",
	})
	if res.StatusCode != 201 {
		t.Fatalf("launch without comment: %d %v", res.StatusCode, out)
	}
	if _, ok := out["comment_id"]; ok {
		t.Fatalf("absent comment_id echoed: %v", out)
	}

	// Present: stored on the row and echoed back.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default", "comment_id": commentID,
	})
	if res.StatusCode != 201 {
		t.Fatalf("launch with comment: %d %v", res.StatusCode, out)
	}
	if got, _ := out["comment_id"].(string); got != commentID {
		t.Fatalf("comment_id echo = %q, want %q", got, commentID)
	}
	ticket, _ := out["launch_ticket"].(string)
	sum := sha256.Sum256([]byte(ticket))
	row, err := w.q.GetOfficeLaunchSessionByHash(context.Background(), base64.RawURLEncoding.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("look up launch row: %v", err)
	}
	if !row.CommentID.Valid || row.CommentID.String != commentID {
		t.Fatalf("stored comment_id = %v, want %q", row.CommentID, commentID)
	}

	// A comment id that names no comment of this document is refused and
	// stores nothing (same 404 as a random id: no existence oracle).
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default", "comment_id": "01J8X4NOTHINGATALL000000",
	})
	if res.StatusCode != 404 {
		t.Fatalf("unknown comment id = %d %v", res.StatusCode, out)
	}
}

// R1-1: the ticket may only name a comment of ITS OWN document. A live
// comment of another document in the same workspace must be refused with the
// same 404 as an unknown id, and no launch row may be stored; the same id
// still works on its own document.
func TestOfficeLaunchCommentIDMustBelongToTheDocument(t *testing.T) {
	var pool *pgxpool.Pool
	w := newOfficeWorldTweaked(t, true, func(*filesfake.Fake) service.OfficeEngine { return newHandlerStubEngine(t) },
		func(_ *Deps, p *pgxpool.Pool) { pool = p })
	documentID := w.createMarkdownFile(t, "# comment owner\n")
	otherDocumentID := w.createMarkdownFile(t, "# foreign comment\n")

	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+otherDocumentID+"/comments", w.token, map[string]any{"body": "bình luận của tài liệu khác"})
	if res.StatusCode != 201 {
		t.Fatalf("create foreign comment: %d %v", res.StatusCode, out)
	}
	foreignCommentID := out["comment"].(map[string]any)["id"].(string)

	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default", "comment_id": foreignCommentID,
	})
	if res.StatusCode != 404 {
		t.Fatalf("foreign-document comment id = %d %v", res.StatusCode, out)
	}
	if _, ok := out["launch_ticket"]; ok {
		t.Fatalf("refused launch answered a ticket: %v", out)
	}
	var stored int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM office_launch_sessions WHERE document_id = $1", documentID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 0 {
		t.Fatalf("foreign-document comment stored %d launch rows", stored)
	}

	// Control: the same comment id on its own document is accepted.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+otherDocumentID+"/office/sessions", w.token, map[string]any{
		"operation": "view", "client_id": "uniwork-office", "deployment_id": "default", "comment_id": foreignCommentID,
	})
	if res.StatusCode != 201 {
		t.Fatalf("own-document comment id = %d %v", res.StatusCode, out)
	}
	if got, _ := out["comment_id"].(string); got != foreignCommentID {
		t.Fatalf("own-document comment echo = %q, want %q", got, foreignCommentID)
	}
}
