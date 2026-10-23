package service

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// G508S-BE-7 (FIX-5): checkRenewal's revoked-row predicate, on its own. Every
// other term of the check passes in the second case below - the signature
// verifies, the claims name this user, device, document, organization and
// row, the row exists and the policy epoch matches - so only
// row.RevokedAt.Valid can refuse. The end-to-end twin is
// TestOfficeLeaseRenewRefusesRevokedRowWithLiveAccess (DB, cloud); this one
// runs everywhere and is the mutation evidence: delete the
// `row.RevokedAt.Valid ||` term in checkRenewal and this test fails.

func TestOfficeLeaseCheckRenewalRefusesARevokedRow(t *testing.T) {
	svc := &OfficeLeaseService{codec: newOfficeLeaseCodec(officeLeaseTestSecret)}
	doc := db.Document{ID: "01DOC00000000000000000000", OrganizationID: "01ORG00000000000000000000"}
	row := db.OfficeOfflineLease{
		ID: "01LEASE000000000000000000", OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		UserID: "01USER00000000000000000000", PolicyEpoch: 0,
	}
	claims := officeLeaseClaims{
		V: officeLeaseTokenVersion, KeyID: officeLeaseKeyID, LeaseID: row.ID,
		UserID: row.UserID, DeviceSessionID: "01DEVICE000000000000000000", DocumentID: doc.ID,
		OrganizationID: doc.OrganizationID,
	}
	token, err := svc.codec.sign(claims)
	if err != nil {
		t.Fatal(err)
	}

	// A live row of the current epoch passes: the token names it and nothing
	// else refuses.
	if err := svc.checkRenewal(token, row.UserID, claims.DeviceSessionID, doc, row, true, row.PolicyEpoch); err != nil {
		t.Fatalf("a live row refused a renewal: %v", err)
	}

	// The same renewal on the revoked row: only the predicate differs.
	row.RevokedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	requireLeaseCode(t, svc.checkRenewal(token, row.UserID, claims.DeviceSessionID, doc, row, true, row.PolicyEpoch), "offline_lease_revoked")
}
