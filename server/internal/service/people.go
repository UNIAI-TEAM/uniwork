package service

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// minSearchQuery: one character matches most of the company and makes the
	// trigram index useless, so the directory ignores it.
	minSearchQuery = 2
	maxBioLength   = 500
	// maxExportRows caps the CSV so one click cannot stream a million rows
	// (spec F-03 §2 decision 7).
	maxExportRows = 10000
)

// PeopleService owns the profile side of Organization & People: the directory,
// one person's profile, and the search text both are read through.
type PeopleService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
}

func NewPeopleService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *PeopleService {
	return &PeopleService{pool: pool, q: q, orgs: orgs}
}

// PersonView is one directory entry: global identity, the membership, and the
// profile, already reduced to what this viewer may see.
type PersonView struct {
	UserID         string
	Email          string
	DisplayName    string
	AvatarURL      string
	Timezone       string
	Role           string
	DeactivatedAt  pgtype.Timestamptz
	JoinedOrgAt    pgtype.Timestamptz
	Title          string
	DepartmentID   string
	DepartmentName string
	ManagerID      string
	EmployeeCode   string
	Phone          string
	PhoneVisible   bool
	Location       string
	Bio            string
	JoinedOn       pgtype.Date
	IsSelf         bool
}

// PeopleFilter is the directory's query string, already validated.
type PeopleFilter struct {
	Query        string
	DepartmentID string
	ManagerID    string
	Role         string
	Status       string
	Cursor       string
	Limit        int32
}

// PeoplePage is one keyset page plus the counts the screen shows: Total is
// how many people the filters match across every page, TotalActive the
// organization's active headcount whatever the filters say.
type PeoplePage struct {
	People      []PersonView
	NextCursor  string
	Total       int64
	TotalActive int64
}

// ProfileInput is a partial update: a nil pointer leaves the column alone, so
// the self-edit form and the admin form send the same shape.
type ProfileInput struct {
	Title        *string
	DepartmentID *string
	ManagerID    *string
	EmployeeCode *string
	Phone        *string
	PhoneVisible *bool
	Location     *string
	Bio          *string
	JoinedOn     *string
}

// adminOnly reports whether this update touches a field only an owner or admin
// may set: the facts the company asserts about a person, as opposed to the
// ones the person asserts about themselves (spec F-03 §2 decision 8).
func (in ProfileInput) adminOnly() bool {
	return in.DepartmentID != nil || in.ManagerID != nil || in.EmployeeCode != nil || in.JoinedOn != nil
}

// normalizePeopleFilter validates the filter fields shared by the directory
// and its export. An empty status becomes emptyStatus: the directory defaults
// to the active members, the export to everyone.
func normalizePeopleFilter(f PeopleFilter, emptyStatus string) (PeopleFilter, error) {
	switch f.Status {
	case "":
		f.Status = emptyStatus
	case MemberStatusActive, MemberStatusDeactivated, MemberStatusAll:
	default:
		return f, Invalid("status phải là active, deactivated hoặc all")
	}
	if f.Role != "" && f.Role != OrgRoleOwner && f.Role != OrgRoleAdmin && f.Role != OrgRoleMember {
		return f, Invalid("role phải là owner, admin hoặc member")
	}
	return f, nil
}

// searchQuery folds the free-text query, or leaves it NULL when it is too
// short to be a search.
func (f PeopleFilter) searchQuery() pgtype.Text {
	return nullTextIf(foldForSearch(f.Query), len([]rune(strings.TrimSpace(f.Query))) >= minSearchQuery)
}

