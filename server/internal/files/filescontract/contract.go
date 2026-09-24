// Package filescontract is the shared FileService contract suite. filesfake
// passes it at Gate A0 and the real FileService passes the same cases at Gate
// B/C, so a module may rely only on behaviour that has a case here (FS-C1
// section 8: no case, no reliance).
//
// Run(t, factory) builds a fresh implementation per case and drives it through
// the section 4 interface, the section 7 errors and the state machine of
// section 7. A case asserts only what the contract states; when the contract
// leaves something to the implementation, the case says so in its comment
// instead of pinning a private detail.
package filescontract

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Harness is one isolated implementation plus the controls a case needs. A
// factory returns a new Harness per case: cases must not share state, because
// one of them crosses the 24 hour claim window and another shuts storage down.
type Harness struct {
	// Service is the implementation under test.
	Service files.Service
	// Registry is the purpose table that implementation validates against, so
	// a case reads the same caps, allowlists and read modes it enforces.
	Registry files.Registry

	// InTx runs fn with the transaction handle ClaimInTx and ReleaseInTx take:
	// the module's own q.WithTx(tx). Committing on a nil error and rolling back
	// on any other error is the whole point of the signature - a rolled-back
	// module transaction must leave the files staged. filesfake models it with
	// Snapshot/Restore. Required.
	InTx func(t *testing.T, fn func(q *db.Queries) error) error

	// Now is the implementation's clock, and Advance moves it. Required: the
	// 24 hour claim window and the 12 hour URL limit are contract behaviour,
	// and a test must not sleep to reach them.
	Now     func() time.Time
	Advance func(d time.Duration)

	// WriteProviderOutput delivers the bytes a provider would PUT to
	// out.WriteTarget. filesfake writes into its own memory; an implementation
	// backed by storage sends the PUT the target describes. Required.
	WriteProviderOutput func(t *testing.T, out files.ProviderOutput, body []byte, contentType string)

	// DisabledPurpose names a purpose the enum declares and this registry
	// refuses. Optional: when empty, the disabled-purpose case skips, which is
	// what a registry with every purpose open (filesfake default) does.
	DisabledPurpose files.UploadPurpose

	// SimulateGC moves the named files past the collector's barrier so a case
	// can observe file_deleting. Optional: an implementation with no way to
	// force the collector skips those cases.
	SimulateGC func(t *testing.T, ids ...files.FileID)

	// SetStorageDown injects an adapter failure. Optional: without it, the
	// storage_unavailable case skips.
	SetStorageDown func(t *testing.T, down bool)
}

// Factory builds one Harness per case.
type Factory interface {
	New(t *testing.T) Harness
}

// FactoryFunc adapts a function to Factory.
type FactoryFunc func(t *testing.T) Harness

// New implements Factory.
func (f FactoryFunc) New(t *testing.T) Harness { return f(t) }

type contractCase struct {
	name string
	run  func(t *testing.T, h Harness)
}

// Run drives every contract case against a fresh Harness.
func Run(t *testing.T, factory Factory) {
	t.Helper()
	if factory == nil {
		t.Fatal("filescontract: nil factory")
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := factory.New(t)
			if h.Service == nil {
				t.Fatal("filescontract: harness has no Service")
			}
			if h.InTx == nil {
				t.Fatal("filescontract: harness has no InTx")
			}
			if h.Now == nil || h.Advance == nil {
				t.Fatal("filescontract: harness has no clock")
			}
			if h.WriteProviderOutput == nil {
				t.Fatal("filescontract: harness cannot write provider output")
			}
			c.run(t, h)
		})
	}
}
