package service

import "testing"

func TestVnpayRefundTreatAsPending(t *testing.T) {
	for _, code := range []string{"94", "99"} {
		if !vnpayRefundTreatAsPending(code) {
			t.Fatalf("code %q should be pending", code)
		}
	}
	if vnpayRefundTreatAsPending("91") || vnpayRefundTreatAsPending("00") {
		t.Fatal("unexpected pending")
	}
}
