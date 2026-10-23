package attachtext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"runtime"
	"runtime/debug"
	"runtime/metrics"
	"strings"
	"testing"
	"time"
)

// The backend runs as one 512 MiB pod (GOMEMLIMIT 400 MiB), so one file read
// must stay well inside it whatever the file. These tests feed the worst
// files found and measure the heap while they are read.
const maxReadHeap = 80 << 20

// peakHeap runs f and returns how far the heap rose above where it stood
// before. GOGC is lowered meanwhile so garbage is collected about as soon as
// it is made: what is measured is the heap the read keeps alive.
func peakHeap(t *testing.T, f func()) uint64 {
	t.Helper()
	defer debug.SetGCPercent(debug.SetGCPercent(10))
	runtime.GC()
	sample := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
	heap := func() uint64 { metrics.Read(sample); return sample[0].Value.Uint64() }
	base := heap()
	var peak uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(200 * time.Microsecond)
		defer tick.Stop()
		for {
			peak = max(peak, heap())
			select {
			case <-stop:
				return
			case <-tick.C:
			}
		}
	}()
	f()
	close(stop)
	<-done
	return max(peak, base) - base
}

// densePDF is one page and objects of tiny dictionaries filling about mib MiB:
// cheap bytes that pdfcpu parses into maps, 40 times their size and more.
func densePDF(mib int) []byte {
	p := newPDFBuilder()
	const per = 1 << 17 // 8 bytes each: 1 MiB an object
	refs := make([]string, mib)
	for i := range refs {
		refs[i] = fmt.Sprintf("%d 0 R", 4+i)
	}
	p.obj(1, "<< /Type /Catalog /Pages 2 0 R /X ["+strings.Join(refs, " ")+"] >>")
	p.obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	p.obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>")
	body := "[" + strings.Repeat("<</a 1>>", per) + "]"
	for i := range mib {
		p.obj(4+i, body)
	}
	return p.finish(4 + mib)
}

// manyPagesPDF is pages pages in one flat page tree, each with its own content
// stream: the shape of the 60,000-page file that once took 530 MiB to open.
func manyPagesPDF(pages int) []byte {
	p := newPDFBuilder()
	kids := make([]string, pages)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 4+i)
	}
	p.obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	p.obj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pages))
	p.obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i := range pages {
		p.obj(4+i, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents %d 0 R /Resources << /Font << /F1 3 0 R >> >> >>", 4+pages+i))
	}
	for i := range pages {
		s := fmt.Sprintf("BT /F1 18 Tf 20 100 Td (Page %d) Tj ET", i+1)
		p.obj(4+pages+i, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(s), s))
	}
	return p.finish(4 + 2*pages)
}

func TestReadPDFStaysWithinItsHeapBound(t *testing.T) {
	for name, data := range map[string][]byte{
		"18 MiB of tiny dictionaries": densePDF(18),
		"60,000 pages":                manyPagesPDF(60_000),
	} {
		var err error
		grew := peakHeap(t, func() { _, _, err = ReadPDF(data, 15) })
		t.Logf("%s: heap grew %.1f MiB", name, float64(grew)/(1<<20))
		if !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: err = %v, want ErrUnreadable", name, err)
		}
		// The guard samples every millisecond and collects before it stops a
		// parse, so the heap may run a little past its limit first.
		if bound := pdfHeapLimit(len(data)) + 16<<20; grew > bound {
			t.Errorf("%s: the heap grew %d MiB, want at most %d", name, grew>>20, bound>>20)
		}
	}
	// A long real document still opens.
	var err error
	grew := peakHeap(t, func() { _, _, err = ReadPDF(manyPagesPDF(2_000), 15) })
	if err != nil || grew > maxReadHeap {
		t.Errorf("2,000 pages: %v, heap grew %d MiB", err, grew>>20)
	}
}

