package bodystore

import "testing"

func TestEncodeDecodeRoundTrip(t *testing.T) {
	data, err := Encode("hello", "<p>hi</p>")
	if err != nil {
		t.Fatal(err)
	}
	text, html, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if text != "hello" || html != "<p>hi</p>" {
		t.Fatalf("got text=%q html=%q", text, html)
	}
}

func TestObjectKeyShape(t *testing.T) {
	got := ObjectKey("acc", "thr")
	if got != "email-hub/accounts/acc/threads/thr/body.v1.json.gz" {
		t.Fatalf("unexpected key: %s", got)
	}
}
