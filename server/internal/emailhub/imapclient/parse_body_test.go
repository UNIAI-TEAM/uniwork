package imapclient

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestParseBodyRawMessages(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		raw      string
		wantText string
		wantHTML string
	}{
		{
			name: "multipart alternative quoted printable and html",
			raw: "MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/alternative; boundary=alt\r\n\r\n" +
				"--alt\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n" +
				"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
				"Xin ch=C3=A0o\r\n" +
				"--alt\r\n" +
				"Content-Type: text/html; charset=utf-8\r\n\r\n" +
				"<p>Xin chào</p>\r\n" +
				"--alt--\r\n",
			wantText: "Xin chào",
			wantHTML: "<p>Xin chào</p>",
		},
		{
			name: "legacy iso 8859 1 charset",
			raw: "Content-Type: text/plain; charset=iso-8859-1\r\n" +
				"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
				"Caf=E9 r=E9sum=E9",
			wantText: "Café résumé",
		},
		{
			name: "inline text wins over text attachment",
			raw: "MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed; boundary=mixed\r\n\r\n" +
				"--mixed\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
				"Chào anh, gửi báo cáo\r\n" +
				"--mixed\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n" +
				"Content-Disposition: attachment; filename=notes.txt\r\n\r\n" +
				"ghi chú nội bộ\r\n" +
				"--mixed--\r\n",
			wantText: "Chào anh, gửi báo cáo",
		},
		{
			name: "nested multipart alternative",
			raw: "MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
				"--outer\r\n" +
				"Content-Type: multipart/alternative; boundary=inner\r\n\r\n" +
				"--inner\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
				"Nested plain\r\n" +
				"--inner\r\n" +
				"Content-Type: text/html; charset=utf-8\r\n\r\n" +
				"<p>Nested HTML</p>\r\n" +
				"--inner--\r\n" +
				"--outer--\r\n",
			wantText: "Nested plain",
			wantHTML: "<p>Nested HTML</p>",
		},
		{
			name:     "nul and invalid utf8 are sanitized",
			raw:      "Content-Type: text/plain; charset=utf-8\r\n\r\nHi\x00there\xff!",
			wantText: "Hithere!",
		},
		{
			name: "attachment only text remains readable",
			raw: "Content-Type: text/plain; charset=utf-8\r\n" +
				"Content-Disposition: attachment; filename=body.txt\r\n\r\n" +
				"Body sent as an attachment",
			wantText: "Body sent as an attachment",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseBody(strings.NewReader(tt.raw))
			if err != nil {
				t.Fatal(err)
			}
			if got.Text != tt.wantText {
				t.Fatalf("unexpected text:\n got %q\nwant %q", got.Text, tt.wantText)
			}
			if got.HTML != tt.wantHTML {
				t.Fatalf("unexpected html:\n got %q\nwant %q", got.HTML, tt.wantHTML)
			}
			if !utf8.ValidString(got.Text) || !utf8.ValidString(got.HTML) {
				t.Fatalf("body is not valid UTF-8: %+v", got)
			}
		})
	}
}
