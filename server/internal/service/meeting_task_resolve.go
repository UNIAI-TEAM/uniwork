package service

import (
	"context"
	"strings"
	"time"
	"unicode"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type assigneeCandidate struct {
	UserID string
	Name   string
}

type assigneeCandidates struct {
	byExact map[string]string
	all     []assigneeCandidate
}

func (s *MeetingService) loadAssigneeCandidates(ctx context.Context, meetingID, workspaceID string) (assigneeCandidates, error) {
	out := assigneeCandidates{byExact: make(map[string]string)}
	seen := make(map[string]struct{})

	participants, err := s.q.ListMeetingParticipants(ctx, meetingID)
	if err != nil {
		return out, err
	}
	for _, p := range participants {
		if p.Status != ParticipantActive || p.PrincipalType != PrincipalUser || !p.UserID.Valid {
			continue
		}
		uid := p.UserID.String
		name := strings.TrimSpace(p.DisplayNameSnapshot)
		if name == "" {
			continue
		}
		if _, ok := seen[uid]; ok {
			continue
		}
		seen[uid] = struct{}{}
		c := assigneeCandidate{UserID: uid, Name: name}
		out.all = append(out.all, c)
		out.byExact[normalizePersonName(name)] = uid
	}

	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return out, err
	}
	for _, m := range members {
		uid := m.UserID
		if _, ok := seen[uid]; ok {
			continue
		}
		seen[uid] = struct{}{}
		name := strings.TrimSpace(m.DisplayName)
		if name == "" {
			continue
		}
		c := assigneeCandidate{UserID: uid, Name: name}
		out.all = append(out.all, c)
		out.byExact[normalizePersonName(name)] = uid
	}

	return out, nil
}

func (c assigneeCandidates) resolve(owner string) *string {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil
	}
	key := normalizePersonName(owner)
	if uid, ok := c.byExact[key]; ok {
		return &uid
	}
	var fuzzy []string
	for _, cand := range c.all {
		n := normalizePersonName(cand.Name)
		if n == key || strings.Contains(n, key) || strings.Contains(key, n) {
			fuzzy = append(fuzzy, cand.UserID)
		}
	}
	if len(fuzzy) == 1 {
		return &fuzzy[0]
	}
	return nil
}

func normalizePersonName(s string) string {
	s = strings.TrimSpace(strings.ToLower(foldVietnamese(s)))
	return strings.Join(strings.Fields(s), " ")
}

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

func meetingDueAnchor(m db.Meeting) time.Time {
	if m.EndsAt.Valid {
		return m.EndsAt.Time.UTC()
	}
	if m.StartsAt.Valid {
		return m.StartsAt.Time.UTC()
	}
	return time.Now().UTC()
}
