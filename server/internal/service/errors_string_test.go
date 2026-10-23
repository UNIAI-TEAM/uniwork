package service

import "testing"

func TestCodedAndValidationErrorStrings(t *testing.T) {
	t.Parallel()
	if (ValidationError{Msg: "bad"}).Error() != "bad" {
		t.Fatal("ValidationError")
	}
	if (CodedError{Code: "c", Msg: "m"}).Error() != "m" {
		t.Fatal("CodedError msg")
	}
	if (CodedError{Code: "c"}).Error() != "c" {
		t.Fatal("CodedError code")
	}
}
