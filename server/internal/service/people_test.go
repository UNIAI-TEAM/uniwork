package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type peopleFixture struct {
	ctx    context.Context
	q      *db.Queries
	orgs   *OrganizationService
	people *PeopleService
	depts  *DepartmentService
	auth   *AuthService
	org    db.Organization
	owner  db.User
	member db.User
	other  db.User
}

func newPeopleFixture(t *testing.T) *peopleFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	f := &peopleFixture{
		ctx: context.Background(), q: q, orgs: orgs, auth: as,
		people: NewPeopleService(pool, q, orgs),
		depts:  NewDepartmentService(pool, q, orgs),
	}
	f.owner = registerVerified(t, q, as, "chu@example.com", "Đỗ Thị Hà")
	f.member = registerVerified(t, q, as, "an@example.com", "Nguyễn Văn Ân")
	f.other = registerVerified(t, q, as, "ngoai@example.com", "Người Ngoài")
	o, err := orgs.Create(f.ctx, f.owner.ID, "Unicom", "unicom")
	if err != nil {
		t.Fatal(err)
	}
	f.org = o
	if err := q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: o.ID, UserID: f.member.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	if err := ensureMemberProfile(f.ctx, q, o.ID, f.member.ID, f.member.DisplayName, f.member.Email); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestSearchFindsPeopleWithAndWithoutDiacritics(t *testing.T) {
	f := newPeopleFixture(t)
	for _, query := range []string{"Nguyễn Văn Ân", "nguyen van an", "VAN AN", "an@example.com"} {
		page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: query})
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		if len(page.People) != 1 || page.People[0].UserID != f.member.ID {
			t.Fatalf("search %q returned %d rows", query, len(page.People))
		}
	}
	// A single character is too broad to be a search; it is ignored, so the
	// whole directory comes back rather than an arbitrary subset.
	page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.People) != 2 || page.TotalActive != 2 {
		t.Fatalf("one-character query: %d rows, total %d", len(page.People), page.TotalActive)
	}
	if _, err := f.people.Search(f.ctx, f.other.ID, f.org.ID, PeopleFilter{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider search: got %v", err)
	}
}

func TestSearchFollowsTitleAndDepartmentRenames(t *testing.T) {
	f := newPeopleFixture(t)
	d, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật"), Code: strptr("eng")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		Title: strptr("Trưởng nhóm"), DepartmentID: &d.ID,
	}); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"truong nhom", "ky thuat"} {
		page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: query})
		if err != nil || len(page.People) != 1 {
			t.Fatalf("search %q: %v, %d rows", query, err, len(page.People))
		}
	}
	// Renaming the department has to reach the profiles it names, or the
	// person stays findable only under the old name.
	if _, err := f.depts.Update(f.ctx, f.owner.ID, f.org.ID, d.ID, DepartmentInput{Name: strptr("Công nghệ")}); err != nil {
		t.Fatal(err)
	}
	page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: "cong nghe"})
	if err != nil || len(page.People) != 1 {
		t.Fatalf("after department rename: %v, %d rows", err, len(page.People))
	}
	page, err = f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: "ky thuat"})
	if err != nil || len(page.People) != 0 {
		t.Fatalf("old department name still matches: %v, %d rows", err, len(page.People))
	}
	// A person renaming themselves has the same effect, in every organization.
	newName := "Trần Quốc Đạt"
	if _, err := f.auth.UpdateProfile(f.ctx, f.member.ID, &newName, nil, nil); err != nil {
		t.Fatal(err)
	}
	page, err = f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Query: "quoc dat"})
	if err != nil || len(page.People) != 1 {
		t.Fatalf("after self rename: %v, %d rows", err, len(page.People))
	}
}

func TestProfileFieldsSplitBetweenSelfAndAdmin(t *testing.T) {
	f := newPeopleFixture(t)
	// A person owns what they say about themselves.
	if _, err := f.people.UpdateProfile(f.ctx, f.member.ID, f.org.ID, f.member.ID, ProfileInput{
		Title: strptr("Kỹ sư"), Bio: strptr("Thích Go"), Phone: strptr("0900000000"),
	}); err != nil {
		t.Fatalf("self edit: %v", err)
	}
	// The company owns the facts it asserts about them.
	code := "NV001"
	if _, err := f.people.UpdateProfile(f.ctx, f.member.ID, f.org.ID, f.member.ID, ProfileInput{
		EmployeeCode: &code,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("self setting employee_code: got %v, want forbidden", err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.member.ID, f.org.ID, f.owner.ID, ProfileInput{
		Title: strptr("Chủ tịch"),
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member editing someone else: got %v, want forbidden", err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		EmployeeCode: &code, JoinedOn: strptr("2026-01-15"),
	}); err != nil {
		t.Fatalf("admin edit: %v", err)
	}
	// Employee codes are unique inside one organization.
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.owner.ID, ProfileInput{
		EmployeeCode: &code,
	}); err == nil {
		t.Fatal("a duplicate employee code was accepted")
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		JoinedOn: strptr("15/01/2026"),
	}); err == nil {
		t.Fatal("a non-ISO date was accepted")
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		Bio: strptr(strings.Repeat("x", 501)),
	}); err == nil {
		t.Fatal("an over-long bio was accepted")
	}
}

