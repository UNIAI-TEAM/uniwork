package notification

// FE-2 (G8-05, UNI-1400): every document kind whose template interpolates the
// document name must render that name verbatim, in vi and en; the short
// push titles OQ-C8 splits out must stay name-free in both locales; and the
// real PushConsumer.message boundary must carry the same special-character
// name the Title() path does. The round-2 review
// (review-be-g8-05-r2.md, "Remaining FE-2") found the earlier coverage
// exercised a single kind in a single locale through Title() plus a direct
// PushTitle() fallback, so a regression in another document template or an
// escape change in the push path could evade it. These tables close that gap.

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// documentName is the special-character name every case interpolates: quotes,
// an ampersand and angle brackets must survive verbatim - the server path
// never HTML-escapes a title.
const documentName = `A "b" & <c>`

// documentNameCases lists every kind whose template interpolates the document
// name, with the exact sentence each must render per locale. Legacy
// document_commented is included because its template still names the
// document for rows written before the UNI-1337 table landed (kinds.go).
var documentNameCases = []struct {
	kind string
	vi   string
	en   string
}{
	{KindDocumentCommented, `An đã bình luận trong “A "b" & <c>”`, `An commented on “A "b" & <c>”`},
	{KindDocumentMentioned, `An đã nhắc đến bạn trong bình luận tại tài liệu “A "b" & <c>”.`, `An mentioned you in a comment on “A "b" & <c>”.`},
	{KindDocumentBodyMentioned, `An đã nhắc đến bạn trong tài liệu “A "b" & <c>”.`, `An mentioned you in “A "b" & <c>”.`},
	{KindDocumentCommentReplied, `An đã phản hồi bình luận của bạn trong tài liệu “A "b" & <c>”.`, `An replied to your comment in “A "b" & <c>”.`},
	{KindDocumentDiscussionMentioned, `An đã nhắc đến bạn trong thảo luận của tài liệu “A "b" & <c>”.`, `An mentioned you in a discussion on “A "b" & <c>”.`},
	{KindDocumentDiscussionReplied, `An đã phản hồi nội dung thảo luận của bạn trong tài liệu “A "b" & <c>”.`, `An replied to your discussion post in “A "b" & <c>”.`},
	{KindDocumentCommentResolved, `An đã đánh dấu bình luận của bạn trong tài liệu “A "b" & <c>” là đã giải quyết.`, `An marked your comment in “A "b" & <c>” as resolved.`},
	{KindDocumentBreakGlass, `An đã mở truy cập khẩn cấp (chỉ xem, 24 giờ) vào tài liệu “A "b" & <c>”.`, `An opened emergency view access (24h) to “A "b" & <c>”.`},
	{KindDocumentShared, `An đã chia sẻ tài liệu “A "b" & <c>” với bạn. Quyền: Chỉ xem.`, `An shared “A "b" & <c>” with you (View).`},
}

// shortPushTitleCases is the short titles OQ-C8 splits out, vi and en.
// They intentionally carry no document name: the assertions below check the
// exact literal and that the rendered title contains no name.
var shortPushTitleCases = []struct {
	kind string
	vi   string
	en   string
}{
	{KindDocumentMentioned, "Bạn được nhắc tên trong bình luận", "You were mentioned in a comment"},
	{KindDocumentBodyMentioned, "Bạn được nhắc đến trong tài liệu", "You were mentioned in a document"},
	{KindDocumentCommentReplied, "Có phản hồi bình luận mới", "New reply to your comment"},
	{KindDocumentDiscussionMentioned, "Bạn được nhắc tên trong thảo luận", "You were mentioned in a discussion"},
	{KindDocumentDiscussionReplied, "Có phản hồi thảo luận mới", "New reply in a discussion"},
	{KindDocumentCommentResolved, "Bình luận đã được giải quyết", "Comment resolved"},
	{KindDocumentBreakGlass, "Truy cập khẩn cấp vào tài liệu", "Emergency access to document"},
	{KindDocumentShared, "Tài liệu được chia sẻ", "Document shared"},
}

// htmlEscapeMarks are the byte sequences a stray HTML-escape would leave in a
// rendered title; none may appear when the name is interpolated.
var htmlEscapeMarks = []string{"&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&#x27;"}

// TestTitleDocumentNameVerbatimAllKinds drives every document kind through
// Title for vi and en with a name carrying quotes, an ampersand and angle
// brackets, and asserts the exact sentence - the name verbatim, no escaping.
func TestTitleDocumentNameVerbatimAllKinds(t *testing.T) {
	params := map[string]string{"actor": "An", "document": documentName, "level": "view"}
	for _, tc := range documentNameCases {
		for _, locale := range []string{"vi", "en"} {
			want := tc.vi
			if locale == "en" {
				want = tc.en
			}
			got := Title(locale, tc.kind, params)
			if got != want {
				t.Errorf("Title(%s, %s) = %q, want %q", locale, tc.kind, got, want)
			}
			if !contains(got, documentName) {
				t.Errorf("Title(%s, %s) dropped or altered the document name: %q", locale, tc.kind, got)
			}
			for _, mark := range htmlEscapeMarks {
				if contains(got, mark) {
					t.Errorf("Title(%s, %s) HTML-escaped the name: %q", locale, tc.kind, got)
				}
			}
		}
	}
}

