package service

import (
	"context"
	"errors"
	"testing"
)

func TestCommentReplyResolveReactionAndSubscriber(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Collab root"})
	if err != nil {
		t.Fatal(err)
	}

	parent, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "parent note"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if parent.ParentCommentID.Valid {
		t.Fatalf("parent should have no parent: %+v", parent)
	}

	reply, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{
		Body: "reply note", ParentID: &parent.ID,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !reply.ParentCommentID.Valid || reply.ParentCommentID.String != parent.ID {
		t.Fatalf("reply parent = %+v", reply)
	}
	listed, err := s.Comments(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	foundReply := false
	for _, c := range listed {
		if c.ID != reply.ID {
			continue
		}
		foundReply = true
		if !c.ParentCommentID.Valid || c.ParentCommentID.String != parent.ID {
			t.Fatalf("GET list reply parent_id = %+v", c)
		}
		if c.CommentType == "" || c.Revision < 1 {
			t.Fatalf("GET list missing type/revision: %+v", c)
		}
	}
	if !foundReply {
		t.Fatalf("GET list missing reply: %+v", listed)
	}

	resolved, err := s.ResolveComment(ctx, Human(ua.ID), parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.ResolvedAt.Valid || resolved.ResolvedByID.String != ua.ID {
		t.Fatalf("resolve = %+v", resolved)
	}
	unresolved, err := s.UnresolveComment(ctx, Human(ua.ID), parent.ID)
	if err != nil || unresolved.ResolvedAt.Valid {
		t.Fatalf("unresolve = %+v err=%v", unresolved, err)
	}

	reaction, err := s.AddCommentReaction(ctx, Human(ua.ID), parent.ID, "👍")
	if err != nil {
		t.Fatal(err)
	}
	if reaction.Emoji != "👍" || reaction.CommentID != parent.ID {
		t.Fatalf("reaction = %+v", reaction)
	}
	if err := s.RemoveCommentReaction(ctx, Human(ua.ID), parent.ID, "👍"); err != nil {
		t.Fatal(err)
	}

	taskReaction, err := s.AddTaskReaction(ctx, Human(ua.ID), task.ID, "🔥")
	if err != nil {
		t.Fatal(err)
	}
	if taskReaction.TaskID != task.ID {
		t.Fatalf("task reaction = %+v", taskReaction)
	}
	if err := s.RemoveTaskReaction(ctx, Human(ua.ID), task.ID, "🔥"); err != nil {
		t.Fatal(err)
	}

	if err := s.SubscribeTask(ctx, Human(ua.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	subs, err := s.ListTaskSubscribers(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, sub := range subs {
		if sub.ActorID == ua.ID && sub.ActorType == "member" {
			found = true
			if sub.Reason != "manual" {
				t.Fatalf("reason = %q", sub.Reason)
			}
		}
	}
	if !found {
		t.Fatalf("subscribers = %+v", subs)
	}
	if err := s.UnsubscribeTask(ctx, Human(ua.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	subs, err = s.ListTaskSubscribers(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, sub := range subs {
		if sub.ActorID == ua.ID {
			t.Fatalf("still subscribed: %+v", subs)
		}
	}

	child, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "child"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetParent(ctx, Human(ua.ID), child.ID, &task.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SubscribeTask(ctx, Human(ua.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.SubscribeTask(ctx, Human(ua.ID), child.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.UnsubscribeTaskSubtree(ctx, Human(ua.ID), task.ID, SubscribeTaskInput{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{task.ID, child.ID} {
		list, err := s.ListTaskSubscribers(ctx, Human(ua.ID), id)
		if err != nil {
			t.Fatal(err)
		}
		for _, sub := range list {
			if sub.ActorID == ua.ID {
				t.Fatalf("subtree leave failed on %s: %+v", id, list)
			}
		}
	}

	edited, err := s.UpdateComment(ctx, Human(ua.ID), parent.ID, UpdateCommentInput{Body: "edited parent"})
	if err != nil {
		t.Fatal(err)
	}
	if edited.Body != "edited parent" || edited.Revision < 2 {
		t.Fatalf("edit = %+v", edited)
	}
	if err := s.DeleteComment(ctx, Human(ua.ID), reply.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.GetComment(ctx, Human(ua.ID), reply.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}

	capErr := s.GetTaskTimeline(ctx, Human(ua.ID), task.ID)
	var coded CodedError
	if !errors.As(capErr, &coded) || coded.Code != "capability_unavailable" {
		t.Fatalf("timeline stub: %v", capErr)
	}

	listedAtts, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listedAtts) != 0 {
		t.Fatalf("empty attachments: %+v", listedAtts)
	}

	drained := events.drain(t)
	want := map[string]bool{
		"task.comment_added": true, "task.comment_updated": true, "task.comment_deleted": true,
		"task.comment_resolved": true, "task.comment_unresolved": true,
		"comment.reaction_added": true, "comment.reaction_removed": true,
		"task.reaction_added": true, "task.reaction_removed": true,
		"task.subscribed": true, "task.unsubscribed": true,
	}
	for _, e := range drained {
		delete(want, e.Type)
	}
	for topic := range want {
		t.Fatalf("missing outbox topic %s in %#v", topic, drained)
	}
}

func TestAddCommentSuiteIdempotentReplay(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Idem comment"})
	if err != nil {
		t.Fatal(err)
	}
	key := "comment-key-1"
	first, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "once"}, key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "once"}, key)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("replay ids %s vs %s", first.ID, second.ID)
	}
	list, err := s.Comments(ctx, ua.ID, task.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %+v err=%v", list, err)
	}
}
