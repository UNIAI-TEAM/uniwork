package audit

// Diff returns only the fields whose value changed. Callers build the two maps
// by hand from the columns they care about — deliberately, instead of
// reflecting over the whole row: a row carries pgtype wrappers and columns
// nobody wants in an immutable log, and the explicit map is also the list a
// reviewer reads to answer "what does this command claim to change".
func Diff(before, after map[string]any) map[string]Change {
	changes := map[string]Change{}
	for field, to := range after {
		from, ok := before[field]
		if ok && equalValue(from, to) {
			continue
		}
		changes[field] = Change{From: from, To: to}
	}
	return changes
}

// equalValue compares two audit field values. Fields are the scalars a column
// holds after normalization (string, bool, numeric, nil), so == is enough;
// anything else is treated as changed rather than compared structurally.
func equalValue(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	switch av := a.(type) {
	case string, bool, int, int32, int64, float64:
		return av == b
	default:
		return false
	}
}

// Text normalizes a nullable text column to a value Diff and JSON can carry:
// nil for NULL, the string otherwise.
func Text(valid bool, s string) any {
	if !valid {
		return nil
	}
	return s
}