func TestPhoneIsHiddenUntilItsOwnerPublishesIt(t *testing.T) {
	f := newPeopleFixture(t)
	if _, err := f.people.UpdateProfile(f.ctx, f.member.ID, f.org.ID, f.member.ID, ProfileInput{
		Phone: strptr("0900000000"),
	}); err != nil {
		t.Fatal(err)
	}
	peer := registerVerified(t, f.q, f.auth, "peer@example.com", "Đồng nghiệp")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: peer.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	hidden, _, err := f.people.Get(f.ctx, peer.ID, f.org.ID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if hidden.Phone != "" {
		t.Fatal("a colleague saw a phone number its owner had not published (OPEN_QUESTIONS P3)")
	}
	// Self and the administrators always see it: they are the ones who can
	// change it.
	own, _, err := f.people.Get(f.ctx, f.member.ID, f.org.ID, f.member.ID)
	if err != nil || own.Phone != "0900000000" {
		t.Fatalf("self view: %v phone=%q", err, own.Phone)
	}
	admin, _, err := f.people.Get(f.ctx, f.owner.ID, f.org.ID, f.member.ID)
	if err != nil || admin.Phone != "0900000000" {
		t.Fatalf("owner view: %v phone=%q", err, admin.Phone)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.member.ID, f.org.ID, f.member.ID, ProfileInput{
		PhoneVisible: boolptr(true),
	}); err != nil {
		t.Fatal(err)
	}
	shown, _, err := f.people.Get(f.ctx, peer.ID, f.org.ID, f.member.ID)
	if err != nil || shown.Phone != "0900000000" {
		t.Fatalf("after publishing: %v phone=%q", err, shown.Phone)
	}
}

func TestManagerAndReports(t *testing.T) {
	f := newPeopleFixture(t)
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		ManagerID: &f.owner.ID,
	}); err != nil {
		t.Fatal(err)
	}
	_, reports, err := f.people.Get(f.ctx, f.owner.ID, f.org.ID, f.owner.ID)
	if err != nil || len(reports) != 1 || reports[0].ID != f.member.ID {
		t.Fatalf("reports: %v %+v", err, reports)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		ManagerID: &f.member.ID,
	}); err == nil {
		t.Fatal("a person was allowed to manage themselves")
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		ManagerID: &f.other.ID,
	}); err == nil {
		t.Fatal("a non-member was accepted as a manager")
	}
	// Filtering by manager is how the org chart is read one level at a time.
	page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{ManagerID: f.owner.ID})
	if err != nil || len(page.People) != 1 || page.People[0].UserID != f.member.ID {
		t.Fatalf("manager filter: %v %d rows", err, len(page.People))
	}
}

func strptr(s string) *string { return &s }
func boolptr(b bool) *bool    { return &b }

func TestExportCSVCarriesABOMAndOneRowPerPerson(t *testing.T) {
	f := newPeopleFixture(t)
	var buf bytes.Buffer
	n, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.org.ID, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("exported %d rows, want 2", n)
	}
	out := buf.Bytes()
	if len(out) < 3 || out[0] != 0xEF || out[1] != 0xBB || out[2] != 0xBF {
		t.Fatal("the CSV has no UTF-8 BOM; Excel would read the Vietnamese names as Windows-1252")
	}
	records, err := csv.NewReader(bytes.NewReader(out[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 3 || records[0][0] != "display_name" {
		t.Fatalf("csv shape: %v", records)
	}
	if !strings.Contains(string(out), "Nguyễn Văn Ân") {
		t.Fatal("the export lost the diacritics it was written to preserve")
	}
	// The directory is readable by everyone; taking a copy of it is not.
	if _, err := f.people.ExportCSV(f.ctx, f.member.ID, f.org.ID, io.Discard); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member export: got %v, want forbidden", err)
	}
}

func TestOneOrganizationCannotReachAnother(t *testing.T) {
	f := newPeopleFixture(t)
	// A second organization with its own owner, its own department and its own
	// people. Nothing about the first organization is reachable from it.
	other, err := f.orgs.Create(f.ctx, f.other.ID, "Khác", "khac-tenant")
	if err != nil {
		t.Fatal(err)
	}
	mine, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật")})
	if err != nil {
		t.Fatal(err)
	}

	// Reading across the boundary is refused, not filtered.
	if _, err := f.people.Search(f.ctx, f.other.ID, f.org.ID, PeopleFilter{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider search: got %v", err)
	}
	if _, _, err := f.people.Get(f.ctx, f.other.ID, f.org.ID, f.member.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider profile read: got %v", err)
	}
	if _, err := f.depts.List(f.ctx, f.other.ID, f.org.ID, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider department list: got %v", err)
	}
	// Being an owner elsewhere buys nothing here.
	if _, err := f.people.UpdateProfile(f.ctx, f.other.ID, f.org.ID, f.member.ID, ProfileInput{
		Title: strptr("Kẻ xâm nhập"),
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider profile write: got %v", err)
	}
	// A person from the other organization is not a directory entry here.
	if _, _, err := f.people.Get(f.ctx, f.owner.ID, f.org.ID, f.other.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reading a stranger: got %v", err)
	}
	// A department id is only meaningful inside its own organization, so it
	// cannot be assigned across the boundary in either direction.
	if _, err := f.depts.Update(f.ctx, f.other.ID, other.ID, mine.ID, DepartmentInput{Name: strptr("Cướp")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("editing another organization's department: got %v", err)
	}
	theirs, err := f.depts.Create(f.ctx, f.other.ID, other.ID, DepartmentInput{Name: strptr("Của họ")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{
		DepartmentID: &theirs.ID,
	}); err == nil {
		t.Fatal("a member was filed under another organization's department")
	}
	// And the export stops at the boundary too.
	if _, err := f.people.ExportCSV(f.ctx, f.other.ID, f.org.ID, io.Discard); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider export: got %v", err)
	}
}
