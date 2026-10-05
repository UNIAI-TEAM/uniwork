package service

// UNI-925 B6: the per-user saved-signature store. What is under test is the
// tenant gate (members only - an outsider gets the same 404 an unknown
// organization gets), the personal scope (another member of the same
// organization shares the tenant, never the signatures), the content rules
// (label, size cap, sniffed type) and the delete that only removes the
// caller's own row.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type signatureFixture struct {
	ctx    context.Context
	svc    *SignatureService
	q      *db.Queries
	orgID  string
	owner  db.User
	second db.User
}

// newSignatureFixture builds one organization owned by `owner`; `second` is
// registered but not a member until a test says so.
func newSignatureFixture(t *testing.T) *signatureFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	authSvc := NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ctx := context.Background()
	owner := registerVerified(t, q, authSvc, "sig-owner@example.com", "Owner")
	second := registerVerified(t, q, authSvc, "sig-second@example.com", "Second")
	org, err := orgs.Create(ctx, owner.ID, "Signature Org", "signature-org")
	if err != nil {
		t.Fatal(err)
	}
	return &signatureFixture{
		ctx: ctx,
		svc: NewSignatureService(pool, q, orgs), q: q,
		orgID: org.ID, owner: owner, second: second,
	}
}

func TestSavedSignatureRoundTrip(t *testing.T) {
	f := newSignatureFixture(t)
	image := pngBody(t, 3, 2)

	row, err := f.svc.SaveSignature(f.ctx, Human(f.owner.ID), f.orgID, SaveSignatureInput{
		Label: "  Chữ ký của tôi  ", ContentType: "image/png", Image: image,
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.ID == "" || row.Label != "Chữ ký của tôi" || row.ContentType != "image/png" || !bytes.Equal(row.Image, image) {
		t.Fatalf("saved row = %+v", row)
	}
	if !row.CreatedAt.Valid || row.CreatedAt.Time.IsZero() {
		t.Fatalf("created_at = %+v", row.CreatedAt)
	}

	list, err := f.svc.ListSavedSignatures(f.ctx, Human(f.owner.ID), f.orgID)
	if err != nil || len(list) != 1 || list[0].ID != row.ID {
		t.Fatalf("list = %+v, %v", list, err)
	}

	// A second member of the same organization shares the tenant but not the
	// signatures: their list is empty, the owner's row is not theirs to
	// delete, and their own save is a separate row.
	addOrgMember(t, f.q, f.orgID, f.second.ID)
	if list, err := f.svc.ListSavedSignatures(f.ctx, Human(f.second.ID), f.orgID); err != nil || len(list) != 0 {
		t.Fatalf("second member list = %+v, %v", list, err)
	}
	if err := f.svc.DeleteSavedSignature(f.ctx, Human(f.second.ID), f.orgID, row.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second member delete = %v, want ErrNotFound", err)
	}
	secondRow, err := f.svc.SaveSignature(f.ctx, Human(f.second.ID), f.orgID, SaveSignatureInput{
		Label: "Chữ ký khác", ContentType: "image/png", Image: pngBody(t, 2, 2),
	})
	if err != nil || secondRow.ID == row.ID {
		t.Fatalf("second save = %+v, %v", secondRow, err)
	}

	// Delete removes only the owner's row; the repeat is ErrNotFound.
	if err := f.svc.DeleteSavedSignature(f.ctx, Human(f.owner.ID), f.orgID, row.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.DeleteSavedSignature(f.ctx, Human(f.owner.ID), f.orgID, row.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete = %v, want ErrNotFound", err)
	}
	if list, err := f.svc.ListSavedSignatures(f.ctx, Human(f.owner.ID), f.orgID); err != nil || len(list) != 0 {
		t.Fatalf("list after delete = %+v, %v", list, err)
	}
	if list, err := f.svc.ListSavedSignatures(f.ctx, Human(f.second.ID), f.orgID); err != nil || len(list) != 1 {
		t.Fatalf("second list after owner delete = %+v, %v", list, err)
	}
}

func TestSavedSignatureValidatesInput(t *testing.T) {
	f := newSignatureFixture(t)
	actor := Human(f.owner.ID)
	good := pngBody(t, 2, 2)

	cases := []struct {
		name string
		in   SaveSignatureInput
	}{
		{"empty label", SaveSignatureInput{Label: "   ", ContentType: "image/png", Image: good}},
		{"long label", SaveSignatureInput{Label: strings.Repeat("a", maxSignatureLabel+1), ContentType: "image/png", Image: good}},
		{"unknown content type", SaveSignatureInput{Label: "x", ContentType: "image/webp", Image: good}},
		{"empty image", SaveSignatureInput{Label: "x", ContentType: "image/png"}},
		{"declared type does not match bytes", SaveSignatureInput{Label: "x", ContentType: "image/jpeg", Image: good}},
		{"over the cap", SaveSignatureInput{Label: "x", ContentType: "image/png", Image: bytes.Repeat([]byte{0x89}, MaxSignatureBytes+1)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.svc.SaveSignature(f.ctx, actor, f.orgID, tc.in)
			var ve ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
		})
	}
	if list, err := f.svc.ListSavedSignatures(f.ctx, actor, f.orgID); err != nil || len(list) != 0 {
		t.Fatalf("nothing may be stored: %+v, %v", list, err)
	}
}

// TestSavedSignaturePerUserCap pins the per-user cap: a full list refuses the
// next create with a typed validation error and stores nothing, and freeing a
// slot lets the same person save again. The count is per (organization, user),
// so it never blocks a second member.
func TestSavedSignaturePerUserCap(t *testing.T) {
	f := newSignatureFixture(t)
	actor := Human(f.owner.ID)
	save := func(label string) (db.CreateSavedSignatureRow, error) {
		return f.svc.SaveSignature(f.ctx, actor, f.orgID, SaveSignatureInput{
			Label: label, ContentType: "image/png", Image: pngBody(t, 2, 2),
		})
	}

	for i := 0; i < MaxSavedSignaturesPerUser; i++ {
		if _, err := save(fmt.Sprintf("Chữ ký %d", i)); err != nil {
			t.Fatalf("save %d: %v", i, err)
		}
	}

	_, err := save("Vượt hạn mức")
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("over-cap save = %v, want ValidationError", err)
	}
	list, err := f.svc.ListSavedSignatures(f.ctx, actor, f.orgID)
	if err != nil || len(list) != MaxSavedSignaturesPerUser {
		t.Fatalf("list at the cap = %d, %v; want %d", len(list), err, MaxSavedSignaturesPerUser)
	}

	// Freeing one slot lets the next create through, so the cap is a live
	// bound rather than a one-way lockout.
	if err := f.svc.DeleteSavedSignature(f.ctx, actor, f.orgID, list[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := save("Sau khi xóa"); err != nil {
		t.Fatalf("save after freeing a slot: %v", err)
	}

	// A second member of the same organization has their own count.
	addOrgMember(t, f.q, f.orgID, f.second.ID)
	if _, err := f.svc.SaveSignature(f.ctx, Human(f.second.ID), f.orgID, SaveSignatureInput{
		Label: "Chữ ký thành viên", ContentType: "image/png", Image: pngBody(t, 2, 2),
	}); err != nil {
		t.Fatalf("second member save: %v", err)
	}
}

func TestSavedSignatureTenantGate(t *testing.T) {
	f := newSignatureFixture(t)
	image := pngBody(t, 2, 2)

	// Not a member of the organization: every command answers the same 404
	// an unknown organization would, so the organization cannot be probed.
	outsider := Human(f.second.ID)
	if _, err := f.svc.ListSavedSignatures(f.ctx, outsider, f.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider list = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.SaveSignature(f.ctx, outsider, f.orgID, SaveSignatureInput{Label: "x", ContentType: "image/png", Image: image}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider save = %v, want ErrNotFound", err)
	}
	if err := f.svc.DeleteSavedSignature(f.ctx, outsider, f.orgID, "01K6SIGN1P2Q3R4S5T6U7V8YA"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider delete = %v, want ErrNotFound", err)
	}

	// Anonymous and agent actors never read or write a personal signature.
	if _, err := f.svc.ListSavedSignatures(f.ctx, Actor{}, f.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("anonymous list = %v, want ErrNotFound", err)
	}
	agent := Actor{Kind: audit.KindAgent, ID: f.owner.ID}
	if _, err := f.svc.SaveSignature(f.ctx, agent, f.orgID, SaveSignatureInput{Label: "x", ContentType: "image/png", Image: image}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent save = %v, want ErrForbidden", err)
	}
}
