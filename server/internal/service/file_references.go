package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FileReferenceSource is one business column that stores a FileService file
// id (spec 9.2). The catalogue below is the collector's whole view of where a
// file can be referenced: TestEveryFileIDColumnHasAReferenceSource fails when
// a migration adds a file id column that is not listed here, and the
// collector refuses to delete anything while a listed source has no
// registered provider.
type FileReferenceSource struct {
	Table  string
	Column string
	// Provider is the ReferenceProvider.Name() that answers for this column.
	Provider string
	// IdentityTenant marks the account-avatar branch: the files it points at
	// carry the NULL tenant (ADR 0023) and every reference row must too.
	IdentityTenant bool
	// tenants lists the tenant of every row naming one of ids, soft-deleted
	// rows included (T1-Q10). A row whose tenant cannot be resolved comes
	// back with Known false and holds the file.
	tenants func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error)
}

// fileReferenceTenant is one business row naming a file, with its tenant.
type fileReferenceTenant struct {
	FileID         files.FileID
	OrganizationID string
	Known          bool
}

// managedFileReferenceSources is the catalogue of every file id column in the
// managed scope. A module that adds a column adds its row, its provider and
// its tenant query (file_gc.sql) in the same change.
func managedFileReferenceSources() []FileReferenceSource {
	return []FileReferenceSource{
		{
			Table: "attachments", Column: "file_id", Provider: TaskAttachmentProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCAttachmentRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, knownTenant(r.FileID, r.OrganizationID))
				}
				return out, err
			},
		},
		{
			Table: "users", Column: "avatar_file_id", Provider: UserAvatarProvider{}.Name(), IdentityTenant: true,
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCUserAvatarRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, fileReferenceTenant{FileID: files.FileID(r.FileID.String), OrganizationID: r.OrganizationID.String, Known: true})
				}
				return out, err
			},
		},
		{
			Table: "chat_messages", Column: "file_id", Provider: chatFileReferenceProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCChatMessageRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, firstTenant(r.FileID, r.RoomOrganizationID, r.RoomWorkspaceOrganizationID, r.MessageWorkspaceOrganizationID))
				}
				return out, err
			},
		},
		{
			Table: "chat_voice_recordings", Column: "file_id", Provider: chatVoiceRecordingProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCChatVoiceRecordingRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, knownTenant(r.FileID, r.OrganizationID))
				}
				return out, err
			},
		},
		{
			Table: "audit_exports", Column: "file_id", Provider: auditExportReferenceProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCAuditExportRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, knownTenant(r.FileID, r.OrganizationID))
				}
				return out, err
			},
		},
		{
			Table: "document_versions", Column: "file_id", Provider: DocumentVersionReferenceProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCDocumentVersionRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, knownTenant(r.FileID, r.OrganizationID))
				}
				return out, err
			},
		},
		{
			Table: "document_assets", Column: "file_id", Provider: DocumentAssetReferenceProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCDocumentAssetRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, fileReferenceTenant{FileID: files.FileID(r.FileID), OrganizationID: r.OrganizationID, Known: strings.TrimSpace(r.OrganizationID) != ""})
				}
				return out, err
			},
		},
		{
			Table: "meeting_recordings", Column: "file_id", Provider: MeetingRecordingProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCMeetingRecordingRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, firstTenant(r.FileID, r.OrganizationID))
				}
				return out, err
			},
		},
	}
}

func knownTenant(fileID pgtype.Text, org string) fileReferenceTenant {
	return fileReferenceTenant{FileID: files.FileID(fileID.String), OrganizationID: org, Known: strings.TrimSpace(org) != ""}
}

func firstTenant(fileID pgtype.Text, orgs ...pgtype.Text) fileReferenceTenant {
	for _, org := range orgs {
		if org.Valid && strings.TrimSpace(org.String) != "" {
			return fileReferenceTenant{FileID: files.FileID(fileID.String), OrganizationID: org.String, Known: true}
		}
	}
	return fileReferenceTenant{FileID: files.FileID(fileID.String)}
}

// fileReferenceRegistry is what the collector asks before it deletes: every
// registered provider, and the catalogue of columns they cover. It is built
// once, from the composition root's providers, and never drops a provider
// because a purpose is disabled or a feature flag is off - data that still
// exists keeps its provider (spec 9.2).
type fileReferenceRegistry struct {
	providers []files.ReferenceProvider
	sources   []FileReferenceSource
	byPurpose map[files.UploadPurpose][]string
}

// errFileReferenceCoverage marks a registry that cannot prove a file is
// unreferenced. The collector turns it into "delete nothing".
var errFileReferenceCoverage = errors.New("files: reference providers do not cover every file id column")