// Search is the directory. Every member of the organization may read it.
func (s *PeopleService) Search(ctx context.Context, actorID, orgID string, f PeopleFilter) (PeoplePage, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return PeoplePage{}, err
	}
	f, err = normalizePeopleFilter(f, MemberStatusActive)
	if err != nil {
		return PeoplePage{}, err
	}
	limit := f.Limit
	if limit <= 0 {
		limit = defaultMemberPageSize
	}
	if limit > maxMemberPageSize {
		limit = maxMemberPageSize
	}
	name, userID, err := decodeMemberCursor(f.Cursor)
	if err != nil {
		return PeoplePage{}, err
	}
	query := f.searchQuery()
	departmentID := nullTextIf(f.DepartmentID, f.DepartmentID != "")
	managerID := nullTextIf(f.ManagerID, f.ManagerID != "")
	role := nullTextIf(f.Role, f.Role != "")
	rows, err := s.q.SearchPeople(ctx, db.SearchPeopleParams{
		OrganizationID: orgID,
		Status:         f.Status,
		Query:          query,
		DepartmentID:   departmentID,
		ManagerID:      managerID,
		Role:           role,
		CursorName:     name,
		CursorUserID:   userID,
		RowLimit:       limit + 1,
	})
	if err != nil {
		return PeoplePage{}, err
	}
	page := PeoplePage{People: make([]PersonView, 0, len(rows))}
	// The counts span every page, so only the first page pays for them: each
	// one sorts and scans the whole organization, and a later page's would
	// only repeat the first's.
	if f.Cursor == "" {
		page.Total, err = s.q.CountPeople(ctx, db.CountPeopleParams{
			OrganizationID: orgID,
			Status:         f.Status,
			Query:          query,
			DepartmentID:   departmentID,
			ManagerID:      managerID,
			Role:           role,
		})
		if err != nil {
			return PeoplePage{}, err
		}
		page.TotalActive, err = s.q.CountActivePeople(ctx, orgID)
		if err != nil {
			return PeoplePage{}, err
		}
	}
	if int32(len(rows)) > limit {
		last := rows[limit-1]
		page.NextCursor = encodeMemberCursor(last.DisplayName, last.UserID)
		rows = rows[:limit]
	}
	for _, r := range rows {
		page.People = append(page.People, personFromSearchRow(r, actorID, m.Role))
	}
	return page, nil
}

// Get is one person's profile plus the people who report to them.
func (s *PeopleService) Get(ctx context.Context, actorID, orgID, userID string) (PersonView, []ActorInfo, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return PersonView{}, nil, err
	}
	row, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return PersonView{}, nil, ErrNotFound
	}
	if err != nil {
		return PersonView{}, nil, err
	}
	reports, err := s.q.ListDirectReports(ctx, db.ListDirectReportsParams{OrganizationID: orgID, ManagerID: pgtype.Text{String: userID, Valid: true}})
	if err != nil {
		return PersonView{}, nil, err
	}
	out := make([]ActorInfo, 0, len(reports))
	for _, r := range reports {
		out = append(out, ActorInfo{ID: r.UserID, Kind: audit.KindHuman, DisplayName: r.DisplayName, AvatarURL: textOrEmpty(r.AvatarUrl)})
	}
	return personFromGetRow(row, actorID, m.Role), out, nil
}

// UpdateProfile edits one profile. A person owns the facts about themselves;
// the company owns department, manager, employee code and start date, so those
// need an owner or admin (spec F-03 §2 decision 8).
func (s *PeopleService) UpdateProfile(ctx context.Context, actorID, orgID, targetID string, in ProfileInput) (PersonView, error) {
	actor, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return PersonView{}, err
	}
	isAdmin := actor.Role == OrgRoleOwner || actor.Role == OrgRoleAdmin
	if actorID != targetID && !isAdmin {
		return PersonView{}, ErrForbidden
	}
	if in.adminOnly() && !isAdmin {
		return PersonView{}, ErrForbidden
	}
	before, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: targetID})
	if errors.Is(err, pgx.ErrNoRows) {
		return PersonView{}, ErrNotFound
	}
	if err != nil {
		return PersonView{}, err
	}
	params, err := s.updateParams(ctx, orgID, targetID, before, in, actorID)
	if err != nil {
		return PersonView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PersonView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// A member added before this feature landed may have no profile row yet;
	// seed it so the update below has something to write to.
	if _, err := q.UpsertMemberProfile(ctx, db.UpsertMemberProfileParams{
		OrganizationID: orgID, UserID: targetID, SearchText: params.SearchText.String, UpdatedBy: actorID,
	}); err != nil {
		return PersonView{}, err
	}
	if _, err := q.UpdateMemberProfile(ctx, params); err != nil {
		if isUniqueViolation(err) {
			return PersonView{}, coded(http.StatusConflict, "employee_code_taken", "mã nhân viên đã được dùng trong tổ chức")
		}
		return PersonView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionProfileUpdated,
		ResourceType:   "organization_member_profile", ResourceID: targetID,
		Changes: audit.Diff(profileSnapshot(before), profileSnapshotAfter(before, in)),
	}, audit.Event{Topic: "profile.updated", Payload: map[string]string{
		"organization_id": orgID, "user_id": targetID,
	}}); err != nil {
		return PersonView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PersonView{}, err
	}
	after, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: targetID})
	if err != nil {
		return PersonView{}, err
	}
	return personFromGetRow(after, actorID, actor.Role), nil
}

