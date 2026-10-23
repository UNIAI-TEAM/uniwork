//go:build race

package document

// raceEnabled lets a test that bounds wall-clock time step aside: the race
// detector slows goldmark's parse 4-7x.
const raceEnabled = true
