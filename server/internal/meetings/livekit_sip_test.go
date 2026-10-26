package meetings

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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

// twirpStub answers one Twirp path with a protobuf message, or with a Twirp
// error (code, msg) when code is set; body keeps the last request.
func twirpStub(t *testing.T, path string, reply proto.Message, code, msg string) (*httptest.Server, *[]byte) {
	t.Helper()
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		if r.URL.Path != path {
			t.Errorf("unexpected call %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if code != "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"code":"` + code + `","msg":"` + msg + `"}`))
			return
		}
		out, _ := proto.Marshal(reply)
		w.Header().Set("Content-Type", "application/protobuf")
		_, _ = w.Write(out)
	}))
	t.Cleanup(srv.Close)
	return srv, &body
}

// LiveKit refuses a second rule for the same trunk and PIN with
// invalid_argument and a message naming the clash (protocol sip.go
// ValidateDispatchRules; older servers said "Conflicting SIP Dispatch
// Rules"). Only that message is a PIN conflict.
func TestCreateDialInRuleReportsAPINConflict(t *testing.T) {
	for _, msg := range []string{
		`Dispatch rule for the same trunk, inbound number, number, and PIN combination already exists in dispatch rule \"SDR_x\" \"uniwork m0\"`,
		"Conflicting SIP Dispatch Rules: same Trunk+Number+PIN combination",
	} {
		srv, _ := twirpStub(t, "/twirp/livekit.SIP/CreateSIPDispatchRule", nil, "invalid_argument", msg)
		a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
		_, err := a.CreateDialInRule(context.Background(), DialInRuleRequest{RoomName: "uw_mtg_m1", Pin: "1"})
		if !errors.Is(err, ErrDialInRuleConflict) {
			t.Fatalf("%q: err = %v, want ErrDialInRuleConflict", msg, err)
		}
	}
}

// A bad trunk id or room name is invalid_argument too, but not a clash:
// rotating the PIN would not fix it and would churn the PIN people hold.
func TestCreateDialInRuleOtherInvalidArgumentIsNoConflict(t *testing.T) {
	srv, _ := twirpStub(t, "/twirp/livekit.SIP/CreateSIPDispatchRule", nil, "invalid_argument", "trunk ST_missing not found")
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	_, err := a.CreateDialInRule(context.Background(), DialInRuleRequest{RoomName: "uw_mtg_m1", Pin: "1", TrunkID: "ST_missing"})
	if err == nil || errors.Is(err, ErrDialInRuleConflict) {
		t.Fatalf("err = %v, want a plain error", err)
	}
}

// Only the UniWork trunk's rules are listed: asked of LiveKit, and checked
// again here, since another deployment sharing the server names its rules
// "uniwork <id>" too.
func TestListDialInRulesKeepsToTheTrunk(t *testing.T) {
	at := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	srv, body := twirpStub(t, "/twirp/livekit.SIP/ListSIPDispatchRule", &livekit.ListSIPDispatchRuleResponse{Items: []*livekit.SIPDispatchRuleInfo{
		{SipDispatchRuleId: "SDR_1", Name: "uniwork m1", TrunkIds: []string{"ST_uw"}, CreatedAt: timestamppb.New(at)},
		{SipDispatchRuleId: "SDR_2", Name: "uniwork m2", TrunkIds: []string{"ST_staging"}, CreatedAt: timestamppb.New(at)},
		{SipDispatchRuleId: "SDR_3", Name: "uniwork m3"},
	}}, "", "")
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	rules, err := a.ListDialInRules(context.Background(), "ST_uw")
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 1 || rules[0].ID != "SDR_1" || rules[0].Name != "uniwork m1" || !rules[0].CreatedAt.Equal(at) {
		t.Fatalf("rules = %+v", rules)
	}
	var req livekit.ListSIPDispatchRuleRequest
	if err := proto.Unmarshal(*body, &req); err != nil || len(req.GetTrunkIds()) != 1 || req.GetTrunkIds()[0] != "ST_uw" {
		t.Fatalf("request trunks = %v err=%v", req.GetTrunkIds(), err)
	}
}

func TestListParticipantsReadsKindSIDAndGrants(t *testing.T) {
	srv, _ := twirpStub(t, "/twirp/livekit.RoomService/ListParticipants", &livekit.ListParticipantsResponse{Participants: []*livekit.ParticipantInfo{
		{Identity: "sip_ab", Sid: "PA_1", Name: "Phone 1234", Kind: livekit.ParticipantInfo_SIP,
			Attributes: map[string]string{"sip.ruleID": "SDR_1"}, Permission: &livekit.ParticipantPermission{CanSubscribe: true}},
		{Identity: "uw_participant_p1", Sid: "PA_2"},
	}}, "", "")
	a := &LiveKitAdapter{URL: srv.URL, APIKey: "k", APISecret: "api-secret-at-least-32-characters!!"}
	ps, err := a.ListParticipants(context.Background(), "uw_mtg_m1")
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || !ps[0].SIP || ps[1].SIP || ps[0].SID != "PA_1" || ps[0].Identity != "sip_ab" || ps[0].Name != "Phone 1234" ||
		ps[0].Attributes["sip.ruleID"] != "SDR_1" || !ps[0].Permissions.CanSubscribe || ps[0].Permissions.CanPublish {
		t.Fatalf("participants = %+v", ps)
	}
}
