package service

import "testing"

func TestParseMcpScope(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"", "read", true},
		{"read", "read", true},
		{"write", "read write", true},
		{"read write", "read write", true},
		{"write read", "read write", true},
		{"  read   write ", "read write", true},
		{"admin", "", false},
		{"read admin", "", false},
	}
	for _, c := range cases {
		got, ok := parseMcpScope(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("parseMcpScope(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
	if !mcpScopeHasWrite("read write") || mcpScopeHasWrite("read") || mcpScopeHasWrite("") {
		t.Fatal("mcpScopeHasWrite misreads a stored scope")
	}
}

// An AI app that asks for write opens an attempt that records "read write";
// whether the grant gets it is decided later, on the consent page.
func TestStartRecordsTheWriteScope(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", Scope: "write"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := w.q.GetMcpAuthAttempt(w.ctx, attemptID(t, to))
	if err != nil {
		t.Fatal(err)
	}
	if row.Scope != "read write" {
		t.Fatalf("attempt scope = %q, want read write", row.Scope)
	}
}
