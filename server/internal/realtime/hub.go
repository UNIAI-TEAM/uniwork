package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

// MembershipChecker verifies a user belongs to a workspace.
type MembershipChecker interface {
	IsMember(ctx context.Context, userID, workspaceID string) bool
}

// SlugResolver translates a workspace slug to its UUID.
type SlugResolver func(ctx context.Context, slug string) (workspaceID string, err error)

// OrganizationResolver names the organization a workspace belongs to, so a
// connection can join the organization scope without the client being told
// which organization it is in. Optional: without it the connection simply
// receives no organization-scoped events.
type OrganizationResolver func(ctx context.Context, workspaceID string) (organizationID string, err error)

// TokenParser turns a bearer token into a user ID. The hub does not know how
// tokens are minted — the auth package does — so it is handed the parser
// instead of a secret. Personal access tokens, if they ever exist, are the
// parser's business too.
type TokenParser func(token string) (userID string, err error)

// Identity is what a member socket's access token proves once its session
// has been checked.
type Identity struct {
	UserID    string
	SessionID string
	// ExpiresAt closes the socket when the token it was opened with expires;
	// zero keeps it open.
	ExpiresAt time.Time
}

// SessionParser verifies a member socket's access token, including that the
// session behind it is still live.
type SessionParser func(ctx context.Context, token string) (Identity, error)

// CloseSessionEnded closes a socket whose access token expired or whose
// session was revoked. The client refreshes its session before it
// reconnects; after any other close code it simply reconnects.
const CloseSessionEnded = 4001

// ScopeAuthorizer decides whether a connection (identified by userID +
// workspaceID) is allowed to subscribe to a given scope. Implementations
// typically perform a DB lookup on the underlying resource (task / chat
// session) and verify it belongs to workspaceID. Implementations should
// cache positive results to avoid hot-path DB load.
type ScopeAuthorizer interface {
	AuthorizeScope(ctx context.Context, userID, workspaceID, scopeType, scopeID string) (bool, error)
}

// ScopeReleaser is implemented by a ScopeAuthorizer that caches decisions.
// The hub calls it when a socket leaves a scope it was authorized for, by
// unsubscribing or disconnecting, so the next subscription is asked afresh.
type ScopeReleaser interface {
	ReleaseScope(userID, workspaceID, scopeType, scopeID string)
}

// ScopeRevoker is implemented by a ScopeAuthorizer that caches decisions:
// RevokeScope forgets every decision held for userID on scopeID, whatever
// workspace asked, or all of userID's when scopeID is "".
type ScopeRevoker interface {
	RevokeScope(userID, scopeType, scopeID string)
}

// ScopeAuthorizers routes each scope type to its own authorizer. A scope type
// without one is refused.
type ScopeAuthorizers map[string]ScopeAuthorizer

// AuthorizeScope asks the authorizer registered for scopeType.
func (m ScopeAuthorizers) AuthorizeScope(ctx context.Context, userID, workspaceID, scopeType, scopeID string) (bool, error) {
	a, ok := m[scopeType]
	if !ok || a == nil {
		return false, nil
	}
	return a.AuthorizeScope(ctx, userID, workspaceID, scopeType, scopeID)
}

// ReleaseScope forwards to the scope type's authorizer when it caches.
func (m ScopeAuthorizers) ReleaseScope(userID, workspaceID, scopeType, scopeID string) {
	if r, ok := m[scopeType].(ScopeReleaser); ok {
		r.ReleaseScope(userID, workspaceID, scopeType, scopeID)
	}
}

// RevokeScope forwards to the caching authorizers, every scope type's when
// scopeType is "".
func (m ScopeAuthorizers) RevokeScope(userID, scopeType, scopeID string) {
	for t, a := range m {
		if r, ok := a.(ScopeRevoker); ok && (scopeType == "" || t == scopeType) {
			r.RevokeScope(userID, t, scopeID)
		}
	}
}

// scopeAuthorizeTimeout bounds one subscription check, which runs on the
// socket's read loop: a slow database must not stall the socket's pings.
const scopeAuthorizeTimeout = 5 * time.Second

var allowedWSOrigins atomic.Value // holds []string
var trustedProxies atomic.Value   // holds []netip.Prefix

func init() {
	allowedWSOrigins.Store(loadAllowedOrigins())
	trustedProxies.Store(loadTrustedProxies())
}

func loadAllowedOrigins() []string {
	// ALLOWED_ORIGINS widens the WebSocket allowlist beyond FRONTEND_ORIGIN
	// (a second host serving the same app); FRONTEND_ORIGIN alone is the
	// common case and what CORS allows.
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN"))
	}
	if raw == "" {
		return []string{
			"http://localhost:3000",
			"http://localhost:5173",
			"http://localhost:5174",
		}
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

// loadTrustedProxies reads the same TRUSTED_PROXIES env var the rate limiter
// uses (config.Config.TrustedProxies), parsing it as a comma-separated list
// of CIDR prefixes. Invalid entries are dropped with a warn-line rather than
// crashing. Empty input returns nil, which means "trust no proxy" —
// X-Forwarded-Host is then never honored. SetTrustedProxies exists for tests.
func loadTrustedProxies() []netip.Prefix {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return nil
	}
	var prefixes []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
		s := strings.TrimSpace(part)
		if s == "" {
			continue
		}
		p, err := netip.ParsePrefix(s)
		if err != nil {
			slog.Warn("ws: ignoring invalid trusted proxy CIDR", "value", s, "error", err)
			continue
		}
		prefixes = append(prefixes, p)
	}
	return prefixes
}

