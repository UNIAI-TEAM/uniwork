package realtime

import "github.com/redis/go-redis/v9"

// relayReadPoolSize bounds the reader's connections. The relay holds one per
// scope with local subscribers (workspace, user, organization, open chats,
// tasks and meetings) for up to its 5s block, so the pool has to grow with
// the scopes a node serves; connections are dialed only when a consumer
// needs one.
const relayReadPoolSize = 1024

// NewRelayReadClient returns a client for the relay's blocking XREADGROUP
// calls: same server and database as shared, but its own pool. On the shared
// pool (10 × GOMAXPROCS by default) a handful of subscribed scopes pins every
// connection and each request-path Redis call — the global rate limiter in
// front of /healthz among them — waits for a block to end.
func NewRelayReadClient(shared *redis.Client) *redis.Client {
	opts := *shared.Options()
	opts.PoolSize = relayReadPoolSize
	return redis.NewClient(&opts)
}
