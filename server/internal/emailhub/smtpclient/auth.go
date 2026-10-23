package smtpclient

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/smtp"
	"strings"
)

type smtpAuthClient interface {
	Auth(smtp.Auth) error
	Extension(string) (bool, string)
}

func smtpAuthWithFallback(c smtpAuthClient, host, username, password string) (bool, error) {
	plainErr := c.Auth(smtp.PlainAuth("", username, password, host))
	if plainErr == nil {
		return false, nil
	}
	msg := strings.ToLower(plainErr.Error())
	if !strings.Contains(msg, "unrecognized authentication type") && !strings.Contains(msg, "504 5.7.4") {
		return false, plainErr
	}
	ok, authLine := c.Extension("AUTH")
	if !ok || !strings.Contains(strings.ToUpper(authLine), "LOGIN") {
		return false, plainErr
	}
	return true, plainErr
}

type loginAuth struct {
	username string
	password string
	host     string
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, fmt.Errorf("wrong host name: %q does not match expected %q", server.Name, a.host)
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	raw := strings.TrimSpace(string(fromServer))
	challenge := strings.ToLower(raw)
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		challenge = strings.ToLower(strings.TrimSpace(string(decoded)))
	}
	switch {
	case strings.Contains(challenge, "username") || strings.Contains(challenge, "user name"):
		return []byte(a.username), nil
	case strings.Contains(challenge, "password"):
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("unexpected LOGIN challenge %q", raw)
	}
}

// xoauth2Auth is SASL XOAUTH2, the bearer-token login Gmail and Outlook accept
// for SMTP submission.
type xoauth2Auth struct {
	username string
	token    string
	host     string
}

func (a *xoauth2Auth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, fmt.Errorf("wrong host name: %q does not match expected %q", server.Name, a.host)
	}
	return "XOAUTH2", []byte("user=" + a.username + "\x01auth=Bearer " + a.token + "\x01\x01"), nil
}

// Next answers the error challenge (334 + base64 JSON) with an empty line so the
// server ends with its 535; a nil reply would stop net/smtp before reading it.
func (a *xoauth2Auth) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return []byte{}, nil
	}
	return nil, nil
}
