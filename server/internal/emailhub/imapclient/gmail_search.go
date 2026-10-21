package imapclient

import (
	"fmt"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/responses"
)

// uidSearchGmailRaw runs UID SEARCH X-GM-RAW on the selected mailbox (Gmail only).
func uidSearchGmailRaw(cl *client.Client, rawQuery string) ([]uint32, error) {
	if cl == nil {
		return nil, fmt.Errorf("imap: nil client")
	}
	if cl.State() != imap.SelectedState {
		return nil, fmt.Errorf("imap: mailbox not selected")
	}
	cmd := &gmailRawUIDSearch{raw: rawQuery}
	res := new(responses.Search)
	status, err := cl.Execute(cmd, res)
	if err != nil {
		return nil, fmt.Errorf("imap gmail raw search: %w", err)
	}
	if err := status.Err(); err != nil {
		return nil, err
	}
	return res.Ids, nil
}

type gmailRawUIDSearch struct {
	raw string
}

func (g *gmailRawUIDSearch) Command() *imap.Command {
	return &imap.Command{
		Name: "UID",
		Arguments: []interface{}{
			imap.RawString("SEARCH"),
			imap.RawString("CHARSET"),
			imap.RawString("UTF-8"),
			imap.RawString("X-GM-RAW"),
			g.raw,
		},
	}
}
