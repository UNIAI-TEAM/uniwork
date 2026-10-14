package service

import (
	"context"
	"net/http"
	"path"
	"strconv"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document names (E6 FD-02, appendix §3.3). One normalizer every write path
// calls, and one duplicate key: lower(title COLLATE "und-x-icu") over the NFC
// title, computed in SQL (document_names.sql) on a case-permitting collation
// so "Hợp đồng" and "HỢP ĐỒNG" collide while the cluster's LC_CTYPE decides
// nothing, and accents stay significant ("Ma" and "Mã" are two names). Go
// never lowercases: it reads keys back from the query.
//
// Scope of the key (FD-D4): live folders of one workspace under one parent
// (the root is a parent, COALESCE(parent_id, '')). Pages and files never
// carry folder_name_taken (FD-D10); they get a "(n)" name only when a move or
// a restore lands them on one.

const (
	// maxFolderTitle is FD-D3: a folder name is at most 255 runes.
	maxFolderTitle = 255
	// titleSuffixWindow is how many "(n)" candidates one allocator query tests.
	titleSuffixWindow = 64
	// maxTitleSuffix caps the search for a free n: a parent holding every
	// number up to it is refused rather than searched forever.
	maxTitleSuffix = 1024
	// titleWriteAttempts bounds the savepoint retry of a title that may hit
	// the folder-name unique index of PR 2 (§3.3).
	titleWriteAttempts = 3
)

func errFolderNameTaken() error {
	return coded(http.StatusConflict, "folder_name_taken", "thư mục đã có tên này trong cùng thư mục cha")
}

// errDocumentNameExhausted is the answer when no free "(n)" name can be found
// for a document - the destination holds every number to maxTitleSuffix, or
// the savepoint retry ran out of attempts. A folder keeps folder_name_taken
// (FD-D5 assigns it to a move or a restore that runs out of attempts); a page
// or a file never carries that code (FD-D10) and answers the generic conflict
// the error mapper already knows instead of an uncoded 500 - no code of its
// own classifies that case yet, which the FD-02 report names as a question.
func errDocumentNameExhausted(kind string) error {
	if kind == DocumentKindFolder {
		return errFolderNameTaken()
	}
	return coded(http.StatusConflict, "conflict", "không còn tên trống cho tài liệu trong thư mục đích")
}

// documentTitleLimit is the FD-D3 cap by kind.
func documentTitleLimit(kind string) int {
	if kind == DocumentKindFolder {
		return maxFolderTitle
	}
	return maxDocumentTitle
}

// normalizeDocumentTitle is the one normalizer of a title entering a documents
// row: TrimSpace, NFC, then the kind's cap, empty refused as invalid. Every
// write path calls it - create page, create file and blank file, copy,
// conversion, source save, rename, and the "(n)" auto-rename of a move or a
// restore - so what the row holds is what the duplicate key is computed over.
func normalizeDocumentTitle(kind, raw string) (string, error) {
	title := norm.NFC.String(strings.TrimSpace(raw))
	if title == "" {
		return "", Invalid("tên tài liệu không được để trống")
	}
	if limit := documentTitleLimit(kind); len([]rune(title)) > limit {
		if kind == DocumentKindFolder {
			return "", Invalid("tên thư mục tối đa 255 ký tự")
		}
		return "", Invalid("tên tài liệu tối đa 500 ký tự")
	}
	return title, nil
}

// titleSuffixRoot splits a title for the "(n)" rule: a file keeps its last
// extension outside the suffix ("Báo cáo (2).docx"), a page or a folder has no
// extension. A dot-title (".env") is a name, not an extension.
func titleSuffixRoot(kind, title string) (root, ext string) {
	if kind != DocumentKindFile {
		return title, ""
	}
	ext = path.Ext(title)
	root = strings.TrimSuffix(title, ext)
	if root == "" {
		return title, ""
	}
	return root, ext
}

// trimTitleRunes cuts s to at most limit runes and drops a combining mark the
// cut left dangling, so a composed character is never split into a bare base
// letter plus a stray accent.
func trimTitleRunes(s string, limit int) string {
	if limit < 1 {
		limit = 1
	}
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	cut := runes[:limit]
	for len(cut) > 0 && unicode.Is(unicode.Mn, cut[len(cut)-1]) {
		cut = cut[:len(cut)-1]
	}
	return strings.TrimRight(string(cut), " ")
}

// suffixedTitle is the "(n)" name: "base (2)", a file "base (2).docx". The
// base is trimmed by rune on the NFC title so the whole name fits the kind's
// cap; the suffix is never cut.
func suffixedTitle(kind, base string, n int) string {
	suffix := " (" + strconv.Itoa(n) + ")"
	root, ext := titleSuffixRoot(kind, norm.NFC.String(base))
	budget := documentTitleLimit(kind) - len([]rune(suffix)) - len([]rune(ext))
	return trimTitleRunes(root, budget) + suffix + ext
}

// documentTitleWriteError maps the folder-name unique violation (23505, via
// the package's isUniqueViolation) onto the wire answer of a duplicate: a
// create or a rename is refused, never renamed for, so the violation becomes
// the same 409 the pre-check answers. Until PR 2 creates
// idx_documents_folder_name_uidx only the titleWriteErr test seam produces one,
// so this path is exercised before the index ships. The kind decides the code
// (errDocumentNameExhausted), so a page or a file never answers
// folder_name_taken (FD-D10) and never an uncoded 500 either.
func documentTitleWriteError(kind string, err error) error {
	if isUniqueViolation(err) {
		return errDocumentNameExhausted(kind)
	}
	return err
}

// documentNameScope is where a name is being placed: the tenant pair, the
// parent it lands under ("" is the root), the kind the duplicate rule is
// scoped to, and the row that must not collide with itself - the one being
// renamed or moved.
type documentNameScope struct {
	OrganizationID string
	WorkspaceID    string
	ParentID       string
	Kind           string
	ExcludeID      string
}

// titleDecision is one decided name with the key SQL computed for it: later
// candidates of the same command compare against that key, so Go never
// derives a key of its own.
type titleDecision struct {
	Title string
	Key   string
}

// nameKeys runs the one duplicate-key query over titles, in order: each row
// is the SQL-computed key and whether a live document of scope.Kind already
// holds it under scope.ParentID.
func (s *DocumentService) nameKeys(ctx context.Context, q *db.Queries, scope documentNameScope, titles []string) ([]db.ListDocumentNameKeysRow, error) {
	if len(titles) == 0 {
		return nil, nil
	}
	return q.ListDocumentNameKeys(ctx, db.ListDocumentNameKeysParams{
		OrganizationID: scope.OrganizationID, WorkspaceID: scope.WorkspaceID,
		Kind: scope.Kind, ParentID: nullText(scope.ParentID), ExcludeID: nullText(scope.ExcludeID),
		Titles: titles,
	})
}

// requireFreeFolderName refuses a folder create or rename whose name a live
// sibling already holds: 409 folder_name_taken, with nothing about the holder
// in the answer - it may be a folder the caller cannot read (FD-D5).
func (s *DocumentService) requireFreeFolderName(ctx context.Context, q *db.Queries, scope documentNameScope, title string) error {
	rows, err := s.nameKeys(ctx, q, scope, []string{title})
	if err != nil {
		return err
	}
	if len(rows) == 1 && rows[0].Taken {
		return errFolderNameTaken()
	}
	return nil
}

// allocateDocumentTitle picks the smallest n >= 2 whose "base (n)" no live
// sibling of scope.Kind holds and whose key the caller has not already given
// out (given holds keys SQL computed, from nameKeys and earlier allocations).
// Candidates are tested in windows, so a parent full of "base (n)" names still
// costs a handful of queries.
func (s *DocumentService) allocateDocumentTitle(ctx context.Context, q *db.Queries, scope documentNameScope, base string, given map[string]bool) (titleDecision, error) {
	for start := 2; start <= maxTitleSuffix; start += titleSuffixWindow {
		titles := make([]string, 0, titleSuffixWindow)
		for n := start; n < start+titleSuffixWindow && n <= maxTitleSuffix; n++ {
			titles = append(titles, suffixedTitle(scope.Kind, base, n))
		}
		rows, err := s.nameKeys(ctx, q, scope, titles)
		if err != nil {
			return titleDecision{}, err
		}
		for i, row := range rows {
			if !row.Taken && !given[row.Key] {
				return titleDecision{Title: titles[i], Key: row.Key}, nil
			}
		}
	}
	// Unreachable short of a parent holding every number to maxTitleSuffix, but
	// never an uncoded 500: a folder keeps the contract's answer, a page or a
	// file the generic conflict (see errDocumentNameExhausted).
	return titleDecision{}, errDocumentNameExhausted(scope.Kind)
}

// availableMoveTitle is the moved document's final name: its own title when
// the destination leaves it free, else the smallest "base (n)" free there
// (FD-D5). Every attempt of the savepoint retry calls this again, so the
// answer is read from the destination as it is at that attempt, never from an
// earlier read of the same transaction.
func (s *DocumentService) availableMoveTitle(ctx context.Context, q *db.Queries, scope documentNameScope, title string) (titleDecision, error) {
	rows, err := s.nameKeys(ctx, q, scope, []string{title})
	if err != nil {
		return titleDecision{}, err
	}
	if len(rows) == 1 && !rows[0].Taken {
		return titleDecision{Title: title, Key: rows[0].Key}, nil
	}
	return s.allocateDocumentTitle(ctx, q, scope, title, nil)
}

// withTitleSavepoint runs write inside a SAVEPOINT (a nested pgx
// transaction), so a statement that fails leaves the surrounding transaction
// usable: the caller rolls back to the savepoint and retries instead of every
// later statement failing with 25P02. The titleWriteErr seam, when a test set
// it, runs first and its error is handled exactly as the write's own.
func (s *DocumentService) withTitleSavepoint(ctx context.Context, tx pgx.Tx, attempt int, write func() error) error {
	sp, err := tx.Begin(ctx)
	if err != nil {
		return err
	}
	if s.titleWriteErr != nil {
		if err := s.titleWriteErr(attempt); err != nil {
			_ = sp.Rollback(ctx)
			return err
		}
	}
	if err := write(); err != nil {
		_ = sp.Rollback(ctx)
		return err
	}
	return sp.Commit(ctx)
}