// updateParams validates the input and works out the new search text. It runs
// before the transaction so a rejected edit never opens one.
func (s *PeopleService) updateParams(ctx context.Context, orgID, targetID string, before db.GetPersonRow, in ProfileInput, actorID string) (db.UpdateMemberProfileParams, error) {
	p := db.UpdateMemberProfileParams{OrganizationID: orgID, UserID: targetID, UpdatedBy: actorID}
	if in.Title != nil {
		p.Title = pgtype.Text{String: strings.TrimSpace(*in.Title), Valid: true}
	}
	if in.Phone != nil {
		p.Phone = pgtype.Text{String: strings.TrimSpace(*in.Phone), Valid: true}
	}
	if in.PhoneVisible != nil {
		p.PhoneVisible = pgtype.Bool{Bool: *in.PhoneVisible, Valid: true}
	}
	if in.Location != nil {
		p.Location = pgtype.Text{String: strings.TrimSpace(*in.Location), Valid: true}
	}
	if in.Bio != nil {
		bio := strings.TrimSpace(*in.Bio)
		if len([]rune(bio)) > maxBioLength {
			return p, Invalid("giới thiệu tối đa 500 ký tự")
		}
		p.Bio = pgtype.Text{String: bio, Valid: true}
	}
	if in.EmployeeCode != nil {
		p.SetEmployeeCode = true
		if code := strings.TrimSpace(*in.EmployeeCode); code != "" {
			p.EmployeeCode = pgtype.Text{String: code, Valid: true}
		}
	}
	if in.JoinedOn != nil {
		p.SetJoinedOn = true
		if raw := strings.TrimSpace(*in.JoinedOn); raw != "" {
			d, err := time.Parse("2006-01-02", raw)
			if err != nil {
				return p, Invalid("ngày vào phải theo dạng YYYY-MM-DD")
			}
			p.JoinedOn = pgtype.Date{Time: d, Valid: true}
		}
	}
	departmentName := textOrEmpty(before.DepartmentName)
	if in.DepartmentID != nil {
		p.SetDepartment = true
		if id := strings.TrimSpace(*in.DepartmentID); id != "" {
			d, err := s.q.GetDepartment(ctx, db.GetDepartmentParams{ID: id, OrganizationID: orgID})
			if errors.Is(err, pgx.ErrNoRows) {
				return p, Invalid("phòng ban không thuộc tổ chức này")
			}
			if err != nil {
				return p, err
			}
			p.DepartmentID = pgtype.Text{String: id, Valid: true}
			departmentName = d.Name
		} else {
			departmentName = ""
		}
	}
	if in.ManagerID != nil {
		p.SetManager = true
		if id := strings.TrimSpace(*in.ManagerID); id != "" {
			if id == targetID {
				return p, Invalid("không thể đặt chính mình làm quản lý")
			}
			manager, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: id})
			if errors.Is(err, pgx.ErrNoRows) {
				return p, Invalid("người quản lý phải là thành viên của tổ chức")
			} else if err != nil {
				return p, err
			}
			if err := s.rejectReportingLoop(ctx, orgID, targetID, manager); err != nil {
				return p, err
			}
			p.ManagerID = pgtype.Text{String: id, Valid: true}
		}
	}
	title := textOrEmpty(before.Title)
	if p.Title.Valid {
		title = p.Title.String
	}
	p.SearchText = pgtype.Text{String: buildSearchText(before.DisplayName, before.Email, title, departmentName), Valid: true}
	return p, nil
}

// maxReportingDepth bounds the walk up a manager chain, so a loop already in
// the data cannot hang an edit.
const maxReportingDepth = 64

// rejectReportingLoop refuses a manager who already reports, directly or up
// the chain, to the person being edited: the org chart would loop forever.
func (s *PeopleService) rejectReportingLoop(ctx context.Context, orgID, targetID string, manager db.GetPersonRow) error {
	next := manager.ManagerID
	for range maxReportingDepth {
		if !next.Valid || next.String == "" {
			return nil
		}
		if next.String == targetID {
			return Invalid("người quản lý đang báo cáo cho người này, không thể tạo vòng quản lý")
		}
		row, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: next.String})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		next = row.ManagerID
	}
	return nil
}

// RefreshSearchText rebuilds the folded search column for every profile that
// matches. Renaming a person changes it in every organization they belong to;
// renaming a department changes it for everyone in that department.
func (s *PeopleService) RefreshSearchText(ctx context.Context, q *db.Queries, in RefreshSearchTextInput) error {
	return refreshSearchText(ctx, q, in)
}