// SetAllowedOrigins overrides the WebSocket origin whitelist.
func SetAllowedOrigins(origins []string) {
	allowedWSOrigins.Store(origins)
}

// SetTrustedProxies overrides the trusted proxy CIDR list. The server wires the
// shared TRUSTED_PROXIES value in here at startup.
func SetTrustedProxies(proxies []netip.Prefix) {
	trustedProxies.Store(proxies)
}

// isTrustedProxy reports whether the request's remote address falls within one
// of the configured trusted proxy CIDRs.
func isTrustedProxy(remoteAddr string) bool {
	proxies := trustedProxies.Load().([]netip.Prefix)
	if len(proxies) == 0 {
		return false
	}
	addr, err := netip.ParseAddr(remoteHost(remoteAddr))
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	for _, p := range proxies {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// remoteHost extracts the host/IP from an http.Request.RemoteAddr, which is
// normally "host:port". It handles bracketed IPv6 ("[::1]:443") via
// net.SplitHostPort and falls back to the raw value (sans brackets) when no
// port is present.
func remoteHost(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return strings.Trim(remoteAddr, "[]")
}

// firstForwardedHost returns the first host from a (possibly comma-separated)
// X-Forwarded-Host header. Proxy chains append values left-to-right, so the
// first entry is the original client-facing host we compare against Origin.
func firstForwardedHost(h string) string {
	if i := strings.IndexByte(h, ','); i >= 0 {
		h = h[:i]
	}
	return strings.TrimSpace(h)
}

func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	// Same-origin: native clients (mobile, CLI) have no real page host, so
	// their WebSocket library fills Origin with the connection target —
	// which equals the server's own Host. They authenticate via bearer
	// token, not auto-attached cookies, so CSRF (the attack the explicit
	// allowlist below defends against) does not apply. This matches the
	// gorilla/websocket default CheckOrigin behavior; the allowlist exists
	// in addition to support cross-origin browser clients (web/desktop).
	if u, err := url.Parse(origin); err == nil && strings.EqualFold(u.Host, r.Host) {
		return true
	}
	// Reverse-proxy support: when sitting behind a proxy the Host header
	// contains the internal address. X-Forwarded-Host carries the original
	// public host seen by the client, so we treat a matching origin as
	// same-origin in that case too. SECURITY: Only trust X-Forwarded-Host
	// if the request comes from a trusted proxy to prevent header spoofing.
	if fwdHost := firstForwardedHost(r.Header.Get("X-Forwarded-Host")); fwdHost != "" && isTrustedProxy(r.RemoteAddr) {
		if u, err := url.Parse(origin); err == nil && strings.EqualFold(u.Host, fwdHost) {
			return true
		}
	}
	origins := allowedWSOrigins.Load().([]string)
	for _, allowed := range origins {
		if origin == allowed {
			return true
		}
	}
	slog.Warn("ws: rejected origin", "origin", origin, "remote_addr", r.RemoteAddr)
	return false
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10

	// inboundReadLimit caps a single inbound message. Every frame a client
	// legitimately sends is tiny — the largest is the token auth frame, well
	// under 1 KiB — but gorilla buffers a whole message in memory before
	// handing it over, and a fragmented message keeps the read deadline alive
	// through interleaved pongs. Without a limit one connection can therefore
	// grow that buffer without bound and OOM the process. Matches the usf daemon
	// hub limit so both WebSocket surfaces answer this question the same way.
	inboundReadLimit = 64 * 1024

	// inboundFrameRate and inboundFrameBurst bound how fast one socket may
	// send frames; past them it is closed with 1008. Steady traffic is a ping
	// every 25s and the odd subscribe, but a client replays all its scopes on
	// reconnect and swaps up to 25 lazily subscribed chat rooms as
	// unsubscribe+subscribe pairs at once, so the burst covers that.
	inboundFrameRate  = 10
	inboundFrameBurst = 60

	// maxScopesPerSocket caps the scopes one socket holds, the identity
	// scopes joined at connect time included. The web client asks for at most
	// 25 chat rooms plus the open task or meeting.
	maxScopesPerSocket = 50
)

var upgrader = websocket.Upgrader{
	CheckOrigin: checkOrigin,
}

// scopeKey is the composite key used to look up a "room" of subscribers.
type scopeKey struct {
	Type string
	ID   string
}

func sk(t, id string) scopeKey { return scopeKey{Type: t, ID: id} }

// Client represents a single WebSocket connection with identity and the set
// of scopes it is currently subscribed to.
type Client struct {
	hub            *Hub
	conn           *websocket.Conn
	send           chan []byte
	userID         string
	sessionID      string
	expiresAt      time.Time
	workspaceID    string
	organizationID string
	// lobbyMeetingID is set for public meeting lobby sockets; subscribed after register.
	lobbyMeetingID string

	// subscriptions is guarded by hub.mu. Tracks the scopes this client is
	// currently in. Used to clean up rooms on disconnect.
	subscriptions map[scopeKey]bool
	// sendClosed is guarded by hub.mu and set when the hub closes send.
	sendClosed bool

	// lastSeenEventIDs is used by the dual-write broadcaster (and any
	// future deliverer) to dedup messages that arrived first via the local
	// fast path and are then re-played from Redis. Bounded LRU semantics
	// are not required because event IDs are ULIDs and we only keep the
	// last few.
	dedupMu  sync.Mutex
	seenIDs  map[string]struct{}
	seenList []string
}

const dedupCapacity = 128

// markSeen records eventID as already delivered to this client. Returns true
// if it was the first time we saw this id (caller should deliver), false if
// it's a duplicate (caller should drop).
func (c *Client) markSeen(eventID string) bool {
	if eventID == "" {
		return true
	}
	c.dedupMu.Lock()
	defer c.dedupMu.Unlock()
	if c.seenIDs == nil {
		c.seenIDs = make(map[string]struct{}, dedupCapacity)
	}
	if _, ok := c.seenIDs[eventID]; ok {
		return false
	}
	c.seenIDs[eventID] = struct{}{}
	c.seenList = append(c.seenList, eventID)
	if len(c.seenList) > dedupCapacity {
		drop := c.seenList[0]
		c.seenList = c.seenList[1:]
		delete(c.seenIDs, drop)
	}
	return true
}

// SubscriptionCallback fires when a scope's local subscriber count crosses
// 0↔1 boundaries. Used by the Redis relay to start/stop XREADGROUP loops on
// demand.
type SubscriptionCallback func(scopeType, scopeID string)

// Hub manages WebSocket connections organized into scope-based rooms.
type Hub struct {
	rooms      map[scopeKey]map[*Client]bool
	clients    map[*Client]bool // every connected client (used by global Broadcast and snapshots)
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex

	authorizer ScopeAuthorizer
	orgOf      OrganizationResolver

	// Subscription lifecycle hooks. Both can be nil.
	onFirstSubscriber SubscriptionCallback
	onLastSubscriber  SubscriptionCallback
}

// NewHub creates a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[scopeKey]map[*Client]bool),
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// SetAuthorizer wires a ScopeAuthorizer into the hub. Safe to call before Run.
func (h *Hub) SetAuthorizer(a ScopeAuthorizer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.authorizer = a
}

// SetOrganizationResolver wires the lookup that puts a connection into its
// organization scope. Safe to call before Run.
func (h *Hub) SetOrganizationResolver(f OrganizationResolver) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.orgOf = f
}

