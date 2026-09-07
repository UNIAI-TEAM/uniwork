package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// ProviderConsumer exposes the meeting side of the outbox as a consumer the
// shared dispatcher can register. The work itself is unchanged — applyOutbox
// still talks to the conference provider — but the claim, lease and retry loop
// around it now belongs to internal/outbox, so a new consumer no longer means
// an edit to MeetingService.
func (s *MeetingService) ProviderConsumer() outbox.Consumer {
	return providerConsumer{s: s}
}

type providerConsumer struct{ s *MeetingService }

func (providerConsumer) Name() string { return "meeting-provider" }

func (providerConsumer) Topics() []string {
	return []string{"provider.ensure_session", "provider.remove_participant", "provider.end_session"}
}

func (c providerConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	return c.s.applyOutbox(ctx, ev)
}