func newFileReferenceRegistry(providers []files.ReferenceProvider, sources []FileReferenceSource) (*fileReferenceRegistry, error) {
	r := &fileReferenceRegistry{sources: sources, byPurpose: map[files.UploadPurpose][]string{}}
	seen := map[string]bool{}
	for _, p := range providers {
		if p == nil || isNilInterface(p) {
			return nil, errors.New("files: nil reference provider")
		}
		name := strings.TrimSpace(p.Name())
		if name == "" {
			return nil, errors.New("files: reference provider without a name")
		}
		if seen[name] {
			return nil, fmt.Errorf("files: reference provider %q registered twice", name)
		}
		seen[name] = true
		for _, purpose := range p.Purposes() {
			if !purpose.Valid() {
				return nil, fmt.Errorf("files: reference provider %q names unknown purpose %q", name, string(purpose))
			}
			r.byPurpose[purpose] = append(r.byPurpose[purpose], name)
		}
		r.providers = append(r.providers, p)
	}
	return r, nil
}

// coverage reports what keeps the collector from proving a file is garbage:
// a catalogue column whose provider is not registered, or an enabled purpose
// no provider answers for (FS-C1 section 5.6). A disabled purpose needs no
// provider until it is opened, but one registered for it stays.
func (r *fileReferenceRegistry) coverage(registry files.Registry) error {
	var gaps []string
	names := map[string]bool{}
	for _, p := range r.providers {
		names[p.Name()] = true
	}
	for _, src := range r.sources {
		if !names[src.Provider] {
			gaps = append(gaps, fmt.Sprintf("%s.%s has no provider %q", src.Table, src.Column, src.Provider))
		}
	}
	for _, spec := range registry.Specs() {
		if !spec.Disabled && len(r.byPurpose[spec.Purpose]) == 0 {
			gaps = append(gaps, fmt.Sprintf("purpose %s has no provider", string(spec.Purpose)))
		}
	}
	if len(gaps) == 0 {
		return nil
	}
	sort.Strings(gaps)
	return fmt.Errorf("%w: %s", errFileReferenceCoverage, strings.Join(gaps, "; "))
}

// covers reports whether some provider answers for purpose.
func (r *fileReferenceRegistry) covers(purpose files.UploadPurpose) bool {
	return len(r.byPurpose[purpose]) > 0
}

// heldBy asks every provider about every id, not only the providers of the
// file's own purpose: a file reused across modules (T1-Q3) is held by any of
// them. The first provider error aborts the whole call - the caller keeps
// every file of the batch (FS-C1 section 6).
func (r *fileReferenceRegistry) heldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]fileHold, error) {
	out := map[files.FileID]fileHold{}
	if len(ids) == 0 {
		return out, nil
	}
	for _, p := range r.providers {
		held, err := p.HeldBy(ctx, q, ids)
		if err != nil {
			return nil, fmt.Errorf("files: provider %s: %w", p.Name(), err)
		}
		for id, reason := range held {
			if reason == "" {
				reason = files.HoldActive
			}
			if cur, ok := out[id]; !ok || holdRank(reason) > holdRank(cur.Reason) {
				out[id] = fileHold{Provider: p.Name(), Reason: reason}
			}
		}
	}
	return out, nil
}

// fileHold is the strongest hold any provider reported for a file.
type fileHold struct {
	Provider string
	Reason   files.HoldReason
}

// holdRank orders hold reasons so a report shows the strongest one. Any hold
// keeps the file; the rank only chooses what the report names.
func holdRank(r files.HoldReason) int {
	switch r {
	case files.HoldLegalHold:
		return 5
	case files.HoldRetention:
		return 4
	case files.HoldSoftDeleted:
		return 3
	case files.HoldVersionHistory:
		return 2
	case files.HoldActive:
		return 1
	default:
		// An unknown reason from a provider still holds, above active, so a
		// new reason is never reported as weaker than it is.
		return 6
	}
}

// referenceTenants lists, per file, the tenant of every row naming it across
// the whole catalogue. Any query error aborts the call.
func (r *fileReferenceRegistry) referenceTenants(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID][]fileReferenceTenantAt, error) {
	out := map[files.FileID][]fileReferenceTenantAt{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	for _, src := range r.sources {
		if src.tenants == nil {
			return nil, fmt.Errorf("%w: %s.%s has no tenant query", errFileReferenceCoverage, src.Table, src.Column)
		}
		rows, err := src.tenants(ctx, q, raw)
		if err != nil {
			return nil, fmt.Errorf("files: tenant check %s.%s: %w", src.Table, src.Column, err)
		}
		for _, row := range rows {
			if row.FileID == "" {
				continue
			}
			out[row.FileID] = append(out[row.FileID], fileReferenceTenantAt{fileReferenceTenant: row, Source: src})
		}
	}
	return out, nil
}

// fileReferenceTenantAt is a reference row with the column it came from.
type fileReferenceTenantAt struct {
	fileReferenceTenant
	Source FileReferenceSource
}

// crossTenant reports the first reference whose tenant is not the file's
// (T1-Q10): an organization row naming another organization's file, an
// identity row naming an organization file or the reverse, or a row whose
// tenant cannot be resolved. Such a file is quarantined, never collected.
func crossTenant(file db.File, refs []fileReferenceTenantAt) (fileReferenceTenantAt, bool) {
	for _, ref := range refs {
		if ref.Source.IdentityTenant {
			if file.OrganizationID.Valid {
				return ref, true
			}
			continue
		}
		if !ref.Known || !file.OrganizationID.Valid || ref.OrganizationID != file.OrganizationID.String {
			return ref, true
		}
	}
	return fileReferenceTenantAt{}, false
}
