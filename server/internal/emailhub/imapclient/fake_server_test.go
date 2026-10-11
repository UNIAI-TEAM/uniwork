package imapclient

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"

	"github.com/emersion/go-imap/client"
)

// Tests talk plain TCP to fakeIMAP; production dial stays TLS-only.
func init() { dialIMAP = client.Dial }

// fakeIMAP is a scripted IMAP server. It records every command line it
// receives (tag stripped) and answers with reply when that returns true,
// otherwise with a minimal default.
type fakeIMAP struct {
	caps  string
	reply func(w *bufio.Writer, tag, cmd string) bool

	mu   sync.Mutex
	cmds []string
}

func (f *fakeIMAP) start(t *testing.T) Credentials {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return Credentials{
		Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port,
		Email: "user@example.com", Password: "secret",
	}
}

func (f *fakeIMAP) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.cmds...)
}

func (f *fakeIMAP) serve(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	w := bufio.NewWriter(conn)
	fmt.Fprint(w, "* OK fake ready\r\n")
	_ = w.Flush()
	idleTag := ""
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "DONE" {
			f.record("DONE")
			fmt.Fprintf(w, "%s OK IDLE terminated\r\n", idleTag)
			_ = w.Flush()
			continue
		}
		tag, cmd, _ := strings.Cut(line, " ")
		f.record(cmd)
		verb, _, _ := strings.Cut(strings.ToUpper(cmd), " ")
		if verb == "IDLE" {
			idleTag = tag
		}
		if f.reply != nil && f.reply(w, tag, cmd) {
			_ = w.Flush()
			continue
		}
		switch verb {
		case "CAPABILITY":
			fmt.Fprintf(w, "* CAPABILITY IMAP4rev1 IDLE %s\r\n%s OK done\r\n", f.caps, tag)
		case "SELECT":
			fmt.Fprintf(w, "* 30 EXISTS\r\n%s OK [READ-WRITE] selected\r\n", tag)
		case "IDLE":
			fmt.Fprint(w, "+ idling\r\n")
		case "LOGOUT":
			fmt.Fprintf(w, "* BYE bye\r\n%s OK done\r\n", tag)
			_ = w.Flush()
			return
		default:
			fmt.Fprintf(w, "%s OK done\r\n", tag)
		}
		_ = w.Flush()
	}
}

func (f *fakeIMAP) record(cmd string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cmds = append(f.cmds, cmd)
}

// sent reports whether a command starting with prefix was received.
func (f *fakeIMAP) sent(prefix string) bool {
	for _, c := range f.commands() {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}
