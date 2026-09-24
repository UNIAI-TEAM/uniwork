package smtpclient

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"
)

const (
	dialTimeout    = 15 * time.Second
	sessionTimeout = 30 * time.Second
)

func openSession(ctx context.Context, host string, port int) (*smtp.Client, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	tlsCfg := &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	}
	dialer := &net.Dialer{Timeout: dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("smtp dial: %w", err)
	}

	deadline := time.Now().Add(sessionTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp set deadline: %w", err)
	}

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	if hostname, err := os.Hostname(); err == nil {
		hostname = strings.TrimSpace(hostname)
		if hostname != "" {
			if err := client.Hello(hostname); err != nil {
				_ = client.Close()
				return nil, fmt.Errorf("smtp ehlo: %w", err)
			}
		}
	}
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(tlsCfg); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp starttls: %w", err)
		}
	}
	return client, nil
}

func authenticate(ctx context.Context, host string, port int, email, password string) (*smtp.Client, error) {
	client, err := openSession(ctx, host, port)
	if err != nil {
		return nil, err
	}
	fallback, authErr := smtpAuthWithFallback(client, host, email, password)
	if authErr != nil {
		if !fallback {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: %w", authErr)
		}
		_ = client.Close()
		client, err = openSession(ctx, host, port)
		if err != nil {
			return nil, fmt.Errorf("smtp auth: plain failed (%v); reconnect: %w", authErr, err)
		}
		if err = client.Auth(&loginAuth{username: email, password: password, host: host}); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: plain failed (%v); login: %w", authErr, err)
		}
	}
	return client, nil
}
