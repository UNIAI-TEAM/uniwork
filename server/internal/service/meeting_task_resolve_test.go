package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func members(pairs ...string) []db.ListAssignableMembersRow {
	out := make([]db.ListAssignableMembersRow, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, db.ListAssignableMembersRow{UserID: pairs[i], DisplayName: pairs[i+1]})
	}
	return out
}

func userParticipant(uid, name string) db.MeetingParticipant {
	return db.MeetingParticipant{
		PrincipalType:       PrincipalUser,
		Status:              ParticipantActive,
		UserID:              pgtype.Text{String: uid, Valid: true},
		DisplayNameSnapshot: name,
	}
}

func TestResolveAssignee(t *testing.T) {
	guest := db.MeetingParticipant{
		PrincipalType:       PrincipalGuest,
		Status:              ParticipantActive,
		GuestID:             pgtype.Text{String: "guest-1", Valid: true},
		DisplayNameSnapshot: "Khách Hòa",
	}
	removed := userParticipant("u-minh-1", "Minh")
	removed.Status = ParticipantRemoved

	cases := []struct {
		name         string
		members      []db.ListAssignableMembersRow
		participants []db.MeetingParticipant
		owner        string
		want         string // "" means nil
	}{
		{"full name", members("u-an", "Nguyễn Văn An"), nil, "Nguyễn Văn An", "u-an"},
		{"given name is the last word", members("u-an", "Nguyễn Văn An"), nil, "An", "u-an"},
		{"trailing words", members("u-an", "Nguyễn Văn An"), nil, "Văn An", "u-an"},
		{"family name shared by two people does not match", members("u-an", "Nguyễn Văn An", "u-bi", "Nguyễn Thị Bích"), nil, "Nguyễn", ""},
		// The inner-word rule (for given-name-first names) cannot tell a family
		// name from a first name; when it names one person only, that person is
		// suggested and the host can change it.
		{"a unique inner word matches", members("u-an", "Nguyễn Văn An"), nil, "Nguyễn", "u-an"},
		{"An is not a substring of Thanh", members("u-thanh", "Thanh"), nil, "An", ""},
		{"An picks An over Thanh", members("u-thanh", "Lê Thanh", "u-an", "Trần An"), nil, "An", "u-an"},
		{"Lan reaches Lan Anh only when nobody ends in Lan", members("u-lananh", "Lan Anh"), nil, "Lan", "u-lananh"},
		{"Lan is not Lan Anh when someone ends in Lan", members("u-lananh", "Lan Anh", "u-tl", "Trần Lan"), nil, "Lan", "u-tl"},
		{"Lan Anh is not Lan", members("u-lan", "Lan"), nil, "Lan Anh", ""},
		{"Lan and Lan Anh side by side", members("u-lan", "Lan", "u-lananh", "Phạm Lan Anh"), nil, "Lan", "u-lan"},
		{"two Minh are ambiguous", members("u-minh-1", "Minh", "u-minh-2", "Minh"), nil, "Minh", ""},
		{"two Minh by given name are ambiguous", members("u-minh-1", "Lê Minh", "u-minh-2", "Hà Minh"), nil, "Minh", ""},
		{"a participant breaks the tie", members("u-minh-1", "Lê Minh", "u-minh-2", "Hà Minh"),
			[]db.MeetingParticipant{userParticipant("u-minh-2", "Hà Minh")}, "Minh", "u-minh-2"},
		{"two participants stay ambiguous", members("u-minh-1", "Lê Minh", "u-minh-2", "Hà Minh"),
			[]db.MeetingParticipant{userParticipant("u-minh-1", "Lê Minh"), userParticipant("u-minh-2", "Hà Minh")}, "Minh", ""},
		{"a removed participant does not break the tie", members("u-minh-1", "Minh", "u-minh-2", "Minh"),
			[]db.MeetingParticipant{removed}, "Minh", ""},
		{"exact name beats a longer one", members("u-a", "B", "u-b", "Trần B"), nil, "B", "u-a"},
		{"Đức matches Duc", members("u-duc", "Duc"), nil, "Đức", "u-duc"},
		{"Duc matches Đức", members("u-duc", "Đức"), nil, "Duc", "u-duc"},
		{"ĐỨC matches Đức", members("u-duc", "Lê Đức"), nil, "ĐỨC", "u-duc"},
		{"honorific stripped", members("u-hung", "Hùng"), nil, "anh Hùng", "u-hung"},
		{"honorific stripped then given name", members("u-lan", "Nguyễn Thị Lan"), nil, "Chị Lan", "u-lan"},
		{"English honorific", members("u-hung", "Trần Hùng"), nil, "Mr. Hùng", "u-hung"},
		// A leading "anh"/"chị"/... is either an honorific or the first word of
		// the name. Both readings are pooled, so a clash between them is
		// narrowed by the participants or stays ambiguous.
		{"honorific or middle name stays ambiguous", members("u-nat", "Nguyễn Anh Tuấn", "u-lt", "Lê Tuấn"), nil, "Anh Tuấn", ""},
		{"honorific reading picked by the participants", members("u-nat", "Nguyễn Anh Tuấn", "u-lt", "Lê Tuấn"),
			[]db.MeetingParticipant{userParticipant("u-lt", "Lê Tuấn")}, "anh Tuấn", "u-lt"},
		{"middle-name reading picked by the participants", members("u-nat", "Nguyễn Anh Tuấn", "u-lt", "Lê Tuấn"),
			[]db.MeetingParticipant{userParticipant("u-nat", "Nguyễn Anh Tuấn")}, "anh Tuấn", "u-nat"},
		{"chị Thanh does not jump to the middle name Chí", members("u-nct", "Nguyễn Chí Thanh", "u-pt", "Phạm Thanh"),
			[]db.MeetingParticipant{userParticipant("u-pt", "Phạm Thanh")}, "chị Thanh", "u-pt"},
		{"middle name alone still resolves", members("u-nat", "Nguyễn Anh Tuấn"), nil, "anh Tuấn", "u-nat"},
		{"anh X prefers a person named exactly X", members("u-t", "Tuấn", "u-nat", "Nguyễn Anh Tuấn"), nil, "anh Tuấn", "u-t"},
		{"the spoken full name wins", members("u-at", "Anh Tuấn", "u-lt", "Lê Tuấn"), nil, "Anh Tuấn", "u-at"},
		{"full name with the middle name Anh", members("u-nat", "Nguyễn Anh Tuấn", "u-lt", "Lê Tuấn"), nil, "Nguyễn Anh Tuấn", "u-nat"},
		// A second honorific-like word after the first is read as a middle name
		// before it is stripped too.
		{"middle name Anh after an honorific", members("u-nat", "Nguyễn Anh Thư", "u-pt", "Phạm Thư"),
			[]db.MeetingParticipant{userParticipant("u-pt", "Phạm Thư")}, "chị Anh Thư", "u-nat"},
		{"middle name Bá after an honorific", members("u-lbl", "Lê Bá Long", "u-hl", "Hà Long"),
			[]db.MeetingParticipant{userParticipant("u-hl", "Hà Long")}, "anh Bá Long", "u-lbl"},
		{"two honorifics then the given name", members("u-thu", "Phạm Thư"), nil, "chị Anh Thư", "u-thu"},
		{"bare honorific is a name", members("u-anh", "Anh"), nil, "Anh", "u-anh"},
		{"bare honorific never matches an inner word", members("u-nat", "Nguyễn Anh Tuấn"), nil, "Anh", ""},
		// Given-name-first display names ("Hùng Nguyễn", "Kevin Trần"): one word
		// equal to any word of exactly one person's name, when nobody carries it
		// as the last word.
		{"given-name-first display name", members("u-hn", "Hùng Nguyễn"), nil, "Hùng", "u-hn"},
		{"given-name-first after an honorific", members("u-hn", "Hùng Nguyễn"), nil, "anh Hùng", "u-hn"},
		{"English display name", members("u-kt", "Kevin Trần"), nil, "Kevin", "u-kt"},
		{"two inner-word matches stay ambiguous even with a participant", members("u-hn", "Hùng Nguyễn", "u-hl", "Hùng Lê"),
			[]db.MeetingParticipant{userParticipant("u-hl", "Hùng Lê")}, "Hùng", ""},
		{"a last-word match beats an inner-word one", members("u-hn", "Hùng Nguyễn", "u-th", "Trần Hùng"), nil, "Hùng", "u-th"},
		{"a two-word owner never matches inner words", members("u-hn", "Hùng Văn Nguyễn"), nil, "Hùng Nguyễn", ""},
		{"participant snapshot name", members("u-x", "Nguyễn Văn Xuân"),
			[]db.MeetingParticipant{userParticipant("u-x", "Bé Xu")}, "Bé Xu", "u-x"},
		{"guest participant is never a candidate", members("u-an", "An"), []db.MeetingParticipant{guest}, "Khách Hòa", ""},
		{"non-member participant is never a candidate", members("u-an", "An"),
			[]db.MeetingParticipant{userParticipant("u-outsider", "Hòa")}, "Hòa", ""},
		{"empty owner", members("u-an", "An"), nil, "  ", ""},
		{"unknown owner", members("u-an", "An"), nil, "Unknown Person", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := newAssigneeCandidates(tc.members, tc.participants).resolve(tc.owner)
			switch {
			case tc.want == "" && got != nil:
				t.Fatalf("resolve(%q) = %q, want nil", tc.owner, *got)
			case tc.want != "" && (got == nil || *got != tc.want):
				t.Fatalf("resolve(%q) = %v, want %q", tc.owner, got, tc.want)
			}
		})
	}
}

