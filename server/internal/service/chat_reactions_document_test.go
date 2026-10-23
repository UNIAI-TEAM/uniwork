package service

import (
	"context"
	"testing"
)

// TestReactionAndPinAnswersResolveTheDocumentCard is BE-CDS-2: the 200 body of
// a reaction toggle and of a pin toggle on a document message carries the card
// resolved for the viewer, the same as the list and get-one reads, so a client
// patching its cache from the answer does not flip a readable card to "no
// access".
func TestReactionAndPinAnswersResolveTheDocumentCard(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-react-1"))
	if err != nil {
		t.Fatalf("send document: %v", err)
	}

	// The receiver holds a comment share; reacting is allowed at that level.
	reacted, err := f.svc.ToggleChatMessageReaction(ctx, f.ub.ID, f.ws.ID, room.ID, msg.ID, "👍")
	if err != nil {
		t.Fatalf("react: %v", err)
	}
	if reacted.Document == nil || !reacted.Document.HasAccess || reacted.Document.Title != "ke-hoach.md" {
		t.Fatalf("reaction answer document = %+v, want has_access with the file name as title", reacted.Document)
	}
	if reacted.Reactions["👍"] != 1 {
		t.Fatalf("reaction answer reactions = %v, want the new reaction", reacted.Reactions)
	}

	pinned, err := f.svc.ToggleChatMessagePin(ctx, f.ub.ID, f.ws.ID, room.ID, msg.ID)
	if err != nil {
		t.Fatalf("pin: %v", err)
	}
	if !pinned.Pinned {
		t.Fatal("pin answer pinned = false, want true")
	}
	if pinned.Document == nil || !pinned.Document.HasAccess || pinned.Document.Title != "ke-hoach.md" {
		t.Fatalf("pin answer document = %+v, want has_access with the file name as title", pinned.Document)
	}
}