func (h *Hub) scopeAuthorizer() ScopeAuthorizer {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.authorizer
}

// releaseScopes tells a caching authorizer that client no longer holds keys.
// Only scopes the authorizer decided are released; the identity scopes a
// socket joins at connect time never went through it.
func (h *Hub) releaseScopes(client *Client, keys []scopeKey) {
	r, ok := h.scopeAuthorizer().(ScopeReleaser)
	if !ok {
		return
	}
	for _, key := range keys {
		if key.Type == ScopeMeeting {
			r.ReleaseScope(client.userID, client.workspaceID, key.Type, key.ID)
		}
	}
}

func (h *Hub) organizationResolver() OrganizationResolver {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.orgOf
}

// SetSubscriptionCallbacks registers callbacks fired when a scope on this
// node transitions from 0→1 subscribers (onFirst) or 1→0 (onLast). The
// Redis relay uses these to start/stop a per-scope consumer loop.
func (h *Hub) SetSubscriptionCallbacks(onFirst, onLast SubscriptionCallback) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.onFirstSubscriber = onFirst
	h.onLastSubscriber = onLast
}

// Run starts the hub event loop.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			total := len(h.clients)
			h.mu.Unlock()
			M.ConnectsTotal.Add(1)
			M.ActiveConnections.Add(1)
			// Auto-subscribe to the workspace and user scopes.
			if client.workspaceID != "" {
				h.subscribe(client, ScopeWorkspace, client.workspaceID)
			}
			if client.userID != "" && client.workspaceID != "" {
				h.subscribe(client, ScopeUser, client.userID)
			}
			if client.organizationID != "" {
				h.subscribe(client, ScopeOrganization, client.organizationID)
			}
			if client.lobbyMeetingID != "" {
				h.subscribe(client, ScopeMeetingLobby, client.lobbyMeetingID)
			}
			slog.Info("ws client connected", "workspace_id", client.workspaceID, "user_id", client.userID, "total_clients", total)

		case client := <-h.unregister:
			h.removeClient(client)

		case message := <-h.broadcast:
			h.fanoutAll(message, "")
		}
	}
}

// removeClient drops a client from all rooms and the global set.
func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	if !h.clients[client] {
		h.mu.Unlock()
		return
	}
	delete(h.clients, client)
	subs := client.subscriptions
	client.subscriptions = nil
	emptied := make([]scopeKey, 0, len(subs))
	held := make([]scopeKey, 0, len(subs))
	for key := range subs {
		held = append(held, key)
		if room, ok := h.rooms[key]; ok {
			delete(room, client)
			if len(room) == 0 {
				delete(h.rooms, key)
				emptied = append(emptied, key)
			}
		}
	}
	close(client.send)
	client.sendClosed = true
	cb := h.onLastSubscriber
	total := len(h.clients)
	h.mu.Unlock()

	M.DisconnectsTotal.Add(1)
	M.ActiveConnections.Add(-1)
	h.releaseScopes(client, held)
	if cb != nil {
		for _, key := range emptied {
			cb(key.Type, key.ID)
		}
	}
	for _, key := range emptied {
		M.DecRoom(key.Type)
	}
	slog.Info("ws client disconnected", "workspace_id", client.workspaceID, "user_id", client.userID, "total_clients", total)
}

