package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/service"
)

const channelPrefix = "ws:"

type publisher struct {
	hub *Hub
	red *redis.Client
	log *slog.Logger
}

// NewPublisher returns an EventPublisher. With redisURL empty it fans out
// in-process only; with Redis it PUBLISHes and a subscriber goroutine
// feeds the local hub, so multiple server instances stay in sync.
func NewPublisher(hub *Hub, redisURL string, log *slog.Logger) (service.EventPublisher, error) {
	p := &publisher{hub: hub, log: log}
	if redisURL == "" {
		return p, nil
	}
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	p.red = redis.NewClient(opt)
	go p.subscribe()
	return p, nil
}

func (p *publisher) Publish(ctx context.Context, workspaceID string, ev service.Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		p.log.Error("marshal event", "err", err)
		return
	}
	if p.red == nil {
		p.hub.Broadcast(workspaceID, b)
		return
	}
	if err := p.red.Publish(ctx, channelPrefix+workspaceID, b).Err(); err != nil {
		p.log.Error("redis publish", "err", err)
		p.hub.Broadcast(workspaceID, b) // degrade về local
	}
}

func (p *publisher) subscribe() {
	ctx := context.Background()
	sub := p.red.PSubscribe(ctx, channelPrefix+"*")
	for msg := range sub.Channel() {
		wsID := strings.TrimPrefix(msg.Channel, channelPrefix)
		p.hub.Broadcast(wsID, []byte(msg.Payload))
	}
}