// RefreshSearchTextInput selects the profiles to rebuild; an empty field means
// "any", so at least one must be set by the caller.
type RefreshSearchTextInput struct {
	UserID         string
	DepartmentID   string
	OrganizationID string
}

// refreshSearchText is a package function rather than a method so the commands
// that change a name — updating your own profile, renaming a department — can
// call it inside their own transaction without holding a PeopleService.
func refreshSearchText(ctx context.Context, q *db.Queries, in RefreshSearchTextInput) error {
	if in.UserID == "" && in.DepartmentID == "" && in.OrganizationID == "" {
		return nil // "refresh every profile in the product" is never the intent
	}
	rows, err := q.ListProfileSearchSources(ctx, db.ListProfileSearchSourcesParams{
		UserID:         nullTextIf(in.UserID, in.UserID != ""),
		DepartmentID:   nullTextIf(in.DepartmentID, in.DepartmentID != ""),
		OrganizationID: nullTextIf(in.OrganizationID, in.OrganizationID != ""),
	})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := q.SetMemberProfileSearchText(ctx, db.SetMemberProfileSearchTextParams{
			OrganizationID: r.OrganizationID, UserID: r.UserID,
			SearchText: buildSearchText(r.DisplayName, r.Email, r.Title, textOrEmpty(r.DepartmentName)),
		}); err != nil {
			return err
		}
	}
	return nil
}

// ensureMemberProfile gives a new member their empty profile in the same
// transaction that makes them a member, so the directory never holds a person
// without a row and no read path has to cope with one.
func ensureMemberProfile(ctx context.Context, q *db.Queries, orgID, userID, displayName, email string) error {
	_, err := q.UpsertMemberProfile(ctx, db.UpsertMemberProfileParams{
		OrganizationID: orgID, UserID: userID,
		SearchText: buildSearchText(displayName, email, "", ""),
		UpdatedBy:  userID,
	})
	return err
}

func nullTextIf(v string, ok bool) pgtype.Text {
	if !ok {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}

// visiblePhone applies OPEN_QUESTIONS P3: a phone number reaches a colleague
// only when its owner published it. Self and the administrators always see it,
// because they are the ones who can change it.
func visiblePhone(phone string, phoneVisible, isSelf bool, viewerRole string) string {
	if isSelf || phoneVisible || viewerRole == OrgRoleOwner || viewerRole == OrgRoleAdmin {
		return phone
	}
	return ""
}

func personFromGetRow(r db.GetPersonRow, viewerID, viewerRole string) PersonView {
	isSelf := r.UserID == viewerID
	return PersonView{
		UserID: r.UserID, Email: r.Email, DisplayName: r.DisplayName,
		AvatarURL: textOrEmpty(r.AvatarUrl), Timezone: r.Timezone,
		Role: r.Role, DeactivatedAt: r.DeactivatedAt, JoinedOrgAt: r.CreatedAt,
		Title: textOrEmpty(r.Title), DepartmentID: textOrEmpty(r.DepartmentID),
		DepartmentName: textOrEmpty(r.DepartmentName), ManagerID: textOrEmpty(r.ManagerID),
		EmployeeCode: textOrEmpty(r.EmployeeCode),
		Phone:        visiblePhone(textOrEmpty(r.Phone), r.PhoneVisible.Bool, isSelf, viewerRole),
		PhoneVisible: r.PhoneVisible.Bool,
		Location:     textOrEmpty(r.Location), Bio: textOrEmpty(r.Bio),
		JoinedOn: r.JoinedOn, IsSelf: isSelf,
	}
}

func personFromSearchRow(r db.SearchPeopleRow, viewerID, viewerRole string) PersonView {
	return personFromGetRow(db.GetPersonRow(r), viewerID, viewerRole)
}

func profileSnapshot(r db.GetPersonRow) map[string]any {
	return map[string]any{
		"title": textOrEmpty(r.Title), "department_id": textOrEmpty(r.DepartmentID),
		"manager_id": textOrEmpty(r.ManagerID), "employee_code": textOrEmpty(r.EmployeeCode),
		"location": textOrEmpty(r.Location), "phone_visible": r.PhoneVisible.Bool,
	}
}

func profileSnapshotAfter(r db.GetPersonRow, in ProfileInput) map[string]any {
	out := profileSnapshot(r)
	// The audit row records which company-owned facts changed, never the free
	// text a person writes about themselves.
	if in.Title != nil {
		out["title"] = *in.Title
	}
	if in.DepartmentID != nil {
		out["department_id"] = *in.DepartmentID
	}
	if in.ManagerID != nil {
		out["manager_id"] = *in.ManagerID
	}
	if in.EmployeeCode != nil {
		out["employee_code"] = *in.EmployeeCode
	}
	if in.Location != nil {
		out["location"] = *in.Location
	}
	if in.PhoneVisible != nil {
		out["phone_visible"] = *in.PhoneVisible
	}
	return out
}

// RequireExporter is the export gate on its own, so the handler can refuse
// before it writes the 200 header a stream cannot take back. It checks the
// caller first and the filter second, so a malformed filter tells a
// non-exporter nothing.
func (s *PeopleService) RequireExporter(ctx context.Context, actorID, orgID string, f PeopleFilter) error {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return ErrForbidden
	}
	_, err = normalizePeopleFilter(f, MemberStatusAll)
	return err
}

