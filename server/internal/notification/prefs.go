package notification

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Prefs is one user's setting for one kind: which channels carry it.
type Prefs struct {
	InApp bool `json:"in_app"`
	Push  bool `json:"push"`
	Email bool `json:"email"`
}

// DefaultPrefs is what applies when the user never touched the row (spec §2
// #6): in-app everything, push only what is time-sensitive, digest on.
func DefaultPrefs(kind string) Prefs {
	push := kind == KindMentioned || kind == KindTaskAssigned || kind == KindMeetingStarting
	return Prefs{InApp: true, Push: push, Email: true}
}

// Matrix is one user's full preference set, kind → Prefs, defaults filled in.
type Matrix map[string]Prefs

// For returns the setting for kind, the default when the user has no row.
func (m Matrix) For(kind string) Prefs {
	if p, ok := m[kind]; ok {
		return p
	}
	return DefaultPrefs(kind)
}

// FullMatrix returns every kind with the stored value or its default, in Kinds
// order — the shape GET /me/notification-preferences returns.
func (m Matrix) Full() []KindPrefs {
	out := make([]KindPrefs, 0, len(Kinds))
	for _, k := range Kinds {
		out = append(out, KindPrefs{Kind: k, Prefs: m.For(k)})
	}
	return out
}

// KindPrefs is one row of the matrix.
type KindPrefs struct {
	Kind string
	Prefs
}

// loadMatrices batch-loads the preference rows of several users in one query;
// a user with no rows gets an empty Matrix, which answers with defaults.
func loadMatrices(ctx context.Context, q *db.Queries, userIDs []string) (map[string]Matrix, error) {
	out := make(map[string]Matrix, len(userIDs))
	for _, id := range userIDs {
		out[id] = Matrix{}
	}
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListNotificationPreferencesByUsers(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.UserID][r.Kind] = Prefs{InApp: r.InApp, Push: r.Push, Email: r.Email}
	}
	return out, nil
}
