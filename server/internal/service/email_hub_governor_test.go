package service

import (
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
)

func TestEmailHubGovernorSearchIndexTTL(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	if _, run := gov.shouldIndexSearch("acc-1", "INBOX", "invoice"); !run {
		t.Fatal("expected first search index to run")
	}
	gov.rememberSearchHits("acc-1", "INBOX", "invoice", []string{"thr-1"})
	if hits, run := gov.shouldIndexSearch("acc-1", "INBOX", "invoice"); run || len(hits) != 1 || hits[0] != "thr-1" {
		t.Fatalf("expected duplicate search to be skipped within TTL with its hits, got run=%v hits=%v", run, hits)
	}
	if hits, run := gov.shouldIndexSearch("acc-1", "INBOX", "payroll"); !run || hits != nil {
		t.Fatal("expected different query to run")
	}
	gov.rememberSearchHits("acc-1", "INBOX", "invoice", []string{"stale"})
	if hits, _ := gov.shouldIndexSearch("acc-1", "INBOX", "payroll"); hits != nil {
		t.Fatalf("hits of a superseded search leaked: %v", hits)
	}
}

// One text search covers three folders; each keeps its own run so the next
// page does not repeat three IMAP searches (UNI-1129).
func TestEmailHubGovernorSearchIndexPerFolder(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	for _, f := range []string{"INBOX", "SENT", "ARCHIVE"} {
		if _, run := gov.shouldIndexSearch("acc-1", f, "invoice"); !run {
			t.Fatalf("%s: expected first search to run", f)
		}
		gov.rememberSearchHits("acc-1", f, "invoice", []string{"thr-" + f})
	}
	for _, f := range []string{"INBOX", "SENT", "ARCHIVE"} {
		if hits, run := gov.shouldIndexSearch("acc-1", f, "invoice"); run || len(hits) != 1 || hits[0] != "thr-"+f {
			t.Fatalf("%s: repeat within TTL got run=%v hits=%v", f, run, hits)
		}
	}
	gov.forgetSearch("acc-1", "SENT", "invoice")
	if _, run := gov.shouldIndexSearch("acc-1", "SENT", "invoice"); !run {
		t.Fatal("a search that never reached IMAP must run again")
	}
}

func TestEmailHubGovernorDebounce(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()

	release, ok := gov.trySync("acc-1", false, false, emailHubSyncModeFull)
	if !ok || release == nil {
		t.Fatal("expected first sync to proceed")
	}
	release()

	release, ok = gov.trySync("acc-1", false, false, emailHubSyncModeFull)
	if ok {
		release()
		t.Fatal("expected debounced sync to be skipped")
	}

	release, ok = gov.trySync("acc-1", true, false, emailHubSyncModeFull)
	if !ok || release == nil {
		t.Fatal("expected forced sync to proceed")
	}
	release()
}

func TestEmailHubGovernorWatchSkipsWorker(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	gov.beginWatch("acc-1")
	if !gov.isWatching("acc-1") {
		t.Fatal("expected watching")
	}
	gov.endWatch("acc-1")
	if gov.isWatching("acc-1") {
		t.Fatal("expected watch ended")
	}
}

func TestEmailHubGovernorSerializesSync(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	release, ok := gov.trySync("acc-1", true, false, emailHubSyncModeFull)
	if !ok {
		t.Fatal("expected sync")
	}

	done := make(chan bool, 1)
	go func() {
		_, ok := gov.trySync("acc-1", true, false, emailHubSyncModeFull)
		done <- ok
	}()

	select {
	case ok := <-done:
		t.Fatalf("second sync should block until release, got ok=%v early", ok)
	case <-time.After(20 * time.Millisecond):
	}

	release()
	select {
	case ok := <-done:
		if !ok {
			t.Fatal("expected second sync after release")
		}
	case <-time.After(time.Second):
		t.Fatal("second sync did not proceed")
	}
}

func TestEmailHubGovernorInboxDebounceIndependentFromFull(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()

	release, ok := gov.trySync("acc-1", false, false, emailHubSyncModeFull)
	if !ok || release == nil {
		t.Fatal("expected full sync")
	}
	release()

	release, ok = gov.trySync("acc-1", false, false, emailHubSyncModeInbox)
	if !ok || release == nil {
		t.Fatal("expected inbox sync right after full sync")
	}
	release()

	release, ok = gov.trySync("acc-1", false, false, emailHubSyncModeInbox)
	if ok {
		release()
		t.Fatal("expected inbox sync debounced")
	}
}

