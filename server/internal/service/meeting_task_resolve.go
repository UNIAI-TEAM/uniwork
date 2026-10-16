package service

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// assigneeCandidate is one name a user can be called by. A user may appear
// more than once: under their profile name and under the name they joined
// the meeting with.
type assigneeCandidate struct {
	UserID string
	Name   string
}

// assigneeCandidates is the set of people an AI action item's owner text may
// resolve to. Every user in it is assignable in the meeting's workspace.
type assigneeCandidates struct {
	// byExact maps a normalized full name to every distinct user carrying it,
	// so two people with the same name stay visibly ambiguous.
	byExact map[string][]string
	all     []assigneeCandidate
	// participants holds the users who took part in the meeting; it only
	// breaks a tie between otherwise equal matches.
	participants map[string]struct{}
}

// loadAssigneeCandidates lists who an owner name may resolve to: the
// workspace's assignable members (the people RequireMember admits, deactivated
// organization members excluded), each under their profile name and, when they
// took part in the meeting, under their participant display name too. A
// participant who is not assignable (a guest, a removed or deactivated member)
// is never a candidate, so a resolved assignee cannot fail the task's own
// assignee check.
func (s *MeetingService) loadAssigneeCandidates(ctx context.Context, meetingID, workspaceID string) (assigneeCandidates, error) {
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return newAssigneeCandidates(nil, nil), err
	}
	members, err := s.q.ListAssignableMembers(ctx, db.ListAssignableMembersParams{WorkspaceID: workspaceID, OrganizationID: ws.OrganizationID})
	if err != nil {
		return newAssigneeCandidates(nil, nil), err
	}
	participants, err := s.q.ListMeetingParticipants(ctx, meetingID)
	if err != nil {
		return newAssigneeCandidates(nil, nil), err
	}
	return newAssigneeCandidates(members, participants), nil
}

// newAssigneeCandidates builds the candidate set from the assignable members
// and the meeting's participant rows; it is pure so the matching rules can be
// tested without a database.
func newAssigneeCandidates(members []db.ListAssignableMembersRow, participants []db.MeetingParticipant) assigneeCandidates {
	out := assigneeCandidates{
		byExact:      make(map[string][]string),
		participants: make(map[string]struct{}),
	}
	assignable := make(map[string]struct{}, len(members))
	for _, m := range members {
		assignable[m.UserID] = struct{}{}
		out.add(m.UserID, m.DisplayName)
	}
	for _, p := range participants {
		if p.Status != ParticipantActive || p.PrincipalType != PrincipalUser || !p.UserID.Valid {
			continue
		}
		uid := p.UserID.String
		if _, ok := assignable[uid]; !ok {
			continue
		}
		out.participants[uid] = struct{}{}
		out.add(uid, p.DisplayNameSnapshot)
	}
	return out
}

func (c *assigneeCandidates) add(uid, name string) {
	key := normalizePersonName(name)
	if key == "" {
		return
	}
	for _, existing := range c.byExact[key] {
		if existing == uid {
			return
		}
	}
	c.byExact[key] = append(c.byExact[key], uid)
	c.all = append(c.all, assigneeCandidate{UserID: uid, Name: name})
}

// resolve maps the owner text of an action item to exactly one user, or nil
// when nobody or more than one person fits.
//
// A form of the owner matches a candidate when its words equal the
// candidate's full name (exact), or failing that when they are the trailing
// words of the name (suffix: Vietnamese names end with the given name, so
// "An" and "Văn An" both match "Nguyễn Văn An", while "An" never matches
// "Thanh"). Several matches are narrowed to the meeting's participants when
// exactly one of them took part.
//
// The forms come from ownerKeys: the owner as spoken, then with one leading
// honorific-like word removed, then two, and so on. A leading "anh", "chị",
// "bà"... may be an honorific or the first word of the name (the middle names
// Anh, Chí, Bá), so the spoken form and the form without its first word are
// read together as one step: an exact match on the spoken form wins, then an
// exact match on the stripped one ("anh Tuấn" prefers a person named Tuấn),
// then the suffix matches of both readings are pooled, so a clash between
// "Nguyễn Anh Tuấn" and "Lê Tuấn" goes to the participant or stays nil. Every
// further honorific-like word is stripped one step at a time, and a step that
// matches anyone decides: after "chị", "Anh Thư" is far more likely a middle
// name than a second honorific, so it is tried before "Thư".
func (c assigneeCandidates) resolve(owner string) *string {
	for _, step := range ownerKeySteps(ownerKeys(owner)) {
		for _, key := range step {
			if uids := c.exactMatches(key); len(uids) > 0 {
				return c.single(uids)
			}
		}
		var pooled []string
		for _, key := range step {
			pooled = appendNew(pooled, c.suffixMatches(key)...)
		}
		if len(pooled) > 0 {
			return c.single(pooled)
		}
	}
	return nil
}

// ownerKeySteps groups ownerKeys into the steps resolve tries in order: the
// spoken form together with the form that drops its first word, then each
// deeper form on its own.
func ownerKeySteps(keys []string) [][]string {
	if len(keys) <= 2 {
		if len(keys) == 0 {
			return nil
		}
		return [][]string{keys}
	}
	steps := [][]string{keys[:2]}
	for _, key := range keys[2:] {
		steps = append(steps, []string{key})
	}
	return steps
}

// appendNew appends each uid not already in dst.
func appendNew(dst []string, uids ...string) []string {
	for _, uid := range uids {
		if !slices.Contains(dst, uid) {
			dst = append(dst, uid)
		}
	}
	return dst
}

func (c assigneeCandidates) exactMatches(key string) []string {
	return c.byExact[key]
}

