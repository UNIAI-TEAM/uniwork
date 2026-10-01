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
// holds after normalization (string, bool, numeric, nil). Integers of every
// kind are widened before comparing, so a smallint column read as int16 (the
// meeting quorum) does not log "60 → 60", and int(5) equals int64(5) when two
// sides were normalized differently. Anything else is treated as changed
// rather than compared structurally.
func equalValue(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if ai, ok := integerValue(a); ok {
		bi, ok := integerValue(b)
		return ok && ai == bi
	}
	switch av := a.(type) {
	case string, bool, float32, float64:
		return av == b
	default:
		return false
	}
}

// integer is an integer of any Go kind, widened so values of different widths
// compare by value. neg separates a negative signed value from a uint64 above
// math.MaxInt64 that shares its bit pattern.
type integer struct {
	neg bool
	abs uint64
}

func integerValue(v any) (integer, bool) {
	switch n := v.(type) {
	case int:
		return signed(int64(n)), true
	case int8:
		return signed(int64(n)), true
	case int16:
		return signed(int64(n)), true
	case int32:
		return signed(int64(n)), true
	case int64:
		return signed(n), true
	case uint:
		return integer{abs: uint64(n)}, true
	case uint8:
		return integer{abs: uint64(n)}, true
	case uint16:
		return integer{abs: uint64(n)}, true
	case uint32:
		return integer{abs: uint64(n)}, true
	case uint64:
		return integer{abs: n}, true
	default:
		return integer{}, false
	}
}

func signed(n int64) integer {
	if n < 0 {
		return integer{neg: true, abs: uint64(-(n + 1)) + 1}
	}
	return integer{abs: uint64(n)}
}

// Text normalizes a nullable text column to a value Diff and JSON can carry:
// nil for NULL, the string otherwise.
func Text(valid bool, s string) any {
	if !valid {
		return nil
	}
	return s
}
