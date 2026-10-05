package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisPresencePrefix namespaces the presence keys:
//
//	<prefix>ws:<workspace_id>  ZSET user_id → expiry (unix ms), one per workspace
//	<prefix>expiry             ZSET "<workspace_id>|<user_id>" → expiry, for the sweep
//
// Each script touches both under one call, so a beat and a sweep never see a
// half-written entry. Ids are ULIDs and never contain '|'. The scripts build
// the workspace key from the prefix, which assumes one Redis node (not
// Cluster) — the deployment the relay already assumes.
const redisPresencePrefix = "uw:presence:"

// A workspace set outlives its last entry by a TTL, so a workspace nobody
// beats in disappears without a sweep.
const redisPresenceKeyTTL = 2 * presenceTTL

// KEYS[1] workspace set, KEYS[2] expiry index; ARGV user, member, now, expires, key ttl.
// Returns 1 when the user was not online (no entry, or one already lapsed).
var presenceBeatScript = redis.NewScript(`
local prev = redis.call('ZSCORE', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[2])
if prev and tonumber(prev) > tonumber(ARGV[3]) then return 0 end
return 1
`)

// KEYS[1] workspace set, KEYS[2] expiry index; ARGV user, member.
// Returns 1 when an entry was there.
var presenceLeaveScript = redis.NewScript(`
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[2])
return removed
`)

// KEYS[1] expiry index; ARGV now, batch, workspace key prefix.
// Removes every lapsed entry (at most batch) and returns the members whose
// workspace entry had lapsed too: a beat since then moved both forward.
var presenceExpireScript = redis.NewScript(`
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
local out = {}
for _, m in ipairs(due) do
  redis.call('ZREM', KEYS[1], m)
  local sep = string.find(m, '|', 1, true)
  if sep then
    local wsKey = ARGV[3] .. string.sub(m, 1, sep - 1)
    local user = string.sub(m, sep + 1)
    local score = redis.call('ZSCORE', wsKey, user)
    if score and tonumber(score) <= tonumber(ARGV[1]) then
      redis.call('ZREM', wsKey, user)
      table.insert(out, m)
    end
  end
end
return out
`)

type redisPresenceStore struct {
	rdb    *redis.Client
	prefix string
}

func newRedisPresenceStore(rdb *redis.Client, prefix string) *redisPresenceStore {
	return &redisPresenceStore{rdb: rdb, prefix: prefix}
}

func (r *redisPresenceStore) workspaceKey(workspaceID string) string {
	return r.prefix + "ws:" + workspaceID
}

func (r *redisPresenceStore) expiryKey() string { return r.prefix + "expiry" }

func presenceMember(workspaceID, userID string) string { return workspaceID + "|" + userID }

func (r *redisPresenceStore) beat(ctx context.Context, workspaceID, userID string, now time.Time) (bool, error) {
	n, err := presenceBeatScript.Run(ctx, r.rdb,
		[]string{r.workspaceKey(workspaceID), r.expiryKey()},
		userID, presenceMember(workspaceID, userID),
		now.UnixMilli(), now.Add(presenceTTL).UnixMilli(), redisPresenceKeyTTL.Milliseconds(),
	).Int()
	if err != nil {
		return false, fmt.Errorf("presence beat: %w", err)
	}
	return n == 1, nil
}

func (r *redisPresenceStore) leave(ctx context.Context, workspaceID, userID string, _ time.Time) (bool, error) {
	n, err := presenceLeaveScript.Run(ctx, r.rdb,
		[]string{r.workspaceKey(workspaceID), r.expiryKey()},
		userID, presenceMember(workspaceID, userID),
	).Int()
	if err != nil {
		return false, fmt.Errorf("presence leave: %w", err)
	}
	return n == 1, nil
}

func (r *redisPresenceStore) online(ctx context.Context, workspaceID string, now time.Time) ([]string, error) {
	ids, err := r.rdb.ZRangeArgs(ctx, redis.ZRangeArgs{
		Key:     r.workspaceKey(workspaceID),
		Start:   "(" + strconv.FormatInt(now.UnixMilli(), 10),
		Stop:    "+inf",
		ByScore: true,
		Count:   presenceSnapshotLimit,
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("presence online: %w", err)
	}
	return ids, nil
}

func (r *redisPresenceStore) expire(ctx context.Context, now time.Time) ([]presenceEntry, error) {
	members, err := presenceExpireScript.Run(ctx, r.rdb,
		[]string{r.expiryKey()},
		now.UnixMilli(), presenceSweepBatch, r.prefix+"ws:",
	).StringSlice()
	if err != nil {
		return nil, fmt.Errorf("presence expire: %w", err)
	}
	out := make([]presenceEntry, 0, len(members))
	for _, m := range members {
		ws, user, ok := strings.Cut(m, "|")
		if ok {
			out = append(out, presenceEntry{workspaceID: ws, userID: user})
		}
	}
	return out, nil
}