func TestExtractPlainStaysWithinItsHeapBound(t *testing.T) {
	for name, data := range map[string][]byte{
		"one line of 60 MiB":    bytes.Repeat([]byte("a"), 60<<20),
		"60 MiB of short lines": bytes.Repeat([]byte("a\n"), 30<<20),
	} {
		var d Doc
		var err error
		grew := peakHeap(t, func() { d, err = extract("text/plain", data) })
		t.Logf("%s: heap grew %.1f MiB, %d parts, %d omitted", name, float64(grew)/(1<<20), len(d.Parts), d.Omitted)
		if err != nil || len(d.Parts) == 0 {
			t.Errorf("%s: %d parts, err %v", name, len(d.Parts), err)
		}
		if grew > maxReadHeap {
			t.Errorf("%s: the heap grew %d MiB, want at most %d", name, grew>>20, maxReadHeap>>20)
		}
	}
}

// scannedPDF is pages pages, each one image of imageBytes: the shape of a
// scanned document, whose bytes are almost all stream data pdfcpu keeps.
func scannedPDF(pages, imageBytes int) []byte {
	p := newPDFBuilder()
	kids := make([]string, pages)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 3+i)
	}
	p.obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	p.obj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pages))
	draw := "q 200 0 0 200 0 0 cm /Im0 Do Q"
	rng := rand.New(rand.NewPCG(1, 2))
	image := make([]byte, imageBytes)
	for i := range image {
		image[i] = byte(rng.Uint32())
	}
	for i := range pages {
		page, content, img := 3+i, 3+pages+i, 3+2*pages+i
		p.obj(page, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents %d 0 R /Resources << /XObject << /Im0 %d 0 R >> >> >>", content, img))
		p.obj(content, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(draw), draw))
		p.obj(img, fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width 1000 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream", imageBytes, image))
	}
	return p.finish(3 + 3*pages)
}

// A scanned document near the 20 MB cap opens, and is cut to the pages kept.
// pdfcpu holds its streams, so the room a parse gets grows with the file: it
// must cover what the file needs plus another file turn's model call (about
// 27 MB of JSON), which runs alongside and counts in the same heap.
func TestReadPDFOpensAScannedFileNearTheCap(t *testing.T) {
	data := scannedPDF(16, 1_300_000)
	if len(data) > 20<<20 {
		t.Fatalf("fixture is %d bytes, over the 20 MiB cap", len(data))
	}
	var pages int
	var out []byte
	var err error
	grew := peakHeap(t, func() { pages, out, err = ReadPDF(data, 15) })
	t.Logf("%.1f MiB scanned PDF: heap grew %.1f MiB", float64(len(data))/(1<<20), float64(grew)/(1<<20))
	if room := pdfHeapLimit(len(data)); room < grew+32<<20 {
		t.Errorf("a parse of this file may grow %d MiB; it needs %d plus 32 for another turn", room>>20, grew>>20)
	}
	if err != nil || pages != 16 {
		t.Fatalf("ReadPDF = %d pages, %v, want 16 and no error", pages, err)
	}
	if n := pagesOf(t, out); n != 15 {
		t.Fatalf("kept %d pages, want 15", n)
	}
}

var garbageSink []byte

// The guard measures from the live heap: garbage still standing when a parse
// starts is not room the parse may fill.
func TestPDFHeapGuardIgnoresGarbageAtTheStart(t *testing.T) {
	defer debug.SetGCPercent(debug.SetGCPercent(-1))
	runtime.GC()
	for range 64 {
		garbageSink = make([]byte, 1<<20)
	}
	garbageSink = nil // 64 MiB the runtime has not collected
	const limit = 16 << 20
	ctx, stop := pdfHeapGuard(context.Background(), limit)
	var live [][]byte
	for ctx.Err() == nil && len(live) < 256 {
		live = append(live, make([]byte, 1<<20))
		time.Sleep(200 * time.Microsecond)
	}
	if err := stop(); !errors.Is(err, errPDFHeap) {
		t.Fatalf("stop() = %v, want errPDFHeap", err)
	}
	if n := len(live); n > limit>>20+8 {
		t.Fatalf("the guard let %d MiB grow live past a %d MiB limit", n, limit>>20)
	}
	runtime.KeepAlive(live)
}
