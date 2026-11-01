-- Documents "other sources" (UNI-1305 item C): files that live in Chat, Tasks,
-- Meetings and Email Hub, listed on the documents home. Each query mirrors its
-- own domain's read gate in SQL, so a page never filters rows in Go after the
-- fact and never leaks a row the domain would refuse; the domain's own Open
-- re-checks on download and save.
--
-- Every query has the same output shape and the same keyset: rows sort by
-- (sort_at DESC, source_id DESC), source_id compared byte-wise (COLLATE "C")
-- so the service can merge the four pages in Go with the same order. Filters:
--   cursor_at/cursor_id  keyset (both NULL = first page)
--   q                    name contains: Go folds the term (lower case, no
--                        diacritics, like service.foldForSearch), escapes it,
--                        and it is matched against uw_fold_search(name)
--   type_mode            '' all | 'ext' extension in type_exts | 'image' |
--                        'other' neither a known extension nor an image
--   row_id               one row by its own id (download/save lookup)
--   parent_id            only the files held by this room / task / meeting / thread
--
-- Shape of each query: "base" holds the domain's gate and the raw columns;
-- "page" applies the keyset and filters, sorts on the base columns (so the
-- supporting partial index orders the scan - source_id is 'prefix:' || id, a
-- constant prefix per source, so ordering by id gives the same order) and
-- takes the LIMIT; only then are the rows decorated (owner names, a DM's
-- peer), so those joins run for the page's rows and never for the whole
-- history. The `sort_at <= cursor` bound is redundant with the keyset tuple on
-- purpose: it is the part an index range can use.

