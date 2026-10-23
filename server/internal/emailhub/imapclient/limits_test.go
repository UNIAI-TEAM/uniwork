package imapclient

import (
	"context"
	"testing"
	"time"
)

func TestGlobalIMAPSlots(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := acquireGlobalIMAP(ctx); err != nil {
		t.Fatalf("acquire: %v", err)
	}
	releaseGlobalIMAP()
}
