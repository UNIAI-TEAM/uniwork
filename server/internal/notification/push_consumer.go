package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PushConsumer delivers notification.push rows to every browser the
// recipient registered. It is its own consumer so a push service outage
// retries the push, never the creation of the notification.
type PushConsumer struct {
	q        *db.Queries
	sender   PushSender
	origin   string // FRONTEND_ORIGIN, the root of every deep link
	metrics  Metrics
	presence PresenceChecker
	calls    CallRingChecker
	// mobileCalls is the unichat_mobile_calls kill switch for a recipient;
	// nil means calls ring.
	mobileCalls func(ctx context.Context, userID, organizationID string) bool
	// mobileCallsIOS is the unichat_mobile_calls_ios switch: off, an iPhone
	// gets no ring; nil means iPhones ring like the rest.
	mobileCallsIOS func(ctx context.Context, userID, organizationID string) bool
	badges         BadgeCounter
	now            func() time.Time
}

// BadgeCounter is the app icon's count for a person: everything unread they
// can reach in chat (ChatService.UnreadBadge in production).
type BadgeCounter interface {
	UnreadBadge(ctx context.Context, userID string) (int, error)
}

// PresenceChecker says when a user last had a visible chat presence heartbeat
// in a workspace, unless a page of theirs left it since (ChatService in
// production).
type PresenceChecker interface {
	LastPresenceBeat(ctx context.Context, userID, workspaceID string) (time.Time, bool, error)
}

// pushActiveWindow: a recipient who beat this recently in the push's
// workspace (for a DM or group, in any workspace of its organization:
// readingRoom) is reading it and sees the message in the app, so the chat push
// is dropped (spec N2 §3.5). A visible page beats every 15s, so three beats'
// worth outlasts a late or lost one. A page that leaves (a tab closing, the
// phone going to the background) clears its beat at once; the window only
// bounds what a crash or a lost network costs. It was two minutes, and every
// message in the first two minutes after a phone was put away went
// unnotified (audit "Calls, push & background", chat-push-swallowed).
const pushActiveWindow = 45 * time.Second

// chatAlertWindow: every chat message pushes (UNI-2141), but a burst in one
// room (or thread) alerts once. A push that follows, within this long, the
// last one a phone alerted for in the same open row shows quietly — no sound,
// no vibration — and the next one after it alerts again, so a long exchange
// still sounds about twice a minute rather than going silent. 30 seconds
// holds the burst of one person typing several lines (a few seconds apart)
// to one alert, while a reply that comes after a pause — someone answering
// a question — sounds. It is shorter than pushActiveWindow, so a person who
// put the phone away mid-conversation is not left silent for long, and a read
// closes the row, so the first message after reading always alerts.
const chatAlertWindow = 30 * time.Second