// subscribe adds client to scope (scopeType, scopeID) and fires the
// onFirstSubscriber callback if the room transitioned from empty to non-empty.
// Returns true if the subscription was newly added.
func (h *Hub) subscribe(client *Client, scopeType, scopeID string) bool {
	if scopeType == "" || scopeID == "" {
		return false
	}
	key := sk(scopeType, scopeID)

	h.mu.Lock()
	if !h.clients[client] {
		h.mu.Unlock()
		return false
	}
	if client.subscriptions == nil {
		client.subscriptions = map[scopeKey]bool{}
	}
	if client.subscriptions[key] {
		h.mu.Unlock()
		return false
	}
	client.subscriptions[key] = true
	room, ok := h.rooms[key]
	first := false
	if !ok {
		room = make(map[*Client]bool)
		h.rooms[key] = room
		first = true
	}
	room[client] = true
	cb := h.onFirstSubscriber
	h.mu.Unlock()

	M.SubscribesTotal(scopeType).Add(1)
	if first {
		M.IncRoom(scopeType)
		if cb != nil {
			cb(scopeType, scopeID)
		}
	}
	return true
}

// unsubscribe removes client from a scope room and fires onLastSubscriber if
// the room is now empty.
func (h *Hub) unsubscribe(client *Client, scopeType, scopeID string) bool {
	if scopeType == "" || scopeID == "" {
		return false
	}
	key := sk(scopeType, scopeID)

	h.mu.Lock()
	if !h.clients[client] {
		h.mu.Unlock()
		return false
	}
	if client.subscriptions == nil || !client.subscriptions[key] {
		h.mu.Unlock()
		return false
	}
	delete(client.subscriptions, key)
	emptied := false
	if room, ok := h.rooms[key]; ok {
		delete(room, client)
		if len(room) == 0 {
			delete(h.rooms, key)
			emptied = true
		}
	}
	cb := h.onLastSubscriber
	h.mu.Unlock()

	M.UnsubscribesTotal(scopeType).Add(1)
	if emptied {
		M.DecRoom(scopeType)
		if cb != nil {
			cb(scopeType, scopeID)
		}
	}
	return true
}

// HasLocalSubscribers reports whether at least one local client is subscribed
// to (scopeType, scopeID). Used by the Redis relay to decide whether to keep
// a per-scope consumer running.
func (h *Hub) HasLocalSubscribers(scopeType, scopeID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.rooms[sk(scopeType, scopeID)]
	return ok
}

// LocalScopes returns the set of scopes currently active on this node.
// Snapshot only — callers must not assume thread-stability.
func (h *Hub) LocalScopes() []scopeKey {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]scopeKey, 0, len(h.rooms))
	for k := range h.rooms {
		out = append(out, k)
	}
	return out
}

// BroadcastToScope sends a message to every client subscribed to
// (scopeType, scopeID). Slow clients are evicted under write lock.
func (h *Hub) BroadcastToScope(scopeType, scopeID string, message []byte) {
	h.BroadcastToScopeDedup(scopeType, scopeID, message, "")
}

