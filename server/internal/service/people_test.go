package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type peopleFixture struct {
	ctx    context.Context
	pool   *pgxpool.Pool
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
		ctx: context.Background(), pool: pool, q: q, orgs: orgs, auth: as,
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
	n, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{}, &buf)
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
	if _, err := f.people.ExportCSV(f.ctx, f.member.ID, f.org.ID, PeopleFilter{}, io.Discard); !errors.Is(err, ErrForbidden) {
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
	if _, err := f.people.ExportCSV(f.ctx, f.other.ID, f.org.ID, PeopleFilter{}, io.Discard); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider export: got %v", err)
	}
}

// addPeopleMember registers a verified user and makes them a plain member of
// the fixture's organization, profile row included.
func (f *peopleFixture) addPeopleMember(t *testing.T, email, name string) db.User {
	t.Helper()
	u := registerVerified(t, f.q, f.auth, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: u.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	if err := ensureMemberProfile(f.ctx, f.q, f.org.ID, u.ID, u.DisplayName, u.Email); err != nil {
		t.Fatal(err)
	}
	return u
}

func (f *peopleFixture) deactivate(t *testing.T, userID string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		f.org.ID, userID); err != nil {
		t.Fatal(err)
	}
}

func personNames(people []PersonView) []string {
	out := make([]string, 0, len(people))
	for _, p := range people {
		out = append(out, p.DisplayName)
	}
	return out
}

// The directory reads the way a Vietnamese reader expects: by given name (the
// last word), with Đ right after D rather than after Z, and the full name then
// the id breaking ties. The keyset cursor walks the same order across pages.
func TestSearchOrdersByVietnameseGivenName(t *testing.T) {
	f := newPeopleFixture(t)
	// Fixture already holds "Đỗ Thị Hà" (owner) and "Nguyễn Văn Ân" (member).
	for i, name := range []string{"Vũ Văn Anh", "Đặng Thị Bình", "Dương Minh Đức", "Trần Văn Dũng", "Lê Văn Ân", "Phạm Zin", "Bùi Thị Hà"} {
		f.addPeopleMember(t, fmt.Sprintf("p%d@example.com", i), name)
	}
	want := []string{
		"Vũ Văn Anh",                 // A before Â: the Vietnamese alphabet, not byte order
		"Lê Văn Ân", "Nguyễn Văn Ân", // same given name: full name decides, L < N
		"Đặng Thị Bình", // Đ-surname does not push the row to the end
		"Trần Văn Dũng", // D given name before Đ given name
		"Dương Minh Đức",
		"Bùi Thị Hà", "Đỗ Thị Hà", // tie on given name: B < Đ
		"Phạm Zin",
	}
	var got []string
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > len(want) {
			t.Fatal("the cursor never reached the end")
		}
		page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Limit: 2, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != int64(len(want)) {
			t.Fatalf("total %d, want %d", page.Total, len(want))
		}
		got = append(got, personNames(page.People)...)
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if !slices.Equal(got, want) {
		t.Fatalf("directory order across pages:\n got %q\nwant %q", got, want)
	}
	// Direct reports and the export follow the same order.
	for _, name := range []string{"Vũ Văn Anh", "Đặng Thị Bình", "Lê Văn Ân"} {
		for _, p := range mustSearch(t, f, PeopleFilter{Query: name}).People {
			if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, p.UserID, ProfileInput{ManagerID: &f.owner.ID}); err != nil {
				t.Fatal(err)
			}
		}
	}
	_, reports, err := f.people.Get(f.ctx, f.owner.ID, f.org.ID, f.owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	var reportNames []string
	for _, r := range reports {
		reportNames = append(reportNames, r.DisplayName)
	}
	if w := []string{"Vũ Văn Anh", "Lê Văn Ân", "Đặng Thị Bình"}; !slices.Equal(reportNames, w) {
		t.Fatalf("reports order: got %q want %q", reportNames, w)
	}
	records := exportRecords(t, f, PeopleFilter{})
	var exported []string
	for _, r := range records[1:] {
		exported = append(exported, r[0])
	}
	if !slices.Equal(exported, want) {
		t.Fatalf("export order:\n got %q\nwant %q", exported, want)
	}
}

