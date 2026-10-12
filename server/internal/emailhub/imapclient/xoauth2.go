package imapclient

import (
	"fmt"

	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
	"github.com/emersion/go-imap/responses"
)

// xoauth2Client is the SASL XOAUTH2 mechanism (sasl.Client) Gmail and Outlook
// accept for IMAP: the user and a bearer access token in one initial response.
type xoauth2Client struct{ user, token string }

func (a *xoauth2Client) Start() (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + a.user + "\x01auth=Bearer " + a.token + "\x01\x01"), nil
}

// Next answers the only challenge XOAUTH2 has, the server's base64 JSON error,
// with an empty reply; the server then ends the exchange with a tagged NO.
func (a *xoauth2Client) Next([]byte) ([]byte, error) { return []byte{}, nil }

// authenticateXOAUTH2 runs AUTHENTICATE by hand for the reason login runs LOGIN
// by hand: client.Authenticate drops the response code finishLogin classifies.
func authenticateXOAUTH2(cl *client.Client, user, token string) error {
	mech := &xoauth2Client{user: user, token: token}
	_, ir, _ := mech.Start()
	saslIR, err := cl.Support("SASL-IR")
	if err != nil {
		return fmt.Errorf("imap capability: %w", err)
	}
	cmd := &commands.Authenticate{Mechanism: "XOAUTH2"}
	res := &responses.Authenticate{Mechanism: mech, InitialResponse: ir, RepliesCh: make(chan []byte, 10)}
	if saslIR {
		// Sent inline with the command; otherwise after the server's empty "+".
		cmd.InitialResponse, res.InitialResponse = ir, nil
	}
	status, err := cl.Execute(cmd, res)
	return finishLogin(cl, status, err)
}
