package service

// Motion vocabulary (spec §3.5–3.7). The strings are the database values: the
// CHECK constraints on meeting_motions and meeting_motion_ballots list the same.
const (
	MotionDraft  = "DRAFT"
	MotionOpen   = "OPEN"
	MotionClosed = "CLOSED"

	BallotPublic = "PUBLIC"
	BallotSecret = "SECRET"

	ThresholdMajority  = "MAJORITY"
	ThresholdTwoThirds = "TWO_THIRDS"

	BasePresent    = "PRESENT"
	BaseAllMembers = "ALL_MEMBERS"

	ChoiceYes     = "YES"
	ChoiceNo      = "NO"
	ChoiceAbstain = "ABSTAIN"

	OutcomePassed = "PASSED"
	OutcomeFailed = "FAILED"

	motionTitleMax       = 200
	motionDescriptionMax = 2000
)

// motionDenominator is what a motion is decided against: the roll frozen when
// voting opened, or every member of the meeting at that moment.
func motionDenominator(base string, rollSize, totalMembers int) int {
	if base == BaseAllMembers {
		return totalMembers
	}
	return rollSize
}

// requiredYes is the smallest YES count that passes. A member who never casts
// a ballot counts as not in favour, so silence can never help a motion pass.
// Zero when there is nobody to decide: such a motion always fails.
func requiredYes(threshold string, denominator int) int {
	if denominator <= 0 {
		return 0
	}
	if threshold == ThresholdTwoThirds {
		// ceil(2d/3) in integers.
		return (2*denominator + 2) / 3
	}
	return denominator/2 + 1
}

// motionOutcome decides a closed motion from the counts frozen on its row.
// Exactly half is not a majority; exactly two thirds is two thirds.
func motionOutcome(threshold, base string, yes, rollSize, totalMembers int) string {
	d := motionDenominator(base, rollSize, totalMembers)
	if d <= 0 {
		return OutcomeFailed
	}
	switch threshold {
	case ThresholdMajority:
		if yes*2 > d {
			return OutcomePassed
		}
	case ThresholdTwoThirds:
		if yes*3 >= d*2 {
			return OutcomePassed
		}
	}
	return OutcomeFailed
}

func validBallotMode(v string) bool { return v == BallotPublic || v == BallotSecret }

func validThreshold(v string) bool { return v == ThresholdMajority || v == ThresholdTwoThirds }

func validMotionBase(v string) bool { return v == BasePresent || v == BaseAllMembers }

func validChoice(v string) bool { return v == ChoiceYes || v == ChoiceNo || v == ChoiceAbstain }