func mustSearch(t *testing.T, f *peopleFixture, filter PeopleFilter) PeoplePage {
	t.Helper()
	page, err := f.people.Search(f.ctx, f.owner.ID, f.org.ID, filter)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

// Total counts what the filters match across every page; TotalActive stays
// the organization's headcount whatever the filters say.
func TestSearchTotalFollowsTheFilters(t *testing.T) {
	f := newPeopleFixture(t)
	d, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật"), Code: strptr("eng")})
	if err != nil {
		t.Fatal(err)
	}
	gone := f.addPeopleMember(t, "gone@example.com", "Trần Văn Rời")
	f.addPeopleMember(t, "third@example.com", "Lê Thị Ba")
	f.deactivate(t, gone.ID)
	for _, id := range []string{f.member.ID, gone.ID} {
		if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, id, ProfileInput{DepartmentID: &d.ID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []struct {
		name   string
		filter PeopleFilter
		total  int64
		rows   int
	}{
		{"default is active", PeopleFilter{}, 3, 3},
		{"all", PeopleFilter{Status: MemberStatusAll}, 4, 2},
		{"deactivated", PeopleFilter{Status: MemberStatusDeactivated}, 1, 1},
		{"department, active", PeopleFilter{DepartmentID: d.ID}, 1, 1},
		{"department, all", PeopleFilter{DepartmentID: d.ID, Status: MemberStatusAll}, 2, 2},
		{"query", PeopleFilter{Query: "tran van", Status: MemberStatusAll}, 1, 1},
		{"query, active", PeopleFilter{Query: "tran van"}, 0, 0},
		{"role", PeopleFilter{Role: OrgRoleOwner}, 1, 1},
	} {
		limit := int32(0)
		if c.name == "all" {
			limit = 2 // Total counts past the page
		}
		c.filter.Limit = limit
		page := mustSearch(t, f, c.filter)
		if page.Total != c.total || len(page.People) != c.rows || page.TotalActive != 3 {
			t.Errorf("%s: total %d rows %d active %d, want total %d rows %d active 3",
				c.name, page.Total, len(page.People), page.TotalActive, c.total, c.rows)
		}
	}
}

func exportRecords(t *testing.T, f *peopleFixture, filter PeopleFilter) [][]string {
	t.Helper()
	var buf bytes.Buffer
	if _, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.org.ID, filter, &buf); err != nil {
		t.Fatal(err)
	}
	records, err := csv.NewReader(bytes.NewReader(buf.Bytes()[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return records
}

// The export takes a copy of what the directory shows: the same filters, except
// that no status means everyone, active and deactivated.
func TestExportCSVHonoursTheDirectoryFilters(t *testing.T) {
	f := newPeopleFixture(t)
	d, err := f.depts.Create(f.ctx, f.owner.ID, f.org.ID, DepartmentInput{Name: strptr("Kỹ thuật"), Code: strptr("eng")})
	if err != nil {
		t.Fatal(err)
	}
	gone := f.addPeopleMember(t, "gone@example.com", "Trần Văn Rời")
	f.deactivate(t, gone.ID)
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.org.ID, f.member.ID, ProfileInput{DepartmentID: &d.ID}); err != nil {
		t.Fatal(err)
	}
	names := func(records [][]string) []string {
		var out []string
		for _, r := range records[1:] {
			out = append(out, r[0])
		}
		return out
	}
	for _, c := range []struct {
		name   string
		filter PeopleFilter
		want   []string
	}{
		{"no filter exports everyone", PeopleFilter{}, []string{"Nguyễn Văn Ân", "Đỗ Thị Hà", "Trần Văn Rời"}},
		{"active", PeopleFilter{Status: MemberStatusActive}, []string{"Nguyễn Văn Ân", "Đỗ Thị Hà"}},
		{"deactivated", PeopleFilter{Status: MemberStatusDeactivated}, []string{"Trần Văn Rời"}},
		{"department", PeopleFilter{DepartmentID: d.ID}, []string{"Nguyễn Văn Ân"}},
		{"query", PeopleFilter{Query: "do thi"}, []string{"Đỗ Thị Hà"}},
		{"role", PeopleFilter{Role: OrgRoleMember}, []string{"Nguyễn Văn Ân", "Trần Văn Rời"}},
	} {
		if got := names(exportRecords(t, f, c.filter)); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
	// A bad filter is refused before anything is written, and only after the
	// caller is known to be an exporter.
	var buf bytes.Buffer
	if _, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Status: "gone"}, &buf); err == nil || buf.Len() != 0 {
		t.Fatalf("bad status: err %v, %d bytes written", err, buf.Len())
	}
	if err := f.people.RequireExporter(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{Role: "boss"}); err == nil {
		t.Fatal("bad role accepted")
	}
	if err := f.people.RequireExporter(f.ctx, f.member.ID, f.org.ID, PeopleFilter{Role: "boss"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member with a bad filter: got %v, want forbidden", err)
	}
	// The audit row records the filter the copy was taken with.
	if _, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.org.ID, PeopleFilter{DepartmentID: d.ID, Query: " nguyen "}, io.Discard); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT metadata FROM audit_events
		WHERE organization_id = $1 AND action = 'people.exported' ORDER BY occurred_at DESC, id DESC LIMIT 1`, f.org.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta struct {
		RowCount int               `json:"row_count"`
		Filters  map[string]string `json:"filters"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.RowCount != 1 || meta.Filters["status"] != MemberStatusAll || meta.Filters["department_id"] != d.ID ||
		meta.Filters["q"] != "nguyen" || len(meta.Filters) != 3 {
		t.Fatalf("audit metadata: %s", raw)
	}
}
