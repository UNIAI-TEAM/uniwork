package service

import (
	"context"
	"testing"
)

// ratingMetrics is summaryMetrics that also counts call ratings.
type ratingMetrics struct {
	summaryMetrics
	ratings []string
}

func (m *ratingMetrics) IncCallRating(rating string) { m.ratings = append(m.ratings, rating) }

func TestRateCallCountsOnlyKnownRatings(t *testing.T) {
	s, ua, outsider, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Đánh giá")
	if err != nil {
		t.Fatal(err)
	}
	rec := &ratingMetrics{}
	s.SetMeetingMetrics(rec)

	if err := s.RateCall(ctx, ua.ID, "", m.ID, "good"); err != nil {
		t.Fatalf("member rates good: %v", err)
	}
	if err := s.RateCall(ctx, ua.ID, "", m.ID, "great"); err == nil {
		t.Fatal("an unknown rating must be refused")
	}
	if err := s.RateCall(ctx, outsider.ID, "", m.ID, "poor"); err != ErrForbidden && err != ErrNotFound {
		t.Fatalf("outsider err = %v, want forbidden or not found", err)
	}
	if len(rec.ratings) != 1 || rec.ratings[0] != "good" {
		t.Fatalf("counted %v, want [good]", rec.ratings)
	}
}