-- name: ListDocumentSourceChatFiles :many
-- Chat's read gate (ChatService.authorizeRoomAccess): a public channel of this
-- workspace is open to every workspace member; any other room needs an
-- active or invited member row; a DM also needs the viewer in its member set.
-- Workspace rooms and channels must belong to this workspace, DMs and groups
-- to its organization. Archived rooms, deleted messages and legacy rows whose
-- bytes never moved to FileService (file_id NULL) are left out.
-- Supported by idx_chat_messages_org_files.
WITH base AS (
  SELECT
    m.id AS id,
    ('chat:' || m.id)::text AS source_id,
    m.created_at AS sort_at,
    m.sender_id AS sender_id,
    m.sender_kind AS sender_kind,
    r.id AS room_id,
    r.kind AS room_kind,
    r.name AS room_name,
    f.original_filename AS name,
    COALESCE(f.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, 0)::bigint AS size_bytes,
    (f.original_filename COLLATE "vi-x-icu")::text AS name_key,
    COALESCE(eu.display_name COLLATE "vi-x-icu", '')::text AS editor_key,
    (NULLIF(btrim(eu.display_name), '') IS NULL)::boolean AS editor_null
  FROM chat_messages m
  JOIN chat_rooms r ON r.id = m.room_id AND r.organization_id = m.organization_id
  JOIN files f ON f.id = m.file_id AND f.status = 'ready'
  LEFT JOIN users eu ON eu.id = m.sender_id
  WHERE m.organization_id = sqlc.arg(organization_id)::text
    AND m.kind = 'file'
    AND m.deleted_at IS NULL
    AND m.file_id IS NOT NULL
    AND r.archived_at IS NULL
    AND (
      (r.kind IN ('workspace', 'channel')
        AND r.workspace_id = sqlc.arg(workspace_id)::text
        AND ((r.kind = 'channel' AND r.visibility = 'public')
          OR EXISTS (
            SELECT 1 FROM chat_room_members cm
            WHERE cm.room_id = r.id AND cm.user_id = sqlc.arg(viewer_id)::text
              AND cm.status IN ('invited', 'active'))))
      OR (r.kind IN ('group', 'dm')
        AND EXISTS (
          SELECT 1 FROM chat_room_members cm
          WHERE cm.room_id = r.id AND cm.user_id = sqlc.arg(viewer_id)::text
            AND cm.status IN ('invited', 'active'))
        AND (r.kind = 'group'
          OR upper(sqlc.arg(viewer_id)::text) = ANY(string_to_array(upper(COALESCE(r.member_set_key, '')), '|'))))
    )
    AND (sqlc.narg(row_id)::text IS NULL OR m.id = sqlc.narg(row_id)::text)
    AND (sqlc.narg(parent_id)::text IS NULL OR r.id = sqlc.narg(parent_id)::text)
), page AS (
  SELECT id, source_id, sort_at, sender_id, sender_kind, room_id, room_kind, room_name, name, mime_type, size_bytes, name_key, editor_key, editor_null
  FROM base
  WHERE -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
    -- requested direction; an editor-less row (editor_null) is always last.
    (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
         WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (sort_at, source_id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (sort_at, source_id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (size_bytes, source_id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (size_bytes, source_id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (name_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (name_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'editor' THEN (editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
              OR (editor_null = sqlc.narg(sort_cursor_null)::boolean
                  AND CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
         ELSE true END)
    AND (sqlc.narg(sort_key)::text IS DISTINCT FROM 'updated' OR sqlc.narg(sort_cursor_id)::text IS NULL
         OR CASE WHEN sqlc.arg(sort_desc)::boolean THEN sort_at <= sqlc.narg(sort_cursor_at)::timestamptz
                 ELSE sort_at >= sqlc.narg(sort_cursor_at)::timestamptz END)
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (sort_at <= sqlc.narg(cursor_at)::timestamptz
        AND (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C")))
    AND (sqlc.narg(q)::text IS NULL OR uw_fold_search(name) LIKE '%' || sqlc.narg(q)::text || '%')
    AND CASE sqlc.arg(type_mode)::text
      WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
      WHEN 'image' THEN mime_type LIKE 'image/%'
      WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
        AND mime_type NOT LIKE 'image/%'
      ELSE true
    END
  -- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
  -- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
  -- bound parameter, so the planner folds the unused ones away and a plain
  -- (key, id) order remains.
  ORDER BY
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN id COLLATE "C" END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN editor_null END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN size_bytes END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN size_bytes END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN sort_at END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) DESC
  LIMIT sqlc.arg(row_limit)::int
)
SELECT
  p.source_id::text AS source_id,
  p.id::text AS row_id,
  p.sort_at AS sort_at,
  p.room_kind::text AS parent_kind,
  p.room_id::text AS parent_id,
  COALESCE(NULLIF(p.room_name, ''), peer.display_name, '')::text AS parent_title,
  ''::text AS parent_ref,
  p.name::text AS name,
  p.mime_type AS mime_type,
  p.size_bytes AS size_bytes,
  p.sender_id::text AS owner_id,
  p.sender_kind::text AS owner_kind,
  COALESCE(su.display_name, ag.name, '')::text AS owner_name,
  p.name_key AS name_key,
  p.editor_key AS editor_key,
  p.editor_null AS editor_null
FROM page p
LEFT JOIN users su ON su.id = p.sender_id
LEFT JOIN agents ag ON ag.id = p.sender_id AND ag.organization_id = sqlc.arg(organization_id)::text
LEFT JOIN LATERAL (
  SELECT u.display_name
  FROM chat_room_members pm
  JOIN users u ON u.id = pm.user_id
  WHERE pm.room_id = p.room_id AND pm.user_id <> sqlc.arg(viewer_id)::text
  ORDER BY pm.created_at, pm.id
  LIMIT 1
) peer ON p.room_kind = 'dm'
ORDER BY p.sort_at DESC, p.id COLLATE "C" DESC;

-- name: ListDocumentSourceTaskFiles :many
-- Tasks' read gate (TaskService.loadAttachment): any member of the
-- attachment's workspace reads an attachment bound to a task or a comment.
-- Rows still staged (no task, no comment), rows whose task or comment is gone
-- and FileService rows that are not ready are left out, and so are the images
-- pasted into a task description (purpose task_description_image): they are
-- part of the description, not files anyone attached. parent_ref carries the
-- task id for a comment attachment, so the client can link to the task.
-- Supported by idx_attachments_workspace_created.
WITH base AS (
  SELECT
    a.id AS id,
    ('task:' || a.id)::text AS source_id,
    a.created_at AS sort_at,
    (CASE WHEN a.comment_id IS NOT NULL THEN 'task_comment' ELSE 'task' END)::text AS parent_kind,
    COALESCE(a.comment_id, t.id)::text AS parent_id,
    t.title::text AS parent_title,
    t.id::text AS parent_ref,
    COALESCE(f.original_filename, a.filename)::text AS name,
    COALESCE(f.content_type, a.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, a.size_bytes, 0)::bigint AS size_bytes,
    a.uploader_id AS uploader_id,
    a.uploader_type AS uploader_type,
    (COALESCE(f.original_filename, a.filename) COLLATE "vi-x-icu")::text AS name_key,
    COALESCE(eu.display_name COLLATE "vi-x-icu", '')::text AS editor_key,
    (NULLIF(btrim(eu.display_name), '') IS NULL)::boolean AS editor_null
  FROM attachments a
  LEFT JOIN task_comments c ON c.id = a.comment_id AND c.organization_id = a.organization_id
  JOIN tasks t ON t.id = COALESCE(a.task_id, c.task_id)
    AND t.organization_id = a.organization_id AND t.workspace_id = a.workspace_id
    AND t.trashed_at IS NULL
  LEFT JOIN files f ON f.id = a.file_id
  LEFT JOIN users eu ON eu.id = a.uploader_id
  WHERE a.organization_id = sqlc.arg(organization_id)::text
    AND a.workspace_id = sqlc.arg(workspace_id)::text
    AND (a.task_id IS NOT NULL OR a.comment_id IS NOT NULL)
    AND (a.comment_id IS NULL OR c.id IS NOT NULL)
    AND (a.file_id IS NULL OR f.status = 'ready')
    AND a.purpose IS DISTINCT FROM 'task_description_image'
    AND (sqlc.narg(row_id)::text IS NULL OR a.id = sqlc.narg(row_id)::text)
    AND (sqlc.narg(parent_id)::text IS NULL OR t.id = sqlc.narg(parent_id)::text)
), page AS (
  SELECT id, source_id, sort_at, parent_kind, parent_id, parent_title, parent_ref, name, mime_type, size_bytes,
    uploader_id, uploader_type, name_key, editor_key, editor_null
  FROM base
  WHERE -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
    -- requested direction; an editor-less row (editor_null) is always last.
    (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
         WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (sort_at, source_id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (sort_at, source_id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (size_bytes, source_id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (size_bytes, source_id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (name_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (name_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'editor' THEN (editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
              OR (editor_null = sqlc.narg(sort_cursor_null)::boolean
                  AND CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
         ELSE true END)
    AND (sqlc.narg(sort_key)::text IS DISTINCT FROM 'updated' OR sqlc.narg(sort_cursor_id)::text IS NULL
         OR CASE WHEN sqlc.arg(sort_desc)::boolean THEN sort_at <= sqlc.narg(sort_cursor_at)::timestamptz
                 ELSE sort_at >= sqlc.narg(sort_cursor_at)::timestamptz END)
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (sort_at <= sqlc.narg(cursor_at)::timestamptz
        AND (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C")))
    AND (sqlc.narg(q)::text IS NULL OR uw_fold_search(name) LIKE '%' || sqlc.narg(q)::text || '%')
    AND CASE sqlc.arg(type_mode)::text
      WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
      WHEN 'image' THEN mime_type LIKE 'image/%'
      WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
        AND mime_type NOT LIKE 'image/%'
      ELSE true
    END
  -- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
  -- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
  -- bound parameter, so the planner folds the unused ones away and a plain
  -- (key, id) order remains.
  ORDER BY
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN id COLLATE "C" END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN editor_null END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN size_bytes END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN size_bytes END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN sort_at END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) DESC
  LIMIT sqlc.arg(row_limit)::int
)
SELECT
  p.source_id::text AS source_id,
  p.id::text AS row_id,
  p.sort_at AS sort_at,
  p.parent_kind AS parent_kind,
  p.parent_id AS parent_id,
  p.parent_title AS parent_title,
  p.parent_ref AS parent_ref,
  p.name AS name,
  p.mime_type AS mime_type,
  p.size_bytes AS size_bytes,
  p.uploader_id::text AS owner_id,
  p.uploader_type::text AS owner_kind,
  COALESCE(uu.display_name, ag.name, '')::text AS owner_name,
  p.name_key AS name_key,
  p.editor_key AS editor_key,
  p.editor_null AS editor_null
FROM page p
LEFT JOIN users uu ON uu.id = p.uploader_id
LEFT JOIN agents ag ON ag.id = p.uploader_id AND ag.organization_id = sqlc.arg(organization_id)::text
ORDER BY p.sort_at DESC, p.id COLLATE "C" DESC;

-- name: ListDocumentSourceMeetingFiles :many
-- Meetings' read gate for a member (MeetingService.authorize): any member of
-- the meeting's workspace. Branch 1 lists complete recordings whose bytes are
-- a ready FileService file; legacy egress rows (file_id NULL) are not servable
-- by the meeting domain either. Branch 2 (UNI-2288) lists live meeting minutes
-- pages (liveMinutesPage in service/meeting_minutes.go:93-105) when
-- include_pages is true and row_id is NULL (lookup() for Open/Save/ViewSource
-- passes row_id and include_pages=false so minutes rows stay 404 there),
-- gated by the same permission + content-readable predicate as ListDocumentsPage
-- (queries/document_search.sql:40-61,137-164) fed by DocumentService.documentListScope
-- (service/document_search.go:399-470).
-- Supported by idx_meeting_recordings_org_complete and idx_meetings_ws_start.
WITH base AS (
  SELECT
    rec.id AS id,
    ('meeting:' || rec.id)::text AS source_id,
    'file'::text AS kind,
    ''::text AS document_id,
    COALESCE(rec.ended_at, rec.started_at) AS sort_at,
    mt.id::text AS parent_id,
    mt.title::text AS parent_title,
    f.original_filename AS name,
    COALESCE(f.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, 0)::bigint AS size_bytes,
    rec.started_by::text AS owner_id,
    'member'::text AS owner_kind,
    (f.original_filename COLLATE "vi-x-icu")::text AS name_key,
    COALESCE(eu.display_name COLLATE "vi-x-icu", '')::text AS editor_key,
    (NULLIF(btrim(eu.display_name), '') IS NULL)::boolean AS editor_null
  FROM meeting_recordings rec
  JOIN meetings mt ON mt.id = rec.meeting_id AND mt.organization_id = rec.organization_id
  JOIN files f ON f.id = rec.file_id AND f.status = 'ready'
  LEFT JOIN users eu ON eu.id = rec.started_by
  WHERE NOT sqlc.arg(recordings_disabled)::boolean
    AND rec.organization_id = sqlc.arg(organization_id)::text
    AND mt.organization_id = sqlc.arg(organization_id)::text
    AND mt.workspace_id = sqlc.arg(workspace_id)::text
    AND rec.status = 'COMPLETE'
    AND rec.file_id IS NOT NULL
    AND (sqlc.narg(row_id)::text IS NULL OR rec.id = sqlc.narg(row_id)::text)
    AND (sqlc.narg(parent_id)::text IS NULL OR mt.id = sqlc.narg(parent_id)::text)
  UNION ALL
  SELECT
    ('minutes:' || mt.id)::text AS id,
    ('meeting:minutes:' || mt.id)::text AS source_id,
    'page'::text AS kind,
    doc.id::text AS document_id,
    doc.updated_at AS sort_at,
    mt.id::text AS parent_id,
    mt.title::text AS parent_title,
    mt.title::text AS name,
    ''::text AS mime_type,
    0::bigint AS size_bytes,
    doc.updated_by::text AS owner_id,
    doc.updated_by_kind::text AS owner_kind,
    (mt.title COLLATE "vi-x-icu")::text AS name_key,
    COALESCE(eu.display_name COLLATE "vi-x-icu", '')::text AS editor_key,
    (NULLIF(btrim(eu.display_name), '') IS NULL)::boolean AS editor_null
  FROM meetings mt
  JOIN documents doc
    ON doc.id = mt.minutes_document_id
   AND doc.organization_id = mt.organization_id
   AND doc.workspace_id = mt.workspace_id
  LEFT JOIN users eu ON eu.id = doc.updated_by AND doc.updated_by_kind = 'human'
  WHERE sqlc.narg(row_id)::text IS NULL
    AND sqlc.arg(include_pages)::boolean
    AND mt.organization_id = sqlc.arg(organization_id)::text
    AND mt.workspace_id = sqlc.arg(workspace_id)::text
    AND doc.organization_id = sqlc.arg(organization_id)::text
    AND doc.workspace_id = sqlc.arg(workspace_id)::text
    AND mt.minutes_document_id IS NOT NULL
    AND (sqlc.narg(parent_id)::text IS NULL OR mt.id = sqlc.narg(parent_id)::text)
    AND doc.archived_at IS NULL
    AND doc.kind = 'page'
    AND doc.owner_id IS NULL
    -- Same permission + content-readable predicate as ListDocumentsPage
    -- (server/pkg/db/queries/document_search.sql:40-61,137-164), fed by
    -- DocumentService.documentListScope (server/internal/service/document_search.go:399-470).
    AND ((sqlc.arg(see_all)::boolean
          AND (doc.system_kind IS NULL OR doc.system_kind <> 'my_folder' OR doc.acl_owner_id = sqlc.arg(viewer_id)::text)
          AND (doc.acl_owner_id = sqlc.arg(viewer_id)::text
               OR (doc.visibility = 'workspace' AND doc.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
               OR EXISTS (
                    SELECT 1 FROM document_break_glass_grants g
                    WHERE g.organization_id = doc.organization_id
                      AND g.workspace_id = doc.workspace_id
                      AND g.document_id = doc.id
                      AND g.actor_id = sqlc.arg(viewer_id)::text
                      AND g.actor_kind = 'human'
                      AND g.revoked_at IS NULL
                      AND g.expires_at > now())
               OR NOT EXISTS (
                    SELECT 1 FROM uw_my_folder_foreign_ids(
                      sqlc.arg(viewer_id)::text, sqlc.arg(organization_id)::text, sqlc.arg(workspace_id)::text, sqlc.arg(max_level)::int
                    ) mfs WHERE mfs.document_id = doc.id)))
         OR (sqlc.arg(member_visible)::boolean AND doc.visibility = 'workspace'
             AND doc.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
         OR (sqlc.arg(acl_owner)::boolean AND doc.acl_owner_id = sqlc.arg(viewer_id)::text)
         OR (sqlc.arg(allow_shares)::boolean AND EXISTS (
              SELECT 1 FROM document_shares s
              WHERE s.organization_id = doc.organization_id
                AND s.workspace_id = doc.workspace_id
                AND s.document_id = doc.id
                AND s.revoked_at IS NULL
                AND s.level = ANY(sqlc.arg(share_levels)::text[])
                AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(viewer_id)::text)
                     OR (s.principal_type = 'organization' AND s.principal_id = doc.organization_id)
                     OR (s.principal_type = 'workspace'
                         AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
    AND (NOT sqlc.arg(see_all)::boolean
         OR doc.visibility <> 'restricted'
         OR (doc.acl_owner_id IS NOT NULL AND doc.acl_owner_id = sqlc.arg(viewer_id)::text)
         OR EXISTS (
              SELECT 1 FROM document_shares rs
              WHERE rs.organization_id = doc.organization_id
                AND rs.workspace_id = doc.workspace_id
                AND rs.document_id = doc.id
                AND rs.revoked_at IS NULL
                AND rs.level = ANY(sqlc.arg(share_levels)::text[])
                AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(viewer_id)::text)
                     OR (rs.principal_type = 'organization' AND rs.principal_id = doc.organization_id)
                     OR (rs.principal_type = 'workspace'
                         AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
         OR EXISTS (
              SELECT 1 FROM document_break_glass_grants g
              WHERE g.organization_id = doc.organization_id
                AND g.workspace_id = doc.workspace_id
                AND g.document_id = doc.id
                AND g.actor_id = sqlc.arg(viewer_id)::text
                AND g.actor_kind = 'human'
                AND g.revoked_at IS NULL
                AND g.expires_at > now()))
), page AS (
  SELECT id, source_id, kind, document_id, sort_at, parent_id, parent_title, name, mime_type, size_bytes, owner_id, owner_kind, name_key, editor_key, editor_null
  FROM base
  WHERE -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
    -- requested direction; an editor-less row (editor_null) is always last.
    (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
         WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (sort_at, source_id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (sort_at, source_id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (size_bytes, source_id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (size_bytes, source_id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (name_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (name_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'editor' THEN (editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
              OR (editor_null = sqlc.narg(sort_cursor_null)::boolean
                  AND CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
         ELSE true END)
    AND (sqlc.narg(sort_key)::text IS DISTINCT FROM 'updated' OR sqlc.narg(sort_cursor_id)::text IS NULL
         OR CASE WHEN sqlc.arg(sort_desc)::boolean THEN sort_at <= sqlc.narg(sort_cursor_at)::timestamptz
                 ELSE sort_at >= sqlc.narg(sort_cursor_at)::timestamptz END)
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (sort_at <= sqlc.narg(cursor_at)::timestamptz
        AND (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C")))
    AND (sqlc.narg(q)::text IS NULL OR uw_fold_search(name) LIKE '%' || sqlc.narg(q)::text || '%')
    AND CASE
      WHEN kind = 'page' THEN sqlc.arg(include_pages)::boolean
      WHEN sqlc.arg(type_mode)::text = 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
      WHEN sqlc.arg(type_mode)::text = 'image' THEN mime_type LIKE 'image/%'
      WHEN sqlc.arg(type_mode)::text = 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
        AND mime_type NOT LIKE 'image/%'
      ELSE true
    END
  -- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
  -- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
  -- bound parameter, so the planner folds the unused ones away and a plain
  -- (key, id) order remains.
  ORDER BY
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN id COLLATE "C" END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN editor_null END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN name_key
          WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN size_bytes END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN size_bytes END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN sort_at END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN sort_at END) DESC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) ASC,
    (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) DESC
  LIMIT sqlc.arg(row_limit)::int
)
SELECT
  p.source_id::text AS source_id,
  p.id::text AS row_id,
  p.kind::text AS kind,
  p.document_id::text AS document_id,
  p.sort_at AS sort_at,
  'meeting'::text AS parent_kind,
  p.parent_id AS parent_id,
  p.parent_title AS parent_title,
  ''::text AS parent_ref,
  p.name::text AS name,
  p.mime_type AS mime_type,
  p.size_bytes AS size_bytes,
  p.owner_id::text AS owner_id,
  p.owner_kind::text AS owner_kind,
  COALESCE(su.display_name, ag.name, '')::text AS owner_name,
  p.name_key AS name_key,
  p.editor_key AS editor_key,
  p.editor_null AS editor_null
FROM page p
LEFT JOIN users su ON su.id = p.owner_id
LEFT JOIN agents ag ON ag.id = p.owner_id AND ag.organization_id = sqlc.arg(organization_id)::text
ORDER BY p.sort_at DESC, p.id COLLATE "C" DESC;

-- name: ListDocumentSourceEmailFiles :many
-- Email Hub's read gate (EmailHubService.OpenAttachment): a mailbox is its
-- owner's alone - the viewer's own connected accounts in this organization.
-- Attachments of mail sent from UniWork ("sent:" parts) have no IMAP part to
-- fetch, so they are left out, and so are parts without a file name (nothing
-- to show or to save under). The same message synced into two folders is one
-- row per folder; only the row with the smallest id is listed (rows without a
-- Message-ID never collapse). The date is the message's: attachments carry no
-- date of their own, their created_at is the sync time. parent_ref carries the
-- account id the domain's open path needs.
WITH base AS (
  SELECT
    ea.id AS id,
    ('email:' || ea.id)::text AS source_id,
    COALESCE(th.sent_at, ea.created_at) AS sort_at,
    th.id::text AS parent_id,
    th.subject::text AS parent_title,
    acc.id::text AS parent_ref,
    ea.filename::text AS name,
    ea.mime_type::text AS mime_type,
    ea.size_bytes::bigint AS size_bytes,
    (ea.filename COLLATE "vi-x-icu")::text AS name_key,
    ''::text AS editor_key,
    true AS editor_null
  FROM email_hub_attachments ea
  JOIN email_hub_threads th ON th.id = ea.thread_id
    AND th.account_id = ea.account_id AND th.organization_id = ea.organization_id
  JOIN email_hub_accounts acc ON acc.id = ea.account_id AND acc.organization_id = ea.organization_id
  WHERE ea.organization_id = sqlc.arg(organization_id)::text
    AND acc.user_id = sqlc.arg(viewer_id)::text
    AND acc.disconnected_at IS NULL
    AND ea.part_id NOT LIKE 'sent:%'
    AND btrim(ea.filename) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM email_hub_threads th2
      JOIN email_hub_attachments ea2 ON ea2.thread_id = th2.id AND ea2.account_id = th2.account_id
      WHERE th2.account_id = th.account_id
        AND th2.organization_id = th.organization_id
        AND th2.sent_at = th.sent_at
        AND th2.message_id = th.message_id
        AND th2.id <> th.id
        AND ea2.part_id = ea.part_id
        AND btrim(ea2.filename) <> ''
        AND ea2.id < ea.id)
    AND (sqlc.narg(row_id)::text IS NULL OR ea.id = sqlc.narg(row_id)::text)
    AND (sqlc.narg(parent_id)::text IS NULL OR th.id = sqlc.narg(parent_id)::text)
)
SELECT
  source_id::text AS source_id,
  id::text AS row_id,
  sort_at AS sort_at,
  'email_thread'::text AS parent_kind,
  parent_id AS parent_id,
  parent_title AS parent_title,
  parent_ref AS parent_ref,
  name AS name,
  mime_type AS mime_type,
  size_bytes AS size_bytes,
  ''::text AS owner_id,
  ''::text AS owner_kind,
  ''::text AS owner_name,
  name_key AS name_key,
  editor_key AS editor_key,
  editor_null::boolean AS editor_null
FROM base
WHERE -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
    -- requested direction; an editor-less row (editor_null) is always last.
    (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
         WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (sort_at, source_id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (sort_at, source_id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (size_bytes, source_id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (size_bytes, source_id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (name_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (name_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
         WHEN 'editor' THEN (editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
              OR (editor_null = sqlc.narg(sort_cursor_null)::boolean
                  AND CASE WHEN sqlc.arg(sort_desc)::boolean
              THEN (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
              ELSE (editor_key COLLATE "vi-x-icu", source_id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
         ELSE true END)
    AND (sqlc.narg(sort_key)::text IS DISTINCT FROM 'updated' OR sqlc.narg(sort_cursor_id)::text IS NULL
         OR CASE WHEN sqlc.arg(sort_desc)::boolean THEN sort_at <= sqlc.narg(sort_cursor_at)::timestamptz
                 ELSE sort_at >= sqlc.narg(sort_cursor_at)::timestamptz END)
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
    OR (sort_at <= sqlc.narg(cursor_at)::timestamptz
      AND (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C")))
  AND (sqlc.narg(q)::text IS NULL OR uw_fold_search(name) LIKE '%' || sqlc.narg(q)::text || '%')
  AND CASE sqlc.arg(type_mode)::text
    WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
    WHEN 'image' THEN mime_type LIKE 'image/%'
    WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
      AND mime_type NOT LIKE 'image/%'
    ELSE true
  END
-- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
-- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
-- bound parameter, so the planner folds the unused ones away and a plain
-- (key, id) order remains.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN sort_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN id COLLATE "C" END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN size_bytes END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN size_bytes END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN sort_at END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN sort_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN id COLLATE "C" END) DESC
LIMIT sqlc.arg(row_limit)::int;

-- UNI-2038 S3: the dense rank of a list of sort keys under the collation the
-- sorted lists order by, so the four source pages can be merged in Go without
-- Go knowing the Vietnamese collation. Touches no table.
-- name: RankDocumentSortKeys :many
SELECT k.ord::int AS ord,
       (dense_rank() OVER (ORDER BY k.t COLLATE "vi-x-icu"))::int AS rank
FROM unnest(sqlc.arg(keys)::text[]) WITH ORDINALITY AS k(t, ord);
