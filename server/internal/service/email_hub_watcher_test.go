package service

import (
	"context"
	"testing"
	"time"
)

// waitWatchStopped waits until no watch loop runs for accountID and its entry is gone.
func waitWatchStopped(t *testing.T, svc *EmailHubService, accountID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		svc.hubWatch.mu.Lock()
		_, running := svc.hubWatch.stop[accountID]
		svc.hubWatch.mu.Unlock()
		if !running && !svc.gov.isWatching(accountID) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the watch loop did not stop")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestEmailHubWatchStopsOnUnsubscribeAfterHeartbeats(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)

	for i := 0; i < 3; i++ { // mount + two heartbeats
		if err := svc.SubscribeInboxWatch(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.UnsubscribeInboxWatch(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	waitWatchStopped(t, svc, acc.ID)
}

func TestEmailHubWatchLoopExitsWhenTheLeaseLapses(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	svc.hubWatch.mu.Lock()
	svc.hubWatch.lastSeen[acc.ID] = time.Now().Add(-emailHubWatchLease - time.Second)
	svc.hubWatch.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	svc.runHubWatchLoop(ctx, acc.ID)
	if ctx.Err() != nil {
		t.Fatal("a watch nobody renewed must end on its own, not run until cancelled")
	}
	svc.hubWatch.mu.Lock()
	_, kept := svc.hubWatch.lastSeen[acc.ID]
	svc.hubWatch.mu.Unlock()
	if kept {
		t.Fatal("the lapsed lease must be dropped")
	}
}

func TestEmailHubWatchRestartsAfterTheLoopEndsOnItsOwn(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts SET disconnected_at = now() WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)

	svc.hubWatch.subscribe(acc)
	waitWatchStopped(t, svc, acc.ID) // the loop sees disconnected_at and returns

	// Reconnected, so the new loop stays up (retrying IMAP) while we look at it.
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts SET disconnected_at = NULL WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	svc.hubWatch.subscribe(acc)
	svc.hubWatch.mu.Lock()
	_, started := svc.hubWatch.stop[acc.ID]
	svc.hubWatch.mu.Unlock()
	if !started {
		t.Fatal("a subscribe after the loop ended must start a new one")
	}
}

func TestEmailHubHubWatcherForceStop(t *testing.T) {
	w := newEmailHubHubWatcher(nil)
	w.lastSeen["acc-1"] = time.Now()
	ctx, cancel := context.WithCancel(context.Background())
	w.stop["acc-1"] = cancel

	w.forceStop("acc-1")

	if _, ok := w.lastSeen["acc-1"]; ok {
		t.Fatal("lease should be cleared on forceStop")
	}
	if _, ok := w.stop["acc-1"]; ok {
		t.Fatal("stop should be cleared on forceStop")
	}
	if ctx.Err() == nil {
		t.Fatal("forceStop should cancel the watch context")
	}
}