func TestNormalizePersonName(t *testing.T) {
	cases := map[string]string{
		"  Trần  Văn A  ":  "tran van a",
		"ĐỨC":              "duc",
		"Đức":              "duc",
		"đức":              "duc",
		"NGUYỄN THỊ ÁNH":   "nguyen thi anh",
		"Ưng Hoàng Phúc":   "ung hoang phuc",
		"Mr. Hùng":         "mr hung",
		"Lế Văn":          "le van", // decomposed combining mark
		"THỨ SÁU tuần sau": "thu sau tuan sau",
	}
	for in, want := range cases {
		if got := normalizePersonName(in); got != want {
			t.Errorf("normalizePersonName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMeetingDueAnchor(t *testing.T) {
	end := time.Date(2026, 9, 3, 23, 30, 0, 0, time.UTC) // 06:30 Friday in Vietnam
	ts := func(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

	cases := []struct {
		name    string
		m       db.Meeting
		wantDay string
		wantLoc string
	}{
		{"scheduled end in the default zone", db.Meeting{EndsAt: ts(end)}, "2026-09-04", "Asia/Ho_Chi_Minh"},
		{"invalid zone falls back", db.Meeting{EndsAt: ts(end), Timezone: "Mars/Olympus"}, "2026-09-04", "Asia/Ho_Chi_Minh"},
		{"meeting zone", db.Meeting{EndsAt: ts(end), Timezone: "UTC"}, "2026-09-03", "UTC"},
		{"actual end wins", db.Meeting{
			EndsAt: ts(end), ActualEndAt: ts(end.Add(48 * time.Hour)), StartsAt: ts(end.Add(-time.Hour)),
		}, "2026-09-06", "Asia/Ho_Chi_Minh"},
		{"start when no end", db.Meeting{StartsAt: ts(end)}, "2026-09-04", "Asia/Ho_Chi_Minh"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := meetingDueAnchor(tc.m)
			if got.Format("2006-01-02") != tc.wantDay || got.Location().String() != tc.wantLoc {
				t.Fatalf("anchor = %s (%s), want day %s in %s", got, got.Location(), tc.wantDay, tc.wantLoc)
			}
		})
	}
}

// TestLoadAssigneeCandidatesOnlyAssignable holds M2: only people the task's
// assignee check admits can be resolved — workspace members and the
// organization's owners/admins, never a deactivated member or an outsider.
func TestLoadAssigneeCandidatesOnlyAssignable(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, s.q, as, "c@example.com", "Cường")
	ud := registerVerified(t, s.q, as, "d@example.com", "Dũng")
	ue := registerVerified(t, s.q, as, "e@example.com", "Em Hoa")
	_ = ue // registered, never joins: an outsider

	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addMember(t, s, w.ID, ub.ID)
	if err := s.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: uc.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	addMember(t, s, w.ID, uc.ID)
	if _, err := s.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.OrganizationID, uc.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: ud.ID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}

	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.loadAssigneeCandidates(ctx, m.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]*string{
		"A":       &ua.ID, // organization owner and workspace member
		"B":       &ub.ID, // workspace member
		"Dũng":    &ud.ID, // organization admin: an implicit workspace admin
		"Cường":   nil,    // deactivated
		"Em Hoa":  nil,    // not in the workspace
		"chị Hoa": nil,
	}
	for owner, wantID := range want {
		got := c.resolve(owner)
		switch {
		case wantID == nil && got != nil:
			t.Errorf("resolve(%q) = %q, want nil", owner, *got)
		case wantID != nil && (got == nil || *got != *wantID):
			t.Errorf("resolve(%q) = %v, want %q", owner, got, *wantID)
		}
	}
	for _, row := range c.all {
		if _, err := s.ws.RequireMember(ctx, w.ID, row.UserID); err != nil {
			t.Errorf("candidate %s (%s) is refused by RequireMember: %v", row.UserID, row.Name, err)
		}
	}
}