func (c assigneeCandidates) suffixMatches(key string) []string {
	keyTokens := strings.Fields(key)
	var uids []string
	seen := make(map[string]struct{})
	for _, cand := range c.all {
		if _, ok := seen[cand.UserID]; ok {
			continue
		}
		if hasTokenSuffix(strings.Fields(normalizePersonName(cand.Name)), keyTokens) {
			seen[cand.UserID] = struct{}{}
			uids = append(uids, cand.UserID)
		}
	}
	return uids
}

// single returns the one user in uids, or the one participant among them, or
// nil when the match stays ambiguous.
func (c assigneeCandidates) single(uids []string) *string {
	if len(uids) == 1 {
		uid := uids[0]
		return &uid
	}
	var inMeeting []string
	for _, uid := range uids {
		if _, ok := c.participants[uid]; ok {
			inMeeting = append(inMeeting, uid)
		}
	}
	if len(inMeeting) == 1 {
		return &inMeeting[0]
	}
	return nil
}

func hasTokenSuffix(name, suffix []string) bool {
	if len(suffix) == 0 || len(suffix) > len(name) {
		return false
	}
	offset := len(name) - len(suffix)
	for i, tok := range suffix {
		if name[offset+i] != tok {
			return false
		}
	}
	return true
}

// personHonorifics are the forms of address Vietnamese and English speakers
// put before a name. They are compared after normalizePersonName, so "chị"
// is listed as "chi" and "sếp" as "sep".
var personHonorifics = map[string]struct{}{
	"anh": {}, "chi": {}, "em": {}, "co": {}, "chu": {}, "bac": {},
	"ong": {}, "ba": {}, "ban": {}, "sep": {}, "thay": {}, "di": {},
	"mr": {}, "ms": {}, "mrs": {}, "miss": {},
}

// ownerKeys returns the normalized owner as spoken, then the same name with
// one leading honorific-like word removed, then two, and so on ("chị Anh Thư"
// -> "chi anh thu", "anh thu", "thu"), so a middle name that looks like an
// honorific is still tried. The last word is never stripped: a bare "Anh" can
// also be a given name.
func ownerKeys(owner string) []string {
	key := normalizePersonName(owner)
	if key == "" {
		return nil
	}
	tokens := strings.Fields(key)
	keys := []string{key}
	for i := 0; i < len(tokens)-1; i++ {
		if _, ok := personHonorifics[tokens[i]]; !ok {
			break
		}
		keys = append(keys, strings.Join(tokens[i+1:], " "))
	}
	return keys
}

// normalizePersonName lowercases, removes Vietnamese diacritics (đ -> d),
// drops punctuation and collapses whitespace, so "ĐỨC", "Đức" and "Duc"
// compare equal.
func normalizePersonName(s string) string {
	return strings.Join(strings.Fields(foldVietnamese(strings.ToLower(s))), " ")
}

// foldVietnamese maps lowercase Vietnamese letters to their base letter and
// drops everything that is not a letter, digit or space. Input must already
// be lowercase; combining marks of decomposed input are dropped as
// non-letters, so NFC and NFD text fold alike.
func foldVietnamese(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch r {
		case 'à', 'á', 'ạ', 'ả', 'ã', 'â', 'ầ', 'ấ', 'ậ', 'ẩ', 'ẫ', 'ă', 'ằ', 'ắ', 'ặ', 'ẳ', 'ẵ':
			b.WriteRune('a')
		case 'è', 'é', 'ẹ', 'ẻ', 'ẽ', 'ê', 'ề', 'ế', 'ệ', 'ể', 'ễ':
			b.WriteRune('e')
		case 'ì', 'í', 'ị', 'ỉ', 'ĩ':
			b.WriteRune('i')
		case 'ò', 'ó', 'ọ', 'ỏ', 'õ', 'ô', 'ồ', 'ố', 'ộ', 'ổ', 'ỗ', 'ơ', 'ờ', 'ớ', 'ợ', 'ở', 'ỡ':
			b.WriteRune('o')
		case 'ù', 'ú', 'ụ', 'ủ', 'ũ', 'ư', 'ừ', 'ứ', 'ự', 'ử', 'ữ':
			b.WriteRune('u')
		case 'ỳ', 'ý', 'ỵ', 'ỷ', 'ỹ':
			b.WriteRune('y')
		case 'đ':
			b.WriteRune('d')
		default:
			if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

// defaultMeetingTimezone is used when a meeting carries no valid IANA zone.
const defaultMeetingTimezone = "Asia/Ho_Chi_Minh"

// meetingLocation is the meeting's own time zone, falling back to Vietnam
// time (and to a fixed UTC+7 where the host has no zone database).
func meetingLocation(tz string) *time.Location {
	tz = strings.TrimSpace(tz)
	if tz != "" && tz != "Local" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	if loc, err := time.LoadLocation(defaultMeetingTimezone); err == nil {
		return loc
	}
	return time.FixedZone("ICT", 7*60*60)
}

// meetingDueAnchor is the moment spoken due dates ("ngày mai", "thứ Sáu")
// are counted from: when the meeting actually ended, else its scheduled end,
// else its start, else now, expressed in the meeting's time zone so the
// calendar day is the one the participants lived through.
func meetingDueAnchor(m db.Meeting) time.Time {
	loc := meetingLocation(m.Timezone)
	switch {
	case m.ActualEndAt.Valid:
		return m.ActualEndAt.Time.In(loc)
	case m.EndsAt.Valid:
		return m.EndsAt.Time.In(loc)
	case m.StartsAt.Valid:
		return m.StartsAt.Time.In(loc)
	default:
		return time.Now().In(loc)
	}
}