// BroadcastToScopeDedup is the same as BroadcastToScope but skips delivery
// to clients that have already seen eventID (used by the Redis relay to
// deduplicate the local fast path of DualWriteBroadcaster).
func (h *Hub) BroadcastToScopeDedup(scopeType, scopeID string, message []byte, eventID string) {
	if scopeType == "" || scopeID == "" {
		return
	}
	key := sk(scopeType, scopeID)

	h.mu.RLock()
	clients := h.rooms[key]
	var slow []*Client
	var sent int64
	for client := range clients {
		if !client.markSeen(eventID) {
			continue
		}
		select {
		case client.send <- message:
			sent++
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()

	if sent > 0 {
		M.MessagesSentTotal.Add(sent)
	}
	if len(slow) > 0 {
		h.evictSlow(slow)
	}
}

// fanoutAll delivers message to every connected client. If excludeWorkspace
// is non-empty, clients whose workspaceID matches are skipped (used by the
// member:added dedup semantics carried over from SendToUser). eventID is the
// dedup key (empty disables dedup).
func (h *Hub) fanoutAll(message []byte, excludeWorkspace string) {
	h.fanoutAllDedup(message, excludeWorkspace, "")
}

func (h *Hub) fanoutAllDedup(message []byte, excludeWorkspace, eventID string) {
	h.mu.RLock()
	var slow []*Client
	var sent int64
	for client := range h.clients {
		if excludeWorkspace != "" && client.workspaceID == excludeWorkspace {
			continue
		}
		if !client.markSeen(eventID) {
			continue
		}
		select {
		case client.send <- message:
			sent++
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()

	if sent > 0 {
		M.MessagesSentTotal.Add(sent)
	}
	if len(slow) > 0 {
		h.evictSlow(slow)
	}
}

// BroadcastToWorkspace is a back-compat shortcut.
func (h *Hub) BroadcastToWorkspace(workspaceID string, message []byte) {
	h.BroadcastToScope(ScopeWorkspace, workspaceID, message)
}

// SendToUser delivers a message to every connection belonging to userID,
// skipping any connections whose workspaceID matches excludeWorkspace.
func (h *Hub) SendToUser(userID string, message []byte, excludeWorkspace ...string) {
	exclude := ""
	if len(excludeWorkspace) > 0 {
		exclude = excludeWorkspace[0]
	}
	h.fanoutUser(userID, message, exclude, "")
}

// Broadcast sends a message to every connected client, regardless of workspace.
func (h *Hub) Broadcast(message []byte) {
	h.broadcast <- message
}

// fanoutUser delivers a message to all clients in the user scope, optionally
// excluding clients in excludeWorkspace and deduping against eventID.
func (h *Hub) fanoutUser(userID string, message []byte, excludeWorkspace, eventID string) {
	key := sk(ScopeUser, userID)
	h.mu.RLock()
	clients := h.rooms[key]
	var slow []*Client
	var sent int64
	for client := range clients {
		if excludeWorkspace != "" && client.workspaceID == excludeWorkspace {
			continue
		}
		if !client.markSeen(eventID) {
			continue
		}
		select {
		case client.send <- message:
			sent++
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()
	if sent > 0 {
		M.MessagesSentTotal.Add(sent)
	}
	if len(slow) > 0 {
		h.evictSlow(slow)
	}
}

// evictSlow removes clients whose send channel was full. Mirrors the
// pre-phase-1 behavior: closes the send channel, decrements counters, fires
// onLastSubscriber for any rooms drained as a side effect.
func (h *Hub) evictSlow(slow []*Client) {
	M.MessagesDroppedTotal.Add(int64(len(slow)))
	M.SlowEvictionsTotal.Add(int64(len(slow)))

	h.mu.Lock()
	evicted := 0
	type emptied struct {
		Type, ID string
	}
	var drainedRooms []emptied
	type heldScopes struct {
		client *Client
		keys   []scopeKey
	}
	var released []heldScopes
	for _, c := range slow {
		if !h.clients[c] {
			continue
		}
		delete(h.clients, c)
		held := heldScopes{client: c, keys: make([]scopeKey, 0, len(c.subscriptions))}
		for key := range c.subscriptions {
			held.keys = append(held.keys, key)
			if room, ok := h.rooms[key]; ok {
				delete(room, c)
				if len(room) == 0 {
					delete(h.rooms, key)
					drainedRooms = append(drainedRooms, emptied(key))
				}
			}
		}
		released = append(released, held)
		c.subscriptions = nil
		close(c.send)
		c.sendClosed = true
		evicted++
		// Otherwise the read side lives on until the write deadline, still
		// taking frames from a socket the hub has already dropped.
		if c.conn != nil {
			_ = c.conn.Close()
		}
	}
	cb := h.onLastSubscriber
	h.mu.Unlock()

	if evicted > 0 {
		M.ActiveConnections.Add(int64(-evicted))
		M.DisconnectsTotal.Add(int64(evicted))
	}
	for _, r := range released {
		h.releaseScopes(r.client, r.keys)
	}
	for _, r := range drainedRooms {
		M.DecRoom(r.Type)
	}
	if cb != nil {
		for _, r := range drainedRooms {
			cb(r.Type, r.ID)
		}
	}
}

// drainBatches is how many groups DrainConnections splits the sockets into.
const drainBatches = 20

// DrainConnections closes every socket with 1012 (service restart) in
// shuffled batches spread over window, so a deploy hands clients to the
// other nodes gradually instead of all reconnecting in the same second. Once
// ctx ends, whatever is left is closed at once.
func (h *Hub) DrainConnections(ctx context.Context, window time.Duration) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	rand.Shuffle(len(clients), func(i, j int) { clients[i], clients[j] = clients[j], clients[i] })

	n := min(drainBatches, len(clients))
	for i := range n {
		if i > 0 && ctx.Err() == nil {
			select {
			case <-ctx.Done():
			case <-time.After(window / time.Duration(n)):
			}
		}
		for _, c := range clients[i*len(clients)/n : (i+1)*len(clients)/n] {
			// One goroutine each: the close frame waits behind any write in
			// flight, and a stalled socket must not hold up the batch.
			go c.closeWith(websocket.CloseServiceRestart, "server restarting")
		}
	}
}

// closeWith tells the peer why it is being let go, then drops the
// connection; the read pump's cleanup unregisters the client.
func (c *Client) closeWith(code int, text string) {
	_ = c.conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(code, text), time.Now().Add(time.Second))
	_ = c.conn.Close()
}

// DisconnectUser closes userID's sockets on this node: every one when
// workspaceID is "", else those connected to workspaceID. Reconnecting goes
// through the membership check again, so it ends access the user has lost.
func (h *Hub) DisconnectUser(userID, workspaceID string) {
	h.disconnect(userID, websocket.ClosePolicyViolation, "access revoked", func(c *Client) bool {
		return workspaceID == "" || c.workspaceID == workspaceID
	})
}

// DisconnectSession closes the sockets userID opened under sessionID, or all
// of the user's when sessionID is "".
func (h *Hub) DisconnectSession(userID, sessionID string) {
	h.disconnect(userID, CloseSessionEnded, "session ended", func(c *Client) bool {
		return sessionID == "" || c.sessionID == sessionID
	})
}

func (h *Hub) disconnect(userID string, code int, text string, match func(*Client) bool) {
	if userID == "" {
		return
	}
	if r, ok := h.scopeAuthorizer().(ScopeRevoker); ok {
		r.RevokeScope(userID, "", "")
	}
	h.mu.RLock()
	var hit []*Client
	for c := range h.clients {
		if c.userID == userID && c.conn != nil && match(c) {
			hit = append(hit, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range hit {
		go c.closeWith(code, text)
	}
}

// RevokeScope asks the authorizer afresh, past its cache, whether each of
// userID's sockets holding (scopeType, scopeID) may keep it, and drops it
// from those it no longer admits: a member kicked from a private room loses
// it, one who left a public channel they can still read does not.
func (h *Hub) RevokeScope(userID, scopeType, scopeID string) {
	auth := h.scopeAuthorizer()
	if r, ok := auth.(ScopeRevoker); ok {
		r.RevokeScope(userID, scopeType, scopeID)
	}
	h.mu.RLock()
	var holders []*Client
	for c := range h.rooms[sk(scopeType, scopeID)] {
		if c.userID == userID {
			holders = append(holders, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range holders {
		reason := "forbidden"
		if auth != nil {
			reason = c.authorizeScope(auth, scopeType, scopeID)
		}
		if reason != "" && h.unsubscribe(c, scopeType, scopeID) {
			h.releaseScopes(c, []scopeKey{sk(scopeType, scopeID)})
			c.refuseSubscribe(scopeType, scopeID, reason)
		}
	}
}

// Snapshot returns a JSON-friendly summary of the hub state.
func (h *Hub) Snapshot() map[string]any {
	h.mu.RLock()
	defer h.mu.RUnlock()
	rooms := map[string]int{}
	for key := range h.rooms {
		rooms[key.Type]++
	}
	return map[string]any{
		"connections": len(h.clients),
		"rooms":       rooms,
	}
}

// authenticateToken validates a bearer token and returns the user ID, or a
// JSON error body for the caller to write back.
func authenticateToken(tokenStr string, parse TokenParser) (string, string) {
	if parse == nil {
		return "", `{"error":"invalid token"}`
	}
	uid, err := parse(tokenStr)
	if err != nil || strings.TrimSpace(uid) == "" {
		return "", `{"error":"invalid token"}`
	}
	return uid, ""
}

// firstMessageAuth reads the first WebSocket message expecting an auth payload.
// A non-empty errMsg is for the caller to write back before closing the
// connection. closed=true means the connection is already torn down and the
// caller must return without writing anything further.
func firstMessageAuth(conn *websocket.Conn) (token, errMsg string, closed bool) {
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	defer conn.SetReadDeadline(time.Time{})

	_, raw, err := conn.ReadMessage()
	if err != nil {
		if errors.Is(err, websocket.ErrReadLimit) {
			// gorilla has already replied CloseMessageTooBig (1009), so an
			// auth_error frame here would be data sent after a close frame.
			// Counted separately to keep the breach out of ordinary churn.
			M.InboundTooLargeTotal.Add(1)
			slog.Warn("ws: pre-auth frame exceeded read limit", "limit_bytes", inboundReadLimit)
			conn.Close()
			return "", "", true
		}
		return "", `{"error":"auth timeout or read error"}`, false
	}

	var msg struct {
		Type    string `json:"type"`
		Payload struct {
			Token string `json:"token"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Type != "auth" || msg.Payload.Token == "" {
		return "", `{"error":"expected auth message as first frame"}`, false
	}

	return msg.Payload.Token, "", false
}

type wsMessageWriter interface {
	WriteMessage(messageType int, data []byte) error
}

func writeWSAuthFrame(conn wsMessageWriter, payload []byte, frame string, attrs ...any) bool {
	if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		logAttrs := append([]any{"frame", frame, "error", err}, attrs...)
		slog.Warn("ws: failed to send auth frame", logAttrs...)
		return false
	}
	return true
}

func writeWSAuthErrorAndClose(conn *websocket.Conn, payload []byte, attrs ...any) {
	writeWSAuthFrame(conn, payload, "auth_error", attrs...)
	conn.Close()
}

// HandleWebSocket upgrades an HTTP connection to WebSocket with cookie or
// first-message auth.
func HandleWebSocket(hub *Hub, mc MembershipChecker, parse SessionParser, resolveSlug SlugResolver, w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		if slug := r.URL.Query().Get("workspace_slug"); slug != "" && resolveSlug != nil {
			resolved, err := resolveSlug(r.Context(), slug)
			if err != nil {
				http.Error(w, `{"error":"workspace not found"}`, http.StatusNotFound)
				return
			}
			workspaceID = resolved
		}
	}
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace_id or workspace_slug required"}`, http.StatusBadRequest)
		return
	}

	var userID string
	var id Identity

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	// Bound inbound messages here rather than in readPump: the token auth
	// path below reads its first frame before the caller is authenticated, so
	// a limit installed any later leaves that read unbounded.
	conn.SetReadLimit(inboundReadLimit)

	if userID == "" {
		tokenStr, errMsg, closed := firstMessageAuth(conn)
		if closed {
			return
		}
		if errMsg != "" {
			writeWSAuthErrorAndClose(conn, []byte(errMsg), "workspace_id", workspaceID)
			return
		}
		id, err = parse(r.Context(), tokenStr)
		if err != nil || strings.TrimSpace(id.UserID) == "" {
			writeWSAuthErrorAndClose(conn, []byte(`{"error":"invalid token"}`), "workspace_id", workspaceID)
			return
		}
		uid := id.UserID
		if !mc.IsMember(r.Context(), uid, workspaceID) {
			writeWSAuthErrorAndClose(
				conn,
				[]byte(`{"error":"not a member of this workspace"}`),
				"workspace_id", workspaceID,
				"user_id", uid,
			)
			return
		}
		userID = uid

		if !writeWSAuthFrame(
			conn,
			[]byte(`{"type":"auth_ack"}`),
			"auth_ack",
			"workspace_id", workspaceID,
			"user_id", userID,
		) {
			conn.Close()
			return
		}
	}

	// Capture client metadata from query params (browsers cannot set custom
	// headers on WebSocket upgrades, so the WSClient passes them via the URL).
	// Logged with every connect so the same observability dimensions exist
	// for WS as for HTTP.
	clientPlatform := r.URL.Query().Get("client_platform")
	clientVersion := r.URL.Query().Get("client_version")
	clientOS := r.URL.Query().Get("client_os")
	slog.Info("websocket connected",
		"user_id", userID,
		"workspace_id", workspaceID,
		"client_platform", clientPlatform,
		"client_version", clientVersion,
		"client_os", clientOS,
	)

	// The organization scope is best-effort: a failed lookup costs the
	// connection its directory updates, never the connection itself.
	var organizationID string
	if resolveOrg := hub.organizationResolver(); resolveOrg != nil {
		if orgID, err := resolveOrg(r.Context(), workspaceID); err == nil {
			organizationID = orgID
		} else {
			slog.Warn("ws: organization scope unavailable", "workspace_id", workspaceID, "error", err)
		}
	}

	client := &Client{
		hub:            hub,
		conn:           conn,
		send:           make(chan []byte, 256),
		userID:         userID,
		sessionID:      id.SessionID,
		expiresAt:      id.ExpiresAt,
		workspaceID:    workspaceID,
		organizationID: organizationID,
	}
	hub.register <- client

	go client.writePump()
	go client.readPump()
}

// inboundFrame describes the subset of inbound JSON messages the server
// understands today.
type inboundFrame struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type subPayload struct {
	Scope string `json:"scope"`
	ID    string `json:"id"`
}

// recoverPump keeps a panic in one socket's pump from killing the process:
// it is logged, and the pump's own cleanup tears down that socket only.
func (c *Client) recoverPump(pump string) {
	if r := recover(); r != nil {
		slog.Error("ws: pump panic", "pump", pump, "panic", r, "stack", string(debug.Stack()),
			"user_id", c.userID, "workspace_id", c.workspaceID)
	}
}

func (c *Client) readPump() {
	defer func() {
		c.recoverPump("read")
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	limiter := rate.NewLimiter(inboundFrameRate, inboundFrameBurst)

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			switch {
			case errors.Is(err, websocket.ErrReadLimit):
				// Counted separately so an over-limit close stays visible
				// instead of blending into ordinary connection churn.
				M.InboundTooLargeTotal.Add(1)
				slog.Warn("ws: inbound frame exceeded read limit",
					"limit_bytes", inboundReadLimit,
					"user_id", c.userID,
					"workspace_id", c.workspaceID,
				)
			case websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure):
				slog.Debug("websocket read error", "error", err, "user_id", c.userID, "workspace_id", c.workspaceID)
			}
			break
		}
		// Any inbound data frame renews the deadline. Proxies that drop
		// WebSocket control ping/pong still pass application frames, and
		// clients send {"type":"ping"} as a keepalive through idle LBs.
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		if !limiter.Allow() {
			slog.Warn("ws: inbound frame rate exceeded, closing",
				"user_id", c.userID,
				"workspace_id", c.workspaceID,
			)
			_ = c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rate limit"),
				time.Now().Add(writeWait))
			break
		}
		c.handleFrame(raw)
	}
}

func (c *Client) handleFrame(raw []byte) {
	var f inboundFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		slog.Debug("ws inbound: invalid json", "error", err, "user_id", c.userID)
		return
	}
	switch f.Type {
	case "subscribe", "unsubscribe":
		var p subPayload
		if err := json.Unmarshal(f.Payload, &p); err != nil || p.Scope == "" || p.ID == "" {
			c.sendJSON(map[string]any{
				"type": f.Type + "_error",
				"payload": map[string]string{
					"scope": p.Scope,
					"id":    p.ID,
					"error": "invalid payload",
				},
			})
			return
		}
		if f.Type == "subscribe" {
			c.handleSubscribe(p.Scope, p.ID)
		} else {
			c.handleUnsubscribe(p.Scope, p.ID)
		}
	case "ping":
		c.sendJSON(map[string]string{"type": "pong"})
	default:
		// Unknown frame — ignore silently for forward compat.
		slog.Debug("ws inbound: unknown frame", "type", f.Type, "user_id", c.userID)
	}
}

func (c *Client) handleSubscribe(scope, id string) {
	if scope == ScopeTask || scope == ScopeChat || scope == ScopeMeeting {
		held, full := c.holds(scope, id)
		if held {
			// Authorized when it was taken: a repeat must not cost a lookup.
			c.ackSubscribe(scope, id)
			return
		}
		if full {
			c.refuseSubscribe(scope, id, "too_many_scopes")
			return
		}
	}
	switch scope {
	case ScopeWorkspace, ScopeUser, ScopeOrganization:
		// Implicit scopes — only allowed if it matches the connection identity.
		if (scope == ScopeWorkspace && id != c.workspaceID) ||
			(scope == ScopeUser && id != c.userID) ||
			(scope == ScopeOrganization && (c.organizationID == "" || id != c.organizationID)) {
			c.refuseSubscribe(scope, id, "forbidden")
			return
		}
		// Already auto-subscribed at connect time; reply ack idempotently.
		c.hub.subscribe(c, scope, id)
	case ScopeTask, ScopeChat:
		if auth := c.hub.scopeAuthorizer(); auth != nil {
			if reason := c.authorizeScope(auth, scope, id); reason != "" {
				c.refuseSubscribe(scope, id, reason)
				return
			}
		}
		c.hub.subscribe(c, scope, id)
	case ScopeMeeting:
		// Unlike task and chat, a meeting with no gate wired is refused: the
		// scope carries in-room traffic, so it fails closed. A lobby socket
		// has no workspace and already hears its meeting on the lobby scope.
		auth := c.hub.scopeAuthorizer()
		if auth == nil || c.workspaceID == "" {
			c.refuseSubscribe(scope, id, "forbidden")
			return
		}
		if reason := c.authorizeScope(auth, scope, id); reason != "" {
			c.refuseSubscribe(scope, id, reason)
			return
		}
		c.hub.subscribe(c, scope, id)
	default:
		c.refuseSubscribe(scope, id, "unknown_scope")
		return
	}
	c.ackSubscribe(scope, id)
}

func (c *Client) ackSubscribe(scope, id string) {
	c.sendJSON(map[string]any{
		"type":    "subscribe_ack",
		"payload": map[string]string{"scope": scope, "id": id},
	})
}

// holds reports whether the socket already holds (scope, id), and whether it
// is at maxScopesPerSocket and so may take no other scope.
func (c *Client) holds(scope, id string) (held, full bool) {
	c.hub.mu.RLock()
	defer c.hub.mu.RUnlock()
	return c.subscriptions[sk(scope, id)], len(c.subscriptions) >= maxScopesPerSocket
}

// authorizeScope returns "" when auth admits this socket to (scope, id), or
// the reason it does not.
func (c *Client) authorizeScope(auth ScopeAuthorizer, scope, id string) string {
	ctx, cancel := context.WithTimeout(context.Background(), scopeAuthorizeTimeout)
	defer cancel()
	ok, err := auth.AuthorizeScope(ctx, c.userID, c.workspaceID, scope, id)
	if err != nil {
		return "lookup_failed"
	}
	if !ok {
		return "forbidden"
	}
	return ""
}

func (c *Client) refuseSubscribe(scope, id, reason string) {
	M.SubscribeDeniedTotal(scope).Add(1)
	c.sendJSON(map[string]any{
		"type": "subscribe_error",
		"payload": map[string]string{
			"scope": scope,
			"id":    id,
			"error": reason,
		},
	})
}

func (c *Client) handleUnsubscribe(scope, id string) {
	if c.hub.unsubscribe(c, scope, id) {
		c.hub.releaseScopes(c, []scopeKey{sk(scope, id)})
	}
	c.sendJSON(map[string]any{
		"type":    "unsubscribe_ack",
		"payload": map[string]string{"scope": scope, "id": id},
	})
}

// sendJSON best-effort encodes v and pushes it to the client's send channel.
// Drops the message if the channel is full (the writePump will be evicted by
// the next BroadcastToScope cycle) or the hub has already dropped the client.
// The hub closes send under its write lock, so checking sendClosed under the
// read lock makes the send safe: the read pump of an evicted socket can still
// be handling a frame (C1: a send on the closed channel crashed the process).
func (c *Client) sendJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.hub.mu.RLock()
	defer c.hub.mu.RUnlock()
	if c.sendClosed {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	// Application keepalive beats edge/LB idle cuts (~50s) that ignore
	// WebSocket control frames. Interval stays under the observed cut.
	appKeepalive := time.NewTicker(25 * time.Second)
	var expired <-chan time.Time
	if !c.expiresAt.IsZero() {
		expiry := time.NewTimer(time.Until(c.expiresAt))
		defer expiry.Stop()
		expired = expiry.C
	}
	defer func() {
		c.recoverPump("write")
		ticker.Stop()
		appKeepalive.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				slog.Warn("websocket write error", "error", err, "user_id", c.userID, "workspace_id", c.workspaceID)
				return
			}
		case <-appKeepalive.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-expired:
			// The token vouched for this socket only until it expired; the
			// client refreshes its session and reconnects with a live one.
			_ = c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(CloseSessionEnded, "token expired"), time.Now().Add(writeWait))
			return
		}
	}
}
