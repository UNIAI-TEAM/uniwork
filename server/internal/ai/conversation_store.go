package ai

import (
	"context"
	"errors"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// The UniWork AI conversation store (G6-D1 A9): the transcript lives on the
// server, encrypted, and the client never supplies history (security rule 7).
// The interface and its types live in this package because only internal/ai
// may call the Ai* sqlc queries (ADR 0010; TestAIPackageOnlyCallsAiQueries);
// the Postgres implementation over server/pkg/db/queries/ai_uniwork.sql, the
// migration and the TTL worker are W-B's, behind this shape (design:
// reports/g6-ai_server/g6-03a-design.md §9).
//
// Binding: a conversation is bound to (user, organization, document, module,
// device) as it was created; a request whose key differs gets a new
// conversation, never someone else's transcript (A9, OQ-P2).

// TTLs and the key env var of A9.
const (
	// ConversationIdleTTL is A9's idle lifetime, counted from last_used_at.
	ConversationIdleTTL = 30 * time.Minute
	// ConversationAbsoluteTTL is A9's absolute lifetime, counted from
	// created_at, whatever the traffic.
	ConversationAbsoluteTTL = 24 * time.Hour
	// ConversationKeyEnv names the base64 32-byte key the transcript is
	// sealed with (never AI_CREDENTIAL_KEY). Missing key means UniWork AI is
	// not configured: fail closed, never store plaintext.
	ConversationKeyEnv = "AI_CONVERSATION_KEY"
)

var (
	// ErrConversationExpired answers a conversation that is gone, expired or
	// bound to another scope; the client starts a new one (409).
	ErrConversationExpired = &Error{Code: "conversation_expired", Status: 409,
		Msg: "hội thoại đã hết hạn hoặc đã bị dọn; hãy bắt đầu hội thoại mới"}
	// ErrConversationStoreDisabled is a deployment without a transcript
	// store: UniWork AI reads as not configured.
	ErrConversationStoreDisabled = errors.New("ai: conversation store chưa được cấu hình")
)

// ConversationKey is what a conversation is bound to. Empty fields mean the
// route has none: the org route has no document and maybe no module (D-3),
// the session routes have no frame token.
type ConversationKey struct {
	OrganizationID string
	UserID         string
	DocumentID     string
	Module         string
	DeviceID       string
}

// Conversation is one server-held transcript with what the gates need.
type Conversation struct {
	ID             string
	OrganizationID string
	UserID         string
	DocumentID     string
	Module         string
	CreatedAt      time.Time
	LastUsedAt     time.Time
	ExpiresAt      time.Time
	Turns          []Turn
}

// Turn is one stored transcript message: exactly the provider.Message that
// was sent to (or received from) the model, so the history a later turn
// replays is what the model actually saw.
type Turn struct {
	Seq          int32
	RunID        string
	UsageEventID string
	CreatedAt    time.Time
	Message      provider.Message
}

// ConversationStore is W-B's seam. Resume/Create/Append/Rollback drive one
// turn; the Delete* methods are the cleanup triggers of A9 (document
// deleted, permission lost, a new conversation for the same key, the kill
// switch, sign-out) and Sweep is the TTL worker's entry.
//
// W-B may extend this interface; W-C is its only caller.
type ConversationStore interface {
	// Resume returns the live conversation named by conversationID when it
	// is unexpired and its key matches, and ErrConversationExpired
	// otherwise. An empty conversationID resumes the newest live
	// conversation for the key (and ErrConversationExpired when there is
	// none, so the caller Create()s one).
	Resume(ctx context.Context, key ConversationKey, conversationID string) (Conversation, error)
	// Create starts a conversation for the key, deleting any other live
	// conversation of the same (organization, user, document, module) in
	// the same transaction (A9: "new conversation" replaces the old one).
	Create(ctx context.Context, key ConversationKey) (Conversation, error)
	// Append stores the turns of the current attempt, oldest first, and
	// touches last_used_at. It keeps at most UniworkMaxUserTurns user turns
	// (A7), dropping the oldest complete blocks.
	Append(ctx context.Context, conversationID string, turns []Turn) error
	// Rollback drops the turns of a failed attempt so they never enter the
	// history a later run replays: keep is the turn count before the
	// attempt (spike §4.9, rollbackFailedRun).
	Rollback(ctx context.Context, conversationID string, keep int) error
	// Delete removes one conversation and its turns.
	Delete(ctx context.Context, conversationID string) error
	// DeleteByDocument removes every conversation of a deleted document.
	DeleteByDocument(ctx context.Context, organizationID, documentID string) error
	// DeleteByUserDocument removes one user's conversations for a document
	// they lost access to.
	DeleteByUserDocument(ctx context.Context, organizationID, userID, documentID string) error
	// DeleteByUser removes a person's conversations (sign-out, removal).
	DeleteByUser(ctx context.Context, organizationID, userID string) error
	// DeleteByOrganization removes every conversation of an organization
	// (the kill switch turned off, or the organization is gone).
	DeleteByOrganization(ctx context.Context, organizationID string) error
	// Sweep deletes conversations past their idle or absolute TTL and
	// reports how many it removed.
	Sweep(ctx context.Context, now time.Time) (int64, error)
}