func TestTitleDocumentSharedLevels(t *testing.T) {
	cases := []struct {
		level string
		vi    string
		en    string
	}{
		{"view", "Chỉ xem", "View"},
		{"comment", "Nhận xét", "Comment"},
		{"edit", "Chỉnh sửa", "Edit"},
		{"manage", "Quản lý", "Manage"},
		{"custom_future", "custom_future", "custom_future"},
	}
	for _, tc := range cases {
		p := map[string]string{"actor": "An", "document": "Kế hoạch", "level": tc.level}
		if got, want := Title("vi", KindDocumentShared, p), "An đã chia sẻ tài liệu “Kế hoạch” với bạn. Quyền: "+tc.vi+"."; got != want {
			t.Errorf("Title(vi, %s) = %q, want %q", tc.level, got, want)
		}
		if got, want := Title("en", KindDocumentShared, p), "An shared “Kế hoạch” with you ("+tc.en+")."; got != want {
			t.Errorf("Title(en, %s) = %q, want %q", tc.level, got, want)
		}
	}
}

// TestShortPushTitlesCarryNoDocumentName asserts the short push titles
// for vi and en are the exact literals and, by design, never carry the
// document name - a short title cannot prove a name is preserved.
func TestShortPushTitlesCarryNoDocumentName(t *testing.T) {
	params := map[string]string{"actor": "An", "document": documentName}
	for _, tc := range shortPushTitleCases {
		for _, locale := range []string{"vi", "en"} {
			want := tc.vi
			if locale == "en" {
				want = tc.en
			}
			got := PushTitle(locale, tc.kind, params)
			if got != want {
				t.Errorf("PushTitle(%s, %s) = %q, want %q", locale, tc.kind, got, want)
			}
			if contains(got, documentName) || contains(got, `A "b"`) {
				t.Errorf("short push title %s (%s) carries a document name: %q", tc.kind, locale, got)
			}
		}
	}
}

// TestPushConsumerSendsNameFreeShortTitle drives a real document mention -
// with the special-character document name - through the consumer, the push
// outbox row and PushConsumer.Handle to a sender, and asserts the payload
// title is the name-free short kindTitle.
func TestPushConsumerSendsNameFreeShortTitle(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", documentName)
	f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")
	f.handleComment(t)
	f.subscribe(t, f.member.ID, "https://push.example/fe2-short")

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("sent = %+v, want one message", spy.sent)
	}
	if want := kindTitles["vi"][KindDocumentMentioned]; spy.sent[0].Title != want {
		t.Fatalf("title = %q, want the short kindTitle %q", spy.sent[0].Title, want)
	}
	if contains(spy.sent[0].Title, documentName) {
		t.Fatalf("short push title leaked the document name: %q", spy.sent[0].Title)
	}
}

// TestPushConsumerMessageKeepsDocumentNameVerbatim exercises the real
// PushConsumer.message/Handle path with a name-bearing title. The rules
// never emit legacy document_commented again, but its row and template
// survive (kinds.go), so a row written before the UNI-1337 table falls back
// to the content sentence - and that sentence must keep the document name
// verbatim in both locales.
func TestPushConsumerMessageKeepsDocumentNameVerbatim(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", documentName)
	params, err := json.Marshal(map[string]string{"actor": "An", "document": documentName})
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "https://push.example/fe2-legacy")

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	for _, tc := range []struct {
		locale string
		want   string
	}{
		{"vi", `An đã bình luận trong “A "b" & <c>”`},
		{"en", `An commented on “A "b" & <c>”`},
	} {
		if _, err := f.pool.Exec(f.ctx, `UPDATE users SET locale = $1 WHERE id = $2`, tc.locale, f.member.ID); err != nil {
			t.Fatal(err)
		}
		n, err := f.q.UpsertNotification(f.ctx, db.UpsertNotificationParams{
			ID: util.NewID(), UserID: f.member.ID, OrganizationID: f.orgID,
			WorkspaceID: optText(f.wsID), Kind: KindDocumentCommented,
			GroupKey:     "document:" + docID + ":legacy:" + tc.locale,
			ResourceType: "document", ResourceID: docID,
			ActorKind: "human", ActorID: f.owner.ID,
			TitleKey: TitleKey(KindDocumentCommented), Params: string(params),
			CorrelationID: pgtype.Text{},
		})
		if err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(map[string]string{"notification_id": n.ID})
		if err != nil {
			t.Fatal(err)
		}
		row := db.OutboxEvent{ID: util.NewID(), Topic: TopicPush, Payload: string(payload)}
		if err := pc.Handle(f.ctx, row); err != nil {
			t.Fatal(err)
		}
		last := spy.sent[len(spy.sent)-1]
		if last.Title != tc.want {
			t.Fatalf("%s push title = %q, want %q", tc.locale, last.Title, tc.want)
		}
		if !contains(last.Title, documentName) {
			t.Fatalf("%s push title dropped the document name: %q", tc.locale, last.Title)
		}
		for _, mark := range htmlEscapeMarks {
			if contains(last.Title, mark) {
				t.Fatalf("%s push title HTML-escaped the name: %q", tc.locale, last.Title)
			}
		}
	}
}
