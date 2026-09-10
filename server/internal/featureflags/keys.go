// Package featureflags is the catalogue of flag keys this server evaluates
// and the organization-scoped override provider (spec F-11 §7).
//
// The evaluation machinery — providers, hashing, eval context — lives in
// pkg/featureflag and knows nothing about which flags exist. This package is
// where a key is declared, documented, marked public to the frontend and
// given a review date; TestFlagsAreReviewed fails when one is left past it.
package featureflags

import (
	"context"
	"time"

	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Flag is one catalogue entry.
type Flag struct {
	Key         string
	Description string
	Default     bool
	// Public flags are published to the web client through GET /api/v1/config.
	Public bool
	Owner  string
	// ReviewAt is the date the flag must be deleted or extended (§7.3).
	ReviewAt time.Time
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// catalogue is the ordered list; a flag not here evaluates to the caller's
// default and cannot be overridden from the console.
var catalogue = []Flag{
	{Key: "agents_assignee", Description: "Hiện agent trong picker assignee của task", Default: false, Public: true, Owner: "tasks", ReviewAt: day(2026, 12, 5)},
	{Key: "admin_quota", Description: "Màn hình Quota trong console admin khi spec subscription chưa đủ dữ liệu", Default: false, Public: false, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "rum_sampling", Description: "Cho phép web gửi web-vitals về POST /api/v1/rum", Default: true, Public: true, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "meeting_ai_summary", Description: "Bật tóm tắt cuộc họp bằng AI theo tổ chức (pilot)", Default: false, Public: true, Owner: "meetings", ReviewAt: day(2026, 12, 5)},
	{Key: "debug_trace_full_sampling", Description: "Lấy mẫu trace 100% cho tổ chức đang điều tra sự cố", Default: false, Public: false, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "chat_work_hub", Description: "Kênh hạng nhất gắn Project, khám phá và tham gia (C-13)", Default: false, Public: true, Owner: "chat", ReviewAt: day(2026, 12, 31)},
}

// Catalogue returns a copy of the declared flags.
func Catalogue() []Flag {
	out := make([]Flag, len(catalogue))
	copy(out, catalogue)
	return out
}

// Lookup finds a flag by key.
func Lookup(key string) (Flag, bool) {
	for _, f := range catalogue {
		if f.Key == key {
			return f, true
		}
	}
	return Flag{}, false
}

// EvaluateFrontendPublicFlags evaluates every public key for the request's
// context. A nil service yields every public flag at its default, which is
// what a deployment without a flag file or database gets.
func EvaluateFrontendPublicFlags(ctx context.Context, flags *featureflag.Service) map[string]bool {
	out := make(map[string]bool, len(catalogue))
	for _, f := range catalogue {
		if !f.Public {
			continue
		}
		out[f.Key] = flags.IsEnabled(ctx, f.Key, f.Default)
	}
	return out
}
