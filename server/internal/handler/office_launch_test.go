package handler

import (
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
