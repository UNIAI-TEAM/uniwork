-- Document access (C-01 §4 + §13.4; UNI-676). The queries behind
-- DocumentService.effectiveLevel and its authorize helpers. Membership is
-- never read here: it is decided only by WorkspaceService.RequireMember /
-- OrganizationService.RequireMember / RequireAgentMember.

-- Authorize-by-id (the GetTask pattern): the id alone finds the row, then the
-- service decides visibility from the row's own organization/workspace pair.
-- The caller never learns anything about a row it cannot read.
-- name: GetDocumentByID :one
SELECT *
FROM documents
WHERE id = sqlc.arg(id);

-- The mutation gate: the row lock serializes every command on a document
-- with share grants/revokes (which take the same lock), so the access
-- decision inside a mutation transaction always sees the committed ACL.
-- name: LockDocumentByID :one
SELECT *
FROM documents
WHERE id = sqlc.arg(id)
FOR UPDATE;
