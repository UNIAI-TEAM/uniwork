package attachtext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"runtime"
	"runtime/metrics"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

const (
	// maxPDFBytes is the largest PDF pdfcpu will open: a little over the 20 MiB
	// upload cap, enforced by pdfcpu before it parses anything.
	maxPDFBytes = 32 << 20
	// maxPDFObjects caps the objects a cross-reference table may declare.
	// pdfcpu allocates an entry for each, and a file of tens of thousands of
	// pages takes hundreds of MiB to open, so a file that claims more fails
	// before any is read. A large tagged export of a few hundred pages stays
	// below it.
	maxPDFObjects = 1 << 17
	// maxPDFObjectBytes bounds one indirect object, stream data aside. Real
	// ones are a few KB; the largest are page-tree and name-tree arrays.
	maxPDFObjectBytes = 4 << 20
	// maxPDFObjectStream bounds the objects one object stream declares (/N)
	// and its offset table (/First); real ones hold a few hundred.
	maxPDFObjectStream      = 10_000
	maxPDFObjectStreamFirst = 1 << 20
	// maxPDFDecodeBytes bounds one decoded stream; the parse decodes only
	// object and cross-reference streams, which stay far below it.
	maxPDFDecodeBytes = 16 << 20
	// maxPDFHeapGrowth is what one parse may add to the heap. pdfcpu keeps
	// every object of a file in memory, and its limits count objects and bytes,
	// not what they cost parsed: an 18 MB file of tiny "<</a 1>>" dictionaries
	// takes over 800 MiB. pdfHeapGuard enforces it.
	maxPDFHeapGrowth = 48 << 20
	// pdfTimeout bounds the CPU one call may spend on a hostile file.
	pdfTimeout = 30 * time.Second
)

var (
	// errNoPages: a PDF whose page tree is empty is valid but has nothing to read.
	errNoPages = errors.New("PDF has no pages")
	errPDFHeap = errors.New("PDF needs more than 48 MiB of memory to open")
)

// ReadPDF opens a PDF once and returns its page count and the PDF to send the
// model: data itself when it has no more than keep pages and no encryption,
// otherwise a new, unencrypted PDF of its first min(keep, pages) pages. A PDF
// with only an owner password opens without one and is always rewritten, so
// what is sent never carries its encryption. keep below 1 is a caller bug and
// returns a plain error. A PDF that is damaged, has no pages, needs a password
// to open, or is too large or complex to open safely is ErrUnreadable.
func ReadPDF(data []byte, keep int) (pages int, out []byte, err error) {
	if keep < 1 {
		return 0, nil, fmt.Errorf("attachtext: cannot keep %d PDF pages", keep)
	}
	type result struct {
		pages int
		out   []byte
	}
	r, err := pdfWork(func(ctx context.Context, conf *model.Configuration) (result, error) {
		src, err := api.ReadAndValidate(ctx, bytes.NewReader(data), conf)
		if err != nil {
			return result{}, err
		}
		if src.PageCount < 1 {
			return result{}, errNoPages
		}
		if src.PageCount <= keep && src.Encrypt == nil {
			return result{src.PageCount, data}, nil
		}
		nums := make([]int, min(keep, src.PageCount))
		for i := range nums {
			nums[i] = i + 1
		}
		dst, err := pdfcpu.ExtractPages(ctx, src, nums, false)
		if err != nil {
			return result{}, err
		}
		var b bytes.Buffer
		if err := api.WriteContext(ctx, dst, &b); err != nil {
			return result{}, err
		}
		return result{src.PageCount, b.Bytes()}, nil
	})
	return r.pages, r.out, err
}

// pdfWork runs one pdfcpu job on an untrusted file: with a configuration that
// reads and writes nothing on disk, goes nowhere online and logs nothing
// (pdfcpu's loggers are off until someone sets them), under a deadline, tight
// resource limits and pdfHeapGuard, and with every failure, a parser panic
// included, turned into ErrUnreadable.
func pdfWork[T any](job func(context.Context, *model.Configuration) (T, error)) (out T, err error) {
	defer func() {
		if p := recover(); p != nil {
			var zero T
			out, err = zero, unreadable(fmt.Errorf("PDF parser failed: %v", p))
		}
	}()
	// The stateless configuration never touches the user's config directory.
	conf := model.NewStatelessConfiguration()
	conf.Offline = true
	conf.Optimize = false // the extra pass would only cost memory: nothing here needs it
	conf.Limits.MaxInputBytes = maxPDFBytes
	conf.Limits.MaxStreamBytes = maxPDFBytes
	conf.Limits.MaxDecodeBytes = maxPDFDecodeBytes
	conf.Limits.MaxObjectBytes = maxPDFObjectBytes
	conf.Limits.MaxObjectCount = maxPDFObjects
	conf.Limits.MaxXRefEntries = maxPDFObjects
	conf.Limits.MaxObjectStreamCount = maxPDFObjectStream
	conf.Limits.MaxObjectStreamFirst = maxPDFObjectStreamFirst
	timed, cancel := context.WithTimeout(context.Background(), pdfTimeout)
	defer cancel()
	ctx, stop := pdfHeapGuard(timed, maxPDFHeapGrowth)
	out, err = job(ctx, conf)
	if cause := stop(); cause != nil {
		err = cause
	}
	if err != nil {
		var zero T
		return zero, unreadable(err)
	}
	return out, nil
}

// pdfHeapGuard returns a context that is cancelled once the heap grows more
// than limit past where it stood: pdfcpu checks its context between objects
// and dictionary entries, so the parse stops soon after. The heap is the
// process's, so others' garbage counts too; before giving up the guard
// collects it and looks again, and only live growth past limit stops the
// parse. Callers run one parse at a time (the Ask UNI planner holds a slot for
// it), which keeps that growth the parse's own. stop ends the guard and
// returns errPDFHeap if it stopped the parse.
func pdfHeapGuard(parent context.Context, limit uint64) (ctx context.Context, stop func() error) {
	ctx, cancel := context.WithCancelCause(parent)
	sample := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
	heap := func() uint64 { metrics.Read(sample); return sample[0].Value.Uint64() }
	base := heap()
	done, finished := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(finished)
		tick := time.NewTicker(time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-tick.C:
			}
			if heap() <= base+limit {
				continue
			}
			runtime.GC()
			if heap() > base+limit {
				cancel(errPDFHeap)
				return
			}
		}
	}()
	return ctx, func() error {
		close(done)
		<-finished
		cancel(nil)
		if errors.Is(context.Cause(ctx), errPDFHeap) {
			return errPDFHeap
		}
		return nil
	}
}