func TestEmailHubGovernorDefersSyncDuringInteractive(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	gov.beginInteractive("acc-1")
	release, ok := gov.trySync("acc-1", false, false, emailHubSyncModeFull)
	if ok {
		release()
		t.Fatal("expected full sync deferred while interactive")
	}
	release, ok = gov.trySync("acc-1", false, true, emailHubSyncModeInbox)
	if !ok || release == nil {
		t.Fatal("expected live inbox sync during interactive")
	}
	release()
	gov.endInteractive("acc-1")
}

func TestEmailHubGovernorLiveSyncDebounce(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()

	release, ok := gov.trySync("acc-1", false, true, emailHubSyncModeInbox)
	if !ok || release == nil {
		t.Fatal("expected first live inbox sync")
	}
	release()

	release, ok = gov.trySync("acc-1", false, true, emailHubSyncModeInbox)
	if ok {
		release()
		t.Fatal("expected live inbox sync debounced within 2s")
	}
}

func TestEmailHubGovernorMailboxCache(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	m := imapclient.MailboxMap{"INBOX": "Inbox"}
	gov.setMailboxes("acc-1", m)
	got, ok := gov.mailboxes("acc-1")
	if !ok || got.Resolve("INBOX") != "Inbox" {
		t.Fatalf("mailbox cache: %+v ok=%v", got, ok)
	}
}

func TestEmailHubGovernorBodyPrefetch(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	if !gov.tryBeginBodyPrefetch("acc-1", "INBOX") {
		t.Fatal("expected first prefetch")
	}
	if gov.tryBeginBodyPrefetch("acc-1", "INBOX") {
		t.Fatal("expected concurrent prefetch blocked")
	}
	gov.endBodyPrefetch("acc-1", "INBOX")
	// A millisecond can elapse before the next statement on a loaded runner.
	gov.deferBodyPrefetch("thread-1", time.Minute)
	if !gov.bodyPrefetchDeferred("thread-1") {
		t.Fatal("expected deferred prefetch")
	}
	gov.clearBodyPrefetchDefer("thread-1")
	if gov.bodyPrefetchDeferred("thread-1") {
		t.Fatal("expected defer cleared")
	}
}

func TestEmailHubGovernorWithIMAP(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	called := false
	if err := gov.withIMAP("acc-1", func() error { called = true; return nil }); err != nil || !called {
		t.Fatalf("withIMAP: called=%v err=%v", called, err)
	}
	if !gov.tryWithIMAP("acc-1", func() error { return nil }) {
		t.Fatal("expected tryWithIMAP after release")
	}
}

func TestEmailHubGovernorAccountsIndependent(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	var wg sync.WaitGroup
	ids := []string{"acc-a", "acc-b", "acc-c", "acc-d"}
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			release, ok := gov.trySync(id, true, false, emailHubSyncModeFull)
			if !ok {
				t.Errorf("sync blocked for %s", id)
				return
			}
			time.Sleep(5 * time.Millisecond)
			release()
		}(id)
	}
	wg.Wait()
}

func TestEmailHubGovernorForgetsMailboxes(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	gov.setMailboxes("acc-1", imapclient.MailboxMap{"INBOX": "Inbox"})
	gov.setMailboxes("acc-2", imapclient.MailboxMap{"INBOX": "Inbox"})
	gov.forgetMailboxes("acc-1")
	if _, ok := gov.mailboxes("acc-1"); ok {
		t.Fatal("a forgotten account must have no cached mailbox map")
	}
	if _, ok := gov.mailboxes("acc-2"); !ok {
		t.Fatal("forgetting one account dropped another's mailbox map")
	}
}

func TestEmailHubGovernorFencesStaleSnapshots(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	if gov.staleSnapshot("acc-1", 0) {
		t.Fatal("without a fence no snapshot is stale")
	}
	gov.fenceSnapshots("acc-1", 3)
	gov.fenceSnapshots("acc-1", 2) // a late, older fence never lowers it
	if !gov.staleSnapshot("acc-1", 2) {
		t.Fatal("a snapshot older than the fence must be stale")
	}
	if gov.staleSnapshot("acc-1", 3) || gov.staleSnapshot("acc-1", 4) {
		t.Fatal("the fenced version and newer ones are current")
	}
	if gov.staleSnapshot("acc-2", 0) {
		t.Fatal("a fence is per account")
	}
}
