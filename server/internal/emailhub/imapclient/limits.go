package imapclient

import (
	"context"
	"fmt"
)

const maxGlobalIMAPConns = 96

var globalIMAPSlots = make(chan struct{}, maxGlobalIMAPConns)

func acquireGlobalIMAP(ctx context.Context) error {
	select {
	case globalIMAPSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("imap: capacity wait: %w", ctx.Err())
	}
}

func releaseGlobalIMAP() {
	select {
	case <-globalIMAPSlots:
	default:
	}
}