// UpdateProfileAndRead applies the edit and returns the profile with its
// reports, which is what the detail screen redraws from.
func (s *PeopleService) UpdateProfileAndRead(ctx context.Context, actorID, orgID, targetID string, in ProfileInput) (PersonView, []ActorInfo, error) {
	if _, err := s.UpdateProfile(ctx, actorID, orgID, targetID, in); err != nil {
		return PersonView{}, nil, err
	}
	return s.Get(ctx, actorID, orgID, targetID)
}

// ExportCSV streams the directory as CSV for an owner or admin, narrowed by
// the same filters as Search (Cursor and Limit are ignored). With no status
// it exports everyone, active and deactivated. It writes a UTF-8 BOM first:
// Excel on a Vietnamese Windows reads a BOM-less UTF-8 file as Windows-1252
// and turns every accented name into mojibake.
func (s *PeopleService) ExportCSV(ctx context.Context, actorID, orgID string, f PeopleFilter, w io.Writer) (int, error) {
	if err := s.RequireExporter(ctx, actorID, orgID, f); err != nil {
		return 0, err
	}
	f, err := normalizePeopleFilter(f, MemberStatusAll)
	if err != nil {
		return 0, err
	}
	rows, err := s.q.ListPeopleForExport(ctx, db.ListPeopleForExportParams{
		OrganizationID: orgID,
		Status:         f.Status,
		Query:          f.searchQuery(),
		DepartmentID:   nullTextIf(f.DepartmentID, f.DepartmentID != ""),
		ManagerID:      nullTextIf(f.ManagerID, f.ManagerID != ""),
		Role:           nullTextIf(f.Role, f.Role != ""),
		RowLimit:       maxExportRows,
	})
	if err != nil {
		return 0, err
	}
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return 0, err
	}
	cw := csv.NewWriter(w)
	header := []string{"display_name", "email", "title", "department", "manager", "employee_code", "phone", "location", "org_role", "status", "joined_on"}
	if err := cw.Write(header); err != nil {
		return 0, err
	}
	for _, r := range rows {
		status := MemberStatusActive
		if r.DeactivatedAt.Valid {
			status = MemberStatusDeactivated
		}
		joined := ""
		if r.JoinedOn.Valid {
			joined = r.JoinedOn.Time.Format("2006-01-02")
		}
		if err := cw.Write([]string{
			r.DisplayName, r.Email, textOrEmpty(r.Title), textOrEmpty(r.DepartmentName),
			textOrEmpty(r.ManagerName), textOrEmpty(r.EmployeeCode), textOrEmpty(r.Phone),
			textOrEmpty(r.Location), r.Role, status, joined,
		}); err != nil {
			return 0, err
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		return 0, err
	}
	// The audit row is written after the bytes are out: an export that failed
	// halfway is not an export, and claiming otherwise would be worse than
	// leaving no row at all.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return len(rows), err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionPeopleExported,
		ResourceType:   "organization", ResourceID: orgID,
		Metadata: map[string]any{"row_count": len(rows), "filters": exportFilterMetadata(f)},
	}, audit.Event{Topic: "people.exported", Payload: map[string]string{
		"organization_id": orgID, "user_id": actorID,
	}}); err != nil {
		return len(rows), err
	}
	return len(rows), tx.Commit(ctx)
}

// exportFilterMetadata is the filter an export applied, as the audit row
// records it: the status always, the rest only when set.
func exportFilterMetadata(f PeopleFilter) map[string]any {
	out := map[string]any{"status": f.Status}
	for key, v := range map[string]string{
		"q": strings.TrimSpace(f.Query), "department_id": f.DepartmentID,
		"manager_id": f.ManagerID, "role": f.Role,
	} {
		if v != "" {
			out[key] = v
		}
	}
	return out
}
