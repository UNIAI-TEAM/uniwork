package migrations

import (
	"context"
	"testing"
)

func TestChatThreadFollowersHaveAUserIndex(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var hasIdx bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE schemaname = 'public' AND tablename = 'chat_thread_followers'
		  AND indexname = 'idx_chat_thread_followers_user_ws'
	)`).Scan(&hasIdx); err != nil {
		t.Fatal(err)
	}
	if !hasIdx {
		t.Fatal("missing idx_chat_thread_followers_user_ws on chat_thread_followers (user_id, workspace_id)")
	}
}
