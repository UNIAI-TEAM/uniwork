package service

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func TestOrganizationRequireMembers(t *testing.T) {
	f := newOrgMembersFixture(t)
	if err := f.orgs.RequireMembers(f.ctx, f.org.ID, []string{f.member.ID, f.admin.ID}); err != nil {
		t.Fatal(err)
	}
	if err := f.orgs.RequireMembers(f.ctx, f.org.ID, []string{f.member.ID, util.NewID()}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unknown member: got %v", err)
	}
}
