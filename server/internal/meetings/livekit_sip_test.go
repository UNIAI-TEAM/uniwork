package meetings

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/proto"
)

// fakeLiveKitSIP answers the two SIP Twirp calls the adapter makes and keeps
// what it was sent; deleteStatus is the HTTP status of the delete answer.
func fakeLiveKitSIP(t *testing.T, deleteStatus int) (*httptest.Server, *livekit.CreateSIPDispatchRuleRequest, *livekit.DeleteSIPDispatchRuleRequest) {
	t.Helper()
	created, deleted := &livekit.CreateSIPDispatchRuleRequest{}, &livekit.DeleteSIPDispatchRuleRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Errorf("%s without a signed token", r.URL.Path)
		}
		switch r.URL.Path {
		case "/twirp/livekit.SIP/CreateSIPDispatchRule":
			if err := proto.Unmarshal(body, created); err != nil {
				t.Errorf("create body: %v", err)
			}
			out, _ := proto.Marshal(&livekit.SIPDispatchRuleInfo{SipDispatchRuleId: "SDR_test"})
			w.Header().Set("Content-Type", "application/protobuf")
			_, _ = w.Write(out)
		case "/twirp/livekit.SIP/DeleteSIPDispatchRule":
			if err := proto.Unmarshal(body, deleted); err != nil {
				t.Errorf("delete body: %v", err)
			}
			if deleteStatus != http.StatusOK {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(deleteStatus)
				code := "internal"
				if deleteStatus == http.StatusNotFound {
					code = "not_found"
				}
				_, _ = w.Write([]byte(`{"code":"` + code + `","msg":"refused"}`))
				return
			}
			out, _ := proto.Marshal(&livekit.SIPDispatchRuleInfo{SipDispatchRuleId: deleted.SipDispatchRuleId})
			w.Header().Set("Content-Type", "application/protobuf")
			_, _ = w.Write(out)
		default:
			t.Errorf("unexpected call %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, created, deleted
}

// The rule routes one PIN into one room, only on the UniWork trunk, and
// keeps the caller's number out of the room (identity and name are masked).
func TestCreateDialInRuleSendsADirectRuleWithThePIN(t *testing.T) {
	srv, created, _ := fakeLiveKitSIP(t, http.StatusOK)
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	id, err := a.CreateDialInRule(context.Background(), DialInRuleRequest{
		RoomName: "uw_mtg_m1", Pin: "042137", TrunkID: "ST_uniwork", Name: "uniwork m1",
	})
	if err != nil || id != "SDR_test" {
		t.Fatalf("id=%q err=%v", id, err)
	}
	direct := created.GetDispatchRule().GetRule().GetDispatchRuleDirect()
	if direct.GetRoomName() != "uw_mtg_m1" || direct.GetPin() != "042137" {
		t.Fatalf("rule = %+v", created.GetDispatchRule().GetRule())
	}
	if !created.GetDispatchRule().GetHidePhoneNumber() {
		t.Fatal("the rule must hide the caller's number")
	}
	if got := created.GetDispatchRule().GetTrunkIds(); len(got) != 1 || got[0] != "ST_uniwork" {
		t.Fatalf("trunks = %v", got)
	}
	if created.GetDispatchRule().GetName() != "uniwork m1" {
		t.Fatalf("name = %q", created.GetDispatchRule().GetName())
	}
}

func TestCreateDialInRuleWithoutTrunkLeavesTrunksOpen(t *testing.T) {
	srv, created, _ := fakeLiveKitSIP(t, http.StatusOK)
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	if _, err := a.CreateDialInRule(context.Background(), DialInRuleRequest{RoomName: "uw_mtg_m1", Pin: "1"}); err != nil {
		t.Fatal(err)
	}
	if len(created.GetDispatchRule().GetTrunkIds()) != 0 {
		t.Fatalf("trunks = %v", created.GetDispatchRule().GetTrunkIds())
	}
}

// A rule already gone (deleted by hand, or by an earlier try) is deleted.
func TestDeleteDialInRuleTreatsNotFoundAsDone(t *testing.T) {
	srv, _, deleted := fakeLiveKitSIP(t, http.StatusNotFound)
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	if err := a.DeleteDialInRule(context.Background(), "SDR_gone"); err != nil {
		t.Fatalf("not found = %v", err)
	}
	if deleted.GetSipDispatchRuleId() != "SDR_gone" {
		t.Fatalf("deleted %q", deleted.GetSipDispatchRuleId())
	}
}

func TestDeleteDialInRuleReportsOtherFailures(t *testing.T) {
	srv, _, _ := fakeLiveKitSIP(t, http.StatusInternalServerError)
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	if err := a.DeleteDialInRule(context.Background(), "SDR_x"); err == nil {
		t.Fatal("a failed delete reported success")
	}
}
