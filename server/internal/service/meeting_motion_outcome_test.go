package service

import "testing"

func TestMotionOutcomeTable(t *testing.T) {
	cases := []struct {
		name             string
		threshold, base  string
		yes, roll, total int
		want             string
	}{
		{"majority exactly half fails", ThresholdMajority, BasePresent, 5, 10, 12, OutcomeFailed},
		{"majority one over half passes", ThresholdMajority, BasePresent, 6, 10, 12, OutcomePassed},
		{"majority odd roll", ThresholdMajority, BasePresent, 3, 5, 5, OutcomePassed},
		{"two thirds 10 of 15 passes", ThresholdTwoThirds, BasePresent, 10, 15, 20, OutcomePassed},
		{"two thirds 9 of 15 fails", ThresholdTwoThirds, BasePresent, 9, 15, 20, OutcomeFailed},
		{"all members: same yes fails against the larger base", ThresholdMajority, BaseAllMembers, 6, 10, 15, OutcomeFailed},
		{"all members: majority of everyone passes", ThresholdMajority, BaseAllMembers, 8, 10, 15, OutcomePassed},
		{"all members two thirds 10 of 15 passes", ThresholdTwoThirds, BaseAllMembers, 10, 10, 15, OutcomePassed},
		{"all members two thirds 10 of 16 fails", ThresholdTwoThirds, BaseAllMembers, 10, 10, 16, OutcomeFailed},
		{"empty roll fails", ThresholdMajority, BasePresent, 0, 0, 5, OutcomeFailed},
		{"no members fails", ThresholdTwoThirds, BaseAllMembers, 0, 3, 0, OutcomeFailed},
		{"unknown threshold fails", "UNANIMOUS", BasePresent, 10, 10, 10, OutcomeFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := motionOutcome(c.threshold, c.base, c.yes, c.roll, c.total); got != c.want {
				t.Fatalf("motionOutcome(%s, %s, yes=%d, roll=%d, total=%d) = %s, want %s",
					c.threshold, c.base, c.yes, c.roll, c.total, got, c.want)
			}
		})
	}
}

func TestRequiredYes(t *testing.T) {
	cases := []struct {
		threshold string
		d, want   int
	}{
		{ThresholdMajority, 10, 6},
		{ThresholdMajority, 15, 8},
		{ThresholdMajority, 1, 1},
		{ThresholdMajority, 0, 0},
		{ThresholdMajority, -1, 0},
		{ThresholdTwoThirds, 15, 10},
		{ThresholdTwoThirds, 10, 7},
		{ThresholdTwoThirds, 3, 2},
		{ThresholdTwoThirds, 0, 0},
	}
	for _, c := range cases {
		if got := requiredYes(c.threshold, c.d); got != c.want {
			t.Errorf("requiredYes(%s, %d) = %d, want %d", c.threshold, c.d, got, c.want)
		}
	}
}

// The "Cần x/y" line the web shows and the outcome the server records must
// never disagree: a motion passes exactly when yes reaches requiredYes.
func TestRequiredYesAgreesWithOutcome(t *testing.T) {
	for _, threshold := range []string{ThresholdMajority, ThresholdTwoThirds} {
		for d := 1; d <= 30; d++ {
			need := requiredYes(threshold, d)
			for yes := 0; yes <= d; yes++ {
				passed := motionOutcome(threshold, BasePresent, yes, d, 0) == OutcomePassed
				if passed != (yes >= need) {
					t.Fatalf("%s d=%d yes=%d: passed=%v but requiredYes=%d", threshold, d, yes, passed, need)
				}
			}
		}
	}
}

func TestMotionDenominator(t *testing.T) {
	if got := motionDenominator(BasePresent, 7, 12); got != 7 {
		t.Fatalf("PRESENT = %d, want roll 7", got)
	}
	if got := motionDenominator(BaseAllMembers, 7, 12); got != 12 {
		t.Fatalf("ALL_MEMBERS = %d, want total 12", got)
	}
}

func TestMotionEnums(t *testing.T) {
	for _, v := range []string{BallotPublic, BallotSecret} {
		if !validBallotMode(v) {
			t.Errorf("ballot mode %s rejected", v)
		}
	}
	for _, v := range []string{ThresholdMajority, ThresholdTwoThirds} {
		if !validThreshold(v) {
			t.Errorf("threshold %s rejected", v)
		}
	}
	for _, v := range []string{BasePresent, BaseAllMembers} {
		if !validMotionBase(v) {
			t.Errorf("base %s rejected", v)
		}
	}
	for _, v := range []string{ChoiceYes, ChoiceNo, ChoiceAbstain} {
		if !validChoice(v) {
			t.Errorf("choice %s rejected", v)
		}
	}
	for _, v := range []string{"", "public", "OPEN", "UNANIMOUS", "MAYBE"} {
		if validBallotMode(v) || validThreshold(v) || validMotionBase(v) || validChoice(v) {
			t.Errorf("%q accepted", v)
		}
	}
}
