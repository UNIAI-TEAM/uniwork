package audit

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A write Ask UNI's executor ran names the proposal it ran for, and only that;
// an MCP write keeps the four keys it always had (R13).
func TestRecordWritesTheViaOfAnAskUniProposal(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	write := func(resourceID string, v Via) map[string]any {
		t.Helper()
		e := entry()
		e.ResourceID = resourceID
		if err := NewRecorder().Record(WithVia(ctx, v), q, e); err != nil {
			t.Fatal(err)
		}
		var raw string
		if err := pool.QueryRow(ctx, `SELECT metadata::jsonb->>'via' FROM audit_events WHERE resource_id = $1`, resourceID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var via map[string]any
		if err := json.Unmarshal([]byte(raw), &via); err != nil {
			t.Fatal(err)
		}
		return via
	}
	ask := write("t-ask", Via{Kind: "ask_uni", ProposalID: "p1"})
	if len(ask) != 2 || ask["kind"] != "ask_uni" || ask["proposal_id"] != "p1" {
		t.Fatalf("ask uni via = %v, want {kind: ask_uni, proposal_id: p1}", ask)
	}
	mcp := write("t-mcp", Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"})
	if len(mcp) != 4 || mcp["kind"] != "mcp" || mcp["client_id"] != "c1" || mcp["grant_id"] != "g1" || mcp["client_name"] != "Claude" {
		t.Fatalf("mcp via = %v, want its four keys", mcp)
	}
}
