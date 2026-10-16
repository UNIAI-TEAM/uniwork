package service

import (
	"context"
	"sync"
	"testing"
)

func TestConcurrentResolveDMReturnsOneRoom(t *testing.T) {
	s, _, _, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	const n = 32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	rooms := make(chan string, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sum, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
			if err != nil {
				errs <- err
				return
			}
			rooms <- sum.ID
		}()
	}
	wg.Wait()
	close(errs)
	close(rooms)
	for err := range errs {
		t.Fatal(err)
	}
	var first string
	for id := range rooms {
		if first == "" {
			first = id
			continue
		}
		if id != first {
			t.Fatalf("concurrent ResolveDM returned %q and %q", first, id)
		}
	}
	if first == "" {
		t.Fatal("expected one dm room")
	}
}

func TestConcurrentEnsureWorkspaceRoomReturnsOneRoom(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	const n = 32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	rooms := make(chan string, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
			if err != nil {
				errs <- err
				return
			}
			rooms <- got.RoomID
		}()
	}
	wg.Wait()
	close(errs)
	close(rooms)
	for err := range errs {
		t.Fatal(err)
	}
	var first string
	for id := range rooms {
		if first == "" {
			first = id
			continue
		}
		if id != first {
			t.Fatalf("concurrent EnsureWorkspaceRoom returned %q and %q", first, id)
		}
	}
}

func TestConcurrentCreateGroupReturnsOneRoom(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	uc := chatTestUser(t, q, w, "race-group-c@example.com")
	const n = 16
	in := CreateGroupInput{Name: "Race", MemberUserIDs: []string{ub.ID, uc.ID}}
	var wg sync.WaitGroup
	errs := make(chan error, n)
	rooms := make(chan string, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sum, err := s.CreateGroup(ctx, ua.ID, w.ID, in)
			if err != nil {
				errs <- err
				return
			}
			rooms <- sum.ID
		}()
	}
	wg.Wait()
	close(errs)
	close(rooms)
	for err := range errs {
		t.Fatal(err)
	}
	var first string
	for id := range rooms {
		if first == "" {
			first = id
			continue
		}
		if id != first {
			t.Fatalf("concurrent CreateGroup returned %q and %q", first, id)
		}
	}
}