// readingRoom says whether the recipient has a visible page that beat within
// pushActiveWindow somewhere this room's messages show. A channel shows in its
// own workspace only. A DM or group belongs to the organization and shows in
// every workspace of it the person can open, while the notification carries
// just one of them (chatRecipientWorkspace: the room's anchor, or the
// person's first workspace there), so someone reading the DM from another
// workspace of the organization is reading it all the same. Presence is
// best-effort: a lookup error or a stalled Redis reads as not reading, so the
// push goes out (fail open), and every lookup shares one 100ms bound — the
// rate limiter's — so a stalled Redis cannot hold the push lane.
func (c *PushConsumer) readingRoom(ctx context.Context, n db.Notification, roomID string) (bool, error) {
	workspaces := []string{n.WorkspaceID.String}
	room, err := c.q.GetChatRoomByID(ctx, roomID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil && (room.Kind == "dm" || room.Kind == "group") && room.OrganizationID == n.OrganizationID {
		all, err := c.q.ListWorkspacesForUser(ctx, n.UserID)
		if err != nil {
			return false, err
		}
		for _, w := range all {
			if w.OrganizationID == n.OrganizationID && w.ID != n.WorkspaceID.String {
				workspaces = append(workspaces, w.ID)
			}
		}
	}
	pctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	for _, ws := range workspaces {
		t, ok, err := c.presence.LastPresenceBeat(pctx, n.UserID, ws)
		if err != nil {
			return false, nil
		}
		if ok && c.now().Sub(t) <= pushActiveWindow {
			return true, nil
		}
	}
	return false, nil
}

// NewPushConsumer wires the consumer; a nil sender means push is off and
// rows are acknowledged without sending.
func NewPushConsumer(q *db.Queries, sender PushSender, frontendOrigin string) *PushConsumer {
	return &PushConsumer{q: q, sender: sender, origin: strings.TrimRight(frontendOrigin, "/"), now: time.Now}
}

// SetPresence lets chat pushes skip a recipient who is active right now.
// Without it, or when it errors, every push goes out.
func (c *PushConsumer) SetPresence(p PresenceChecker) { c.presence = p }

// SetCallRinging lets a call's push go only while the call still rings: the
// rule checked it, but the call may have been answered or ended between that
// check and this lane. Without it, the ring window alone decides.
func (c *PushConsumer) SetCallRinging(r CallRingChecker) { c.calls = r }

// SetMobileCalls wires the calls kill switch (featureflags
// unichat_mobile_calls, evaluated for the recipient and the notification's
// organization). Off, an incoming call pushes nothing: the phone would ring
// for a feature its own config has turned off, and the call push goes to
// phones only, so nothing else loses it. The inbox row stays.
func (c *PushConsumer) SetMobileCalls(on func(ctx context.Context, userID, organizationID string) bool) {
	c.mobileCalls = on
}

// SetMobileCallsIOS wires the iPhone calls switch (featureflags
// unichat_mobile_calls_ios, off by default). Without CallKit and PushKit an
// iPhone cannot ring: a ring would be one short sound and a "X đang gọi"
// banner that stays after the call ends, since no end reaches it. Off, a call
// skips the person's iPhones and still rings their Android phones; the phone
// itself hides calling (featureflags.MobileFlagsFor).
func (c *PushConsumer) SetMobileCallsIOS(on func(ctx context.Context, userID, organizationID string) bool) {
	c.mobileCallsIOS = on
}

// SetBadges lets a chat push carry the person's unread count to their
// iPhones, so the icon is right while the app is closed. Without it, or when
// the count cannot be read in time, the push goes without one.
func (c *PushConsumer) SetBadges(b BadgeCounter) { c.badges = b }

// SetMetrics attaches counters.
func (c *PushConsumer) SetMetrics(m Metrics) { c.metrics = m }

func (*PushConsumer) Name() string { return "notification-push" }

func (*PushConsumer) Topics() []string {
	return []string{TopicPush, TopicCallRingClosed, TopicRoomNotificationsCleared}
}

// Handle sends once per subscription and marks the notification pushed, so
// a retried row after a partial failure does not re-send to the browsers
// that already got it — pushed_at is per notification, which is the
// granularity the outbox retries at. A closed ring is not a notification: it
// tells the person's Android phones to stop ringing (handleRingClosed).
func (c *PushConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.sender == nil {
		return nil
	}
	switch ev.Topic {
	case TopicCallRingClosed:
		return c.handleRingClosed(ctx, ev)
	case TopicRoomNotificationsCleared:
		return c.handleRoomCleared(ctx, ev)
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("push: payload of %s: %w", ev.ID, err)
	}
	n, err := c.q.GetNotification(ctx, p["notification_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// A chat push names its message (Consumer.write): each message of an open
	// row pushes once, newest wins, decided by claimChatPush right before the
	// send. A row without one was written before pushes went per message and
	// keeps the once-per-row rule.
	messageID := ""
	if isChatPushKind(n.Kind) {
		messageID = p["message_id"]
	}
	switch {
	case n.ReadAt.Valid:
		return nil // read on another device before the push went out
	case messageID == "" && n.PushedAt.Valid:
		return nil // already delivered
	}
	// A ring the lane reaches after it stopped ringing is not worth a phone
	// call, and its row is closed so the inbox does not keep "đang gọi".
	if n.Kind == KindChatCallIncoming && !c.stillRinging(n) {
		return c.q.MarkNotificationGroupsRead(ctx, db.MarkNotificationGroupsReadParams{UserID: n.UserID, GroupKeys: []string{n.GroupKey}})
	}
	if n.Kind == KindChatCallIncoming && c.mobileCalls != nil && !c.mobileCalls(ctx, n.UserID, n.OrganizationID) {
		if m := c.metrics; m != nil {
			m.IncPushSuppressed(n.Kind)
		}
		return c.q.MarkNotificationPushed(ctx, n.ID)
	}
	subs, err := c.q.ListDeliverablePushSubscriptions(ctx, n.UserID)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return c.q.MarkNotificationPushed(ctx, n.ID)
	}
	var chatMsg db.ChatMessage
	if isChatPushKind(n.Kind) {
		// The preview is read at delivery, so a message deleted in the
		// meantime sends nothing.
		id := n.ResourceID
		if messageID != "" {
			id = messageID
		}
		chatMsg, err = c.q.GetChatMessageByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.q.MarkNotificationPushed(ctx, n.ID)
		}
		if err != nil {
			return err
		}
		if c.presence != nil && n.WorkspaceID.Valid {
			reading, err := c.readingRoom(ctx, n, chatMsg.RoomID)
			if err != nil {
				return err
			}
			if reading {
				if m := c.metrics; m != nil {
					m.IncPushSuppressed(n.Kind)
				}
				return c.q.MarkNotificationPushed(ctx, n.ID)
			}
		}
	}
	user, err := c.q.GetUserByID(ctx, n.UserID)
	if err != nil {
		return err
	}
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	msg := PushMessage{Title: PushTitle(user.Locale, n.Kind, params), Channel: pushChannel(n.Kind), Tag: n.GroupKey}
	var link string
	if isChatPushKind(n.Kind) {
		msg.Body = pushBody(user.Locale, chatMsg)
		// Reply and Mark as read act on this message's room (and thread) from the notification.
		msg.Chat = ChatPush{WorkspaceID: chatMsg.WorkspaceID, RoomID: chatMsg.RoomID, MessageID: chatMsg.ID, ThreadRootID: chatMsg.ThreadRootID.String}
		if n.Kind == KindChatDM && chatMsg.Kind == "voice_call_log" {
			// Only an unanswered DM call notifies its log (ChatService.finalizeVoiceCall).
			c.missedCall(&msg, user.Locale, params, n, chatMsg)
		} else if messageID != "" {
			if n.Count > 1 {
				msg.Chat.Unread, msg.Chat.Summary = int(n.Count), chatUnreadSummary(user.Locale, int(n.Count))
			}
		}
		// The row is in hand, so the link is built here instead of letting
		// ResourceURL read it a second time.
		base, ok, err := workspaceBase(ctx, c.q, c.origin, n)
		if err != nil {
			return err
		}
		link = c.origin + "/workspaces"
		if ok {
			link = chatMessageURL(base, chatMsg.RoomID, chatMsg.ID)
		}
	} else {
		link, err = ResourceURL(ctx, c.q, c.origin, n)
		if err != nil {
			return err
		}
	}
	msg.URL = link
	// A push's title and words pass through Expo, FCM and APNs and sit on a lock screen: when the person or the
	// organization hid previews, neither names anyone or anything (audit "Security & privacy",
	// push-preview-plaintext). A ring keeps the caller's name: answering needs it, and it lasts the ring only.
	if n.Kind != KindChatCallIncoming {
		hidden, err := c.previewHidden(ctx, user, n.OrganizationID)
		if err != nil {
			return err
		}
		if hidden {
			msg.Title, msg.Body = hiddenPushTitle(user.Locale, n.Kind, msg.Channel), ""
		}
	}
	if isChatPushKind(n.Kind) && c.badges != nil && hasIPhone(subs) {
		msg.Badge = c.unreadBadge(ctx, n.UserID)
	}
	if n.Kind == KindChatCallIncoming {
		// The push rings only as long as the call does (spec M3 §2), and the
		// phone stops ringing at the end of the window whatever reaches it.
		msg.TTL = int(callRingWindow / time.Second)
		msg.Call = CallPush{
			Type: CallPushInvite, CallID: params["call_id"], RoomID: n.ResourceID, WorkspaceID: n.WorkspaceID.String,
			CallerName: params["actor"], RoomName: params["room"], CallKind: params["call_kind"], Video: params["video"] == "1",
			ExpiresAt: n.CreatedAt.Time.Add(callRingWindow).UnixMilli(),
		}
	}
	iPhonesRing := n.Kind == KindChatCallIncoming && (c.mobileCallsIOS == nil || c.mobileCallsIOS(ctx, n.UserID, n.OrganizationID))
	// An iPhone with a PushKit token rings through CallKit (ADR 0038): the VoIP
	// push goes first, and the Expo token of each device session it reached
	// gets no "đang gọi" banner on top. One it did not reach (no APNs key on
	// the server, a dead or failing token) keeps today's visible push, and a
	// failing token does not retry the row: the ring lasts a minute, the
	// banner already reached that iPhone, and a retry would ring every other
	// device again.
	var rang voipResult
	if iPhonesRing {
		if rang, err = c.sendVoIP(ctx, subs, msg); err != nil {
			return err
		}
		if rang.failed != nil {
			slog.WarnContext(ctx, "push: VoIP ring failed, the iPhone gets the visible push", "user_id", n.UserID, "error", rang.failed)
		}
		// The ring's end goes to the tokens recorded here and nowhere else
		// (endCallKitRings). Unrecorded, the iPhone rings out its window, which
		// beats retrying the row and ringing every device again.
		if len(rang.subscriptions) > 0 {
			if err := c.q.AddCallRingVoIPSubscriptions(ctx, db.AddCallRingVoIPSubscriptionsParams{ID: n.ID, SubscriptionIds: rang.subscriptions}); err != nil {
				slog.WarnContext(ctx, "push: VoIP ring not recorded, its end will not reach the iPhone", "user_id", n.UserID, "error", err)
			}
		}
	}
	var claim db.ClaimChatNotificationPushRow
	if messageID != "" {
		var claimed bool
		claim, claimed, err = c.claimChatPush(ctx, n, chatMsg, subs, msg.Call.Type == CallPushMissed)
		if err != nil || !claimed {
			return err
		}
		msg.Quiet = !claim.Alerted
	}
	var failed error
	phoneSent := rang.sent
	for _, sub := range subs {
		// A PushKit token takes a ring and its end only, sent above.
		if isVoIPSubscription(sub) {
			continue
		}
		// Call invites are the phone's background path (spec M3 §2): open
		// desktops ring through realtime; web push subscriptions are skipped.
		if n.Kind == KindChatCallIncoming && !isExpoPushToken(sub.Endpoint) {
			continue
		}
		if n.Kind == KindChatCallIncoming && !iPhonesRing && expoPlatform(sub) == "ios" {
			c.count("skipped")
			continue
		}
		if n.Kind == KindChatCallIncoming && expoPlatform(sub) == "ios" && sub.SessionID.Valid && rang.sessions[sub.SessionID.String] {
			continue // this iPhone rings through CallKit
		}
		err := c.sender.Send(ctx, sub, msg)
		switch {
		case err == nil:
			c.count("sent")
			phoneSent = phoneSent || isExpoPushToken(sub.Endpoint)
		case errors.Is(err, ErrPushSkipped):
			c.count("skipped")
		case errors.Is(err, ErrSubscriptionGone):
			c.count("gone")
			_ = c.q.RevokePushSubscription(ctx, sub.ID)
		default:
			c.count("failed")
			failed = err
		}
	}
	if failed != nil {
		if messageID != "" {
			return errors.Join(failed, c.releaseChatPush(ctx, n, messageID, claim))
		}
		return failed
	}
	if messageID != "" {
		return c.afterChatPush(ctx, n, chatMsg, subs, phoneSent)
	}
	if !phoneSent {
		return c.q.MarkNotificationPushed(ctx, n.ID)
	}
	return c.markPhonePushed(ctx, n, chatMsg, subs)
}

// claimChatPush claims chatMsg's push of the chat row n before it is sent
// (ClaimChatNotificationPush): false when the row was read or a message after
// this one, in the room's order, was claimed meanwhile, so nothing goes out.
// The claim says whether this push alerts: it does unless a phone alerted for
// the row less than chatAlertWindow ago, and a missed call always does. Only
// a push that reaches a phone moves the row's alert window.
func (c *PushConsumer) claimChatPush(
	ctx context.Context, n db.Notification, chatMsg db.ChatMessage, subs []db.PushSubscription, alwaysAlert bool,
) (db.ClaimChatNotificationPushRow, bool, error) {
	window := chatAlertWindow
	if alwaysAlert {
		window = 0
	}
	phone := false
	for _, sub := range subs {
		phone = phone || isExpoPushToken(sub.Endpoint)
	}
	claim, err := c.q.ClaimChatNotificationPush(ctx, db.ClaimChatNotificationPushParams{
		ID: n.ID, MessageID: chatMsg.ID, MessageAt: chatMsg.CreatedAt, Phone: phone, AlertWindowSeconds: window.Seconds(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return claim, false, nil
	}
	if err != nil {
		return claim, false, err
	}
	if !phone {
		// No phone to alert or quiet: a browser replaces the room's notification by its tag.
		claim.Alerted = true
	}
	return claim, true, nil
}

// releaseChatPush gives back the claim of a push that failed, so the lane's
// retry of the row sends it as this try would have.
func (c *PushConsumer) releaseChatPush(ctx context.Context, n db.Notification, messageID string, claim db.ClaimChatNotificationPushRow) error {
	return c.q.ReleaseChatNotificationPush(ctx, db.ReleaseChatNotificationPushParams{
		ID: n.ID, MessageID: messageID,
		PrevPushedAt: claim.PrevPushedAt, PrevMessageID: claim.PrevMessageID,
		PrevMessageAt: claim.PrevMessageAt, PrevPhonePushedAt: claim.PrevPhonePushedAt,
	})
}

// afterChatPush answers a read that closed the row while this push was on
// its way, as markPhonePushed does: the room's notifications come out of the
// Android tray again, since this one may have landed after the read's own
// room_read push.
func (c *PushConsumer) afterChatPush(ctx context.Context, n db.Notification, chatMsg db.ChatMessage, subs []db.PushSubscription, phoneSent bool) error {
	if !phoneSent || !closedByRoomRead(n.Kind) {
		return nil // a thread reply is not closed by reading the room
	}
	read, err := c.q.IsNotificationRead(ctx, n.ID)
	if err != nil || !read {
		return err
	}
	return c.clearRoomTray(ctx, n, chatMsg, subs)
}

// markPhonePushed records that a phone was shown n, the mark a room read looks
// for before it wakes the person's Android phones (handleRoomCleared). A read
// that closed n while this push was on its way found no such mark and sent
// nothing, so the push that just landed in a tray is taken down here instead.
func (c *PushConsumer) markPhonePushed(ctx context.Context, n db.Notification, chatMsg db.ChatMessage, subs []db.PushSubscription) error {
	read, err := c.q.MarkNotificationPhonePushed(ctx, n.ID)
	if err != nil {
		return err
	}
	if !read || !closedByRoomRead(n.Kind) {
		return nil // a thread reply or a call is not closed by reading the room
	}
	return c.clearRoomTray(ctx, n, chatMsg, subs)
}

// closedByRoomRead: the chat kinds a room read closes (ChatService
// closeRoomNotifications); a thread reply and a call are not.
func closedByRoomRead(kind string) bool {
	return kind == KindChatDM || kind == KindChatMentioned || kind == KindChatMessage
}

// clearRoomTray sends the room_read push for chatMsg's room to the person's
// Android phones with the call UI.
func (c *PushConsumer) clearRoomTray(ctx context.Context, n db.Notification, chatMsg db.ChatMessage, subs []db.PushSubscription) error {
	msg := PushMessage{TTL: roomClearedTTL, Cleared: RoomCleared{RoomID: chatMsg.RoomID, WorkspaceID: chatMsg.WorkspaceID}}
	if c.badges != nil {
		msg.Badge = c.unreadBadge(ctx, n.UserID)
	}
	return c.sendToCallUI(ctx, subs, msg)
}

// hasIPhone: one of the subscriptions is an iPhone, the only device a pushed
// badge reaches.
func hasIPhone(subs []db.PushSubscription) bool {
	for _, sub := range subs {
		if isExpoPushToken(sub.Endpoint) && expoPlatform(sub) == "ios" {
			return true
		}
	}
	return false
}

// unreadBadge reads the person's count within a second; nil (no badge, the
// icon left as it is) when it cannot, so a slow count never holds the push.
func (c *PushConsumer) unreadBadge(ctx context.Context, userID string) *int {
	bctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	count, err := c.badges.UnreadBadge(bctx, userID)
	if err != nil {
		slog.WarnContext(ctx, "push: unread badge not read", "user_id", userID, "error", err)
		return nil
	}
	return &count
}

// previewHidden: the recipient hid previews in their pushes, or the
// notification's organization did for everyone (it wins either way).
func (c *PushConsumer) previewHidden(ctx context.Context, user db.User, organizationID string) (bool, error) {
	if user.PushPreviewsHiddenAt.Valid {
		return true, nil
	}
	policy, err := c.q.GetOrganizationPushPreviewPolicy(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return policy.PushPreviewsHiddenAt.Valid, nil
}

// missedCall turns the push of an unanswered DM call's log into "Cuộc gọi
// nhỡ từ X" on the missed-calls channel, naming the call so the phone can
// clear a ring whose end it never heard.
func (c *PushConsumer) missedCall(msg *PushMessage, locale string, params map[string]string, n db.Notification, chatMsg db.ChatMessage) {
	var meta struct {
		CallID string `json:"call_id"`
		Video  bool   `json:"video"`
	}
	_ = json.Unmarshal(chatMsg.Metadata, &meta)
	msg.Title = MissedCallTitle(locale, meta.Video, params["actor"])
	msg.Channel = ChannelMissedCalls
	msg.Call = CallPush{Type: CallPushMissed, CallID: meta.CallID, RoomID: chatMsg.RoomID, WorkspaceID: n.WorkspaceID.String}
}

// callEndTTL: an end that reaches a phone after its ring window has nothing
// left to stop (the ring timed out on its own).
const callEndTTL = int(callRingWindow / time.Second)

// handleRingClosed tells a person's Android phones (the builds with the call
// UI) that a call no longer rings for them: they answered it on one device,
// declined it, or it ended. A data-only push; the app removes its ringing
// screen and notification. The iPhones the ring reached through CallKit get
// it as a VoIP push while unichat_mobile_calls_ios is on (endCallKitRings);
// an iPhone without a PushKit token keeps today's visible push, which this
// cannot recall. Nothing is sent when the calls switch is off for the person:
// their phone was never rung, and a ring that outlives a switch flipped
// mid-call times out alone. Only the Android sends can fail the row.
func (c *PushConsumer) handleRingClosed(ctx context.Context, ev outbox.Row) error {
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("push: payload of %s: %w", ev.ID, err)
	}
	userID, roomID, callID := p["user_id"], p["room_id"], p["call_id"]
	if userID == "" || roomID == "" || callID == "" {
		return nil
	}
	if c.mobileCalls != nil && !c.mobileCalls(ctx, userID, ev.OrganizationID.String) {
		return nil
	}
	subs, err := c.q.ListDeliverablePushSubscriptions(ctx, userID)
	if err != nil {
		return err
	}
	msg := PushMessage{TTL: callEndTTL, Call: CallPush{Type: CallPushEnd, CallID: callID, RoomID: roomID, WorkspaceID: ev.WorkspaceID.String}}
	if c.mobileCallsIOS == nil || c.mobileCallsIOS(ctx, userID, ev.OrganizationID.String) {
		if err := c.endCallKitRings(ctx, userID, p, subs, msg); err != nil {
			return err
		}
	}
	return c.sendToCallUI(ctx, subs, msg)
}

// endCallKitRings sends a ring's end as a VoIP push, saying why it stopped,
// only where it can take a CallKit screen down: iOS makes the app report a
// call for every VoIP push, so an end anywhere else shows a call that is not
// ringing and ends it at once. It goes to the PushKit tokens the ring reached
// (recorded on its ring row), once (the record is taken as it is read), while
// the ring is within its window, and not to the device session that answered
// or declined (the payload's session_id): that iPhone knows, and an end there
// would hang up the call it just answered. Once the record is taken nothing
// fails the row: a retry would end the other phones again, and a ring the end
// misses stops at the end of its window. The error is reading the record.
func (c *PushConsumer) endCallKitRings(ctx context.Context, userID string, p map[string]string, subs []db.PushSubscription, msg PushMessage) error {
	if !slices.ContainsFunc(subs, isVoIPSubscription) {
		return nil
	}
	ring, err := c.q.TakeCallRingVoIPSubscriptions(ctx, db.TakeCallRingVoIPSubscriptionsParams{
		UserID: userID, GroupKey: service.ChatCallNotifyGroup(p["room_id"]), CallID: p["call_id"],
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // no iPhone rang through CallKit
	}
	if err != nil {
		return err
	}
	if c.now().Sub(ring.CreatedAt.Time) > callRingWindow {
		return nil // the ring already stopped on the phone
	}
	closer := p["session_id"]
	targets := slices.DeleteFunc(slices.Clone(subs), func(sub db.PushSubscription) bool {
		return !isVoIPSubscription(sub) || !slices.Contains(ring.SubscriptionIds, sub.ID) ||
			(closer != "" && sub.SessionID.Valid && sub.SessionID.String == closer)
	})
	msg.Call.EndReason = ringClosedReason(p["reason"])
	ended, err := c.sendVoIP(ctx, targets, msg)
	if err == nil {
		err = ended.failed
	}
	if err != nil {
		slog.WarnContext(ctx, "push: VoIP end failed, the iPhone rings out its window", "user_id", userID, "error", err)
	}
	return nil
}

// ringClosedReason keeps the payload's reason within its closed set; a row
// written before it carried one reads as ended.
func ringClosedReason(reason string) string {
	switch reason {
	case service.RingClosedAnswered, service.RingClosedDeclined:
		return reason
	}
	return service.RingClosedEnded
}

// voipResult is what sendVoIP did: whether any PushKit token took the push,
// which ones (push_subscriptions ids), the device sessions they were
// registered from, and the last failure.
type voipResult struct {
	sent          bool
	subscriptions []string
	sessions      map[string]bool
	failed        error
}

// sendVoIP sends a ring or its end to the PushKit tokens among subs, naming
// the call's organization and workspace by slug: the app opens the call by its
// path. A dead token is revoked; a token the sender skips (no APNs key) is
// counted and left for the Expo path. The error is only the slug lookup's.
func (c *PushConsumer) sendVoIP(ctx context.Context, subs []db.PushSubscription, msg PushMessage) (voipResult, error) {
	var out voipResult
	if !slices.ContainsFunc(subs, isVoIPSubscription) {
		return out, nil
	}
	if msg.Call.WorkspaceID != "" {
		ws, err := c.q.GetWorkspaceWithOrg(ctx, msg.Call.WorkspaceID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, err
		}
		msg.Call.OrgSlug, msg.Call.WorkspaceSlug = ws.OrganizationSlug, ws.Slug
	}
	for _, sub := range subs {
		if !isVoIPSubscription(sub) {
			continue
		}
		err := c.sender.Send(ctx, sub, msg)
		switch {
		case err == nil:
			c.count("sent")
			out.sent = true
			out.subscriptions = append(out.subscriptions, sub.ID)
			if sub.SessionID.Valid {
				if out.sessions == nil {
					out.sessions = map[string]bool{}
				}
				out.sessions[sub.SessionID.String] = true
			}
		case errors.Is(err, ErrPushSkipped):
			c.count("skipped")
		case errors.Is(err, ErrSubscriptionGone):
			c.count("gone")
			_ = c.q.RevokePushSubscription(ctx, sub.ID)
		default:
			c.count("failed")
			out.failed = err
		}
	}
	return out, nil
}

// roomClearedTTL: a tray cleanup that reaches a phone a day late finds
// nothing worth taking down.
const roomClearedTTL = int(24 * time.Hour / time.Second)

// handleRoomCleared tells a person's Android phones (the builds with the call
// UI, whose background task can act on it) that they read a room on some
// device: the room's message notifications leave the tray and the icon's
// count follows, even while the app is closed. ChatService writes the row
// only when reading closed a notification of that room that a phone was shown
// (phone_pushed_at, set by markPhonePushed), so a read with nothing in a
// phone's tray sends nothing: not a push dropped because the person was
// reading the room elsewhere, nor one their preferences never sent.
func (c *PushConsumer) handleRoomCleared(ctx context.Context, ev outbox.Row) error {
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("push: payload of %s: %w", ev.ID, err)
	}
	userID, roomID := p["user_id"], p["room_id"]
	if userID == "" || roomID == "" {
		return nil
	}
	subs, err := c.q.ListDeliverablePushSubscriptions(ctx, userID)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(subs, func(sub db.PushSubscription) bool { return isExpoPushToken(sub.Endpoint) && expoCallUI(sub) }) {
		return nil
	}
	msg := PushMessage{TTL: roomClearedTTL, Cleared: RoomCleared{RoomID: roomID, WorkspaceID: ev.WorkspaceID.String}}
	if c.badges != nil {
		msg.Badge = c.unreadBadge(ctx, userID)
	}
	return c.sendToCallUI(ctx, subs, msg)
}

// sendToCallUI sends msg to the person's Android phones with the call UI and
// to nothing else: the data-only pushes only those builds act on.
func (c *PushConsumer) sendToCallUI(ctx context.Context, subs []db.PushSubscription, msg PushMessage) error {
	var failed error
	for _, sub := range subs {
		if !isExpoPushToken(sub.Endpoint) || !expoCallUI(sub) {
			continue
		}
		err := c.sender.Send(ctx, sub, msg)
		switch {
		case err == nil:
			c.count("sent")
		case errors.Is(err, ErrPushSkipped):
			c.count("skipped")
		case errors.Is(err, ErrSubscriptionGone):
			c.count("gone")
			_ = c.q.RevokePushSubscription(ctx, sub.ID)
		default:
			c.count("failed")
			failed = err
		}
	}
	return failed
}

func (c *PushConsumer) stillRinging(n db.Notification) bool {
	if c.now().Sub(n.CreatedAt.Time) > callRingWindow {
		return false
	}
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	return c.calls == nil || c.calls.VoiceCallRinging(n.ResourceID, params["call_id"], n.UserID)
}

func (c *PushConsumer) count(result string) {
	if c.metrics != nil {
		c.metrics.IncPushSent(result)
	}
}

// workspaceBase is origin/{orgSlug}/{wsSlug}; ok is false when the
// notification has no workspace or its workspace is gone.
func workspaceBase(ctx context.Context, q *db.Queries, origin string, n db.Notification) (base string, ok bool, err error) {
	if !n.WorkspaceID.Valid {
		return "", false, nil
	}
	ws, err := q.GetWorkspaceWithOrg(ctx, n.WorkspaceID.String)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return origin + "/" + ws.OrganizationSlug + "/" + ws.Slug, true, nil
}

// chatMessageURL opens a message in its room, scrolled to it.
func chatMessageURL(base, roomID, msgID string) string {
	return base + "/chat?room=" + url.QueryEscape(roomID) + "&message=" + url.QueryEscape(msgID)
}

// ResourceURL is the deep link a notification opens, mirroring
// packages/core/paths. A notification with no workspace lands on the
// workspace list; one whose workspace is gone does the same.
func ResourceURL(ctx context.Context, q *db.Queries, origin string, n db.Notification) (string, error) {
	if n.ResourceType == "document" {
		return documentResourceURL(ctx, q, origin, n)
	}
	base, ok, err := workspaceBase(ctx, q, origin, n)
	if err != nil {
		return "", err
	}
	if !ok {
		return origin + "/workspaces", nil
	}
	switch n.ResourceType {
	case "task":
		return base + "/tasks/" + n.ResourceID, nil
	case "meeting":
		// Mirrors resource-href.ts: a batch of assigned tasks lands on the
		// assignee's own tasks (paths.ts myTasks: the row names no task), the
		// summary kinds on the summary panel and the transcript kinds on the
		// transcript card (use-meeting-section-deep-link.ts).
		switch n.Kind {
		case KindTasksAssigned:
			return base + "/my-tasks", nil
		case KindMeetingSummaryReminder, KindMeetingSummaryReady:
			return base + "/meetings/" + n.ResourceID + "?section=summary", nil
		case KindMeetingActionItemsPending:
			return base + "/meetings/" + n.ResourceID + "?section=action-items", nil
		case KindMeetingRecapReady:
			var params map[string]string
			_ = json.Unmarshal([]byte(n.Params), &params)
			if params["stage"] == recapStageMinutes {
				return base + "/meetings/" + n.ResourceID + "?section=minutes", nil
			}
			return base + "/meetings/" + n.ResourceID + "?section=summary", nil
		case KindMeetingTranscriptReady, KindMeetingTranscriptFailed:
			return base + "/meetings/" + n.ResourceID + "?section=transcript", nil
		}
		return base + "/meetings/" + n.ResourceID, nil
	case "audit_export":
		return base + "/settings?tab=audit", nil
	case "chat_message":
		// A message that is gone still lands in Chat.
		msg, err := q.GetChatMessageByID(ctx, n.ResourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return base + "/chat", nil
		}
		if err != nil {
			return "", err
		}
		return chatMessageURL(base, msg.RoomID, msg.ID), nil
	case "chat_room":
		// A ringing call opens its room; ?call= lets the app answer it if it still rings.
		link := base + "/chat?room=" + url.QueryEscape(n.ResourceID)
		var params map[string]string
		_ = json.Unmarshal([]byte(n.Params), &params)
		if callID := params["call_id"]; callID != "" {
			link += "&call=" + url.QueryEscape(callID)
		}
		return link, nil
	case "email_account":
		return base + "/email", nil
	case "organization_member":
		// The grouped notice of a bulk document transfer: the documents home.
		return base + "/documents", nil
	default:
		return base + "/inbox", nil
	}
}

// documentResourceURL is the deep link a document notification opens
// (G8-07 section 2): the same path the web builds. The workspace is the
// recipient's entry in ListWorkspacesForUser that matches the notification's
// workspace; a recipient who reads the document through a share and is not a
// member of its workspace gets the first workspace of the same organization
// (the one they would have open); with none in that organization they land on
// the workspace list. The comment id rides as ?comment=, and a discussion
// thread adds &kind=discussion so the page opens the Discussion tab.
func documentResourceURL(ctx context.Context, q *db.Queries, origin string, n db.Notification) (string, error) {
	ws, ok, err := documentLinkWorkspace(ctx, q, n)
	if err != nil {
		return "", err
	}
	if !ok {
		return origin + "/workspaces", nil
	}
	link := origin + "/" + ws.OrganizationSlug + "/" + ws.Slug + "/documents/" + n.ResourceID
	var params map[string]string
	_ = json.Unmarshal([]byte(n.Params), &params)
	if cid := params["comment_id"]; cid != "" {
		link += "?comment=" + url.QueryEscape(cid)
		if params["kind"] == "discussion" {
			link += "&kind=discussion"
		}
	}
	// The holder's request opens the editor with the answer prompt.
	if rid := params["request_id"]; rid != "" && n.Kind == KindDocumentEditRequested {
		link += "?edit_request=" + url.QueryEscape(rid)
	}
	// The owner lands on the access panel, where the live grant can be revoked.
	if n.Kind == KindDocumentBreakGlass {
		sep := "?"
		if strings.Contains(link, "?") {
			sep = "&"
		}
		link += sep + "access=break_glass"
	}
	// A body mention opens the page scrolled to the reader's own mention
	// (UNI-1968, W4 drops the param after use).
	if n.Kind == KindDocumentBodyMentioned {
		sep := "?"
		if strings.Contains(link, "?") {
			sep = "&"
		}
		link += sep + "mention=1"
	}
	// A manager's access request opens the share dialog at its requests
	// section (DOC-07 §3.4, N-02).
	if n.Kind == KindDocumentAccessRequested {
		sep := "?"
		if strings.Contains(link, "?") {
			sep = "&"
		}
		link += sep + "access=requests"
	}
	return link, nil
}

// documentLinkWorkspace picks the workspace a document link is built from:
// the notification's own workspace when the recipient is in it, otherwise the
// first of their workspaces in the same organization.
func documentLinkWorkspace(ctx context.Context, q *db.Queries, n db.Notification) (db.ListWorkspacesForUserRow, bool, error) {
	workspaces, err := q.ListWorkspacesForUser(ctx, n.UserID)
	if err != nil {
		return db.ListWorkspacesForUserRow{}, false, err
	}
	if n.WorkspaceID.Valid {
		for _, w := range workspaces {
			if w.ID == n.WorkspaceID.String {
				return w, true, nil
			}
		}
	}
	for _, w := range workspaces {
		if w.OrganizationID == n.OrganizationID {
			return w, true, nil
		}
	}
	return db.ListWorkspacesForUserRow{}, false, nil
}
