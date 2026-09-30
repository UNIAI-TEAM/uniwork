package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
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
