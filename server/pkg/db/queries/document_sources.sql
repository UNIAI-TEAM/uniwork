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
--   q                    name contains (LIKE pattern, already escaped by Go)
--   type_mode            '' all | 'ext' extension in type_exts | 'image' |
--                        'other' neither a known extension nor an image
--   row_id               one row by its own id (download/save lookup)

-- name: ListDocumentSourceChatFiles :many
-- Chat's read gate (ChatService.authorizeRoomAccess): a public channel of this
-- workspace is open to every workspace member; any other room needs an
-- active or invited member row; a DM also needs the viewer in its member set.
-- Workspace rooms and channels must belong to this workspace, DMs and groups
-- to its organization. Archived rooms, deleted messages and legacy rows whose
-- bytes never moved to FileService (file_id NULL) are left out.
WITH src AS (
  SELECT
    ('chat:' || m.id)::text AS source_id,
    m.id AS row_id,
    m.created_at AS sort_at,
    r.kind::text AS parent_kind,
    r.id AS parent_id,
    COALESCE(NULLIF(r.name, ''), peer.display_name, '')::text AS parent_title,
    ''::text AS parent_ref,
    f.original_filename AS name,
    COALESCE(f.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, 0)::bigint AS size_bytes,
    m.sender_id::text AS owner_id,
    m.sender_kind::text AS owner_kind,
    COALESCE(su.display_name, ag.name, '')::text AS owner_name
  FROM chat_messages m
  JOIN chat_rooms r ON r.id = m.room_id AND r.organization_id = m.organization_id
  JOIN files f ON f.id = m.file_id AND f.status = 'ready'
  LEFT JOIN users su ON su.id = m.sender_id
  LEFT JOIN agents ag ON ag.id = m.sender_id AND ag.organization_id = m.organization_id
  LEFT JOIN LATERAL (
    SELECT u.display_name
    FROM chat_room_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.room_id = r.id AND pm.user_id <> sqlc.arg(viewer_id)::text
    ORDER BY pm.created_at, pm.id
    LIMIT 1
  ) peer ON r.kind = 'dm'
  WHERE m.organization_id = sqlc.arg(organization_id)::text
    AND m.kind = 'file'
    AND m.deleted_at IS NULL
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
)
SELECT source_id, row_id, sort_at, parent_kind, parent_id, parent_title, parent_ref,
  name, mime_type, size_bytes, owner_id, owner_kind, owner_name
FROM src
WHERE (sqlc.narg(cursor_at)::timestamptz IS NULL
    OR (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C"))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q)::text || '%')
  AND CASE sqlc.arg(type_mode)::text
    WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
    WHEN 'image' THEN mime_type LIKE 'image/%'
    WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
      AND mime_type NOT LIKE 'image/%'
    ELSE true
  END
ORDER BY sort_at DESC, source_id COLLATE "C" DESC
LIMIT sqlc.arg(row_limit)::int;

-- name: ListDocumentSourceTaskFiles :many
-- Tasks' read gate (TaskService.loadAttachment): any member of the
-- attachment's workspace reads an attachment bound to a task or a comment.
-- Rows still staged (no task, no comment), rows whose task or comment is gone
-- and FileService rows that are not ready are left out. parent_ref carries the
-- task id for a comment attachment, so the client can link to the task.
WITH src AS (
  SELECT
    ('task:' || a.id)::text AS source_id,
    a.id AS row_id,
    a.created_at AS sort_at,
    (CASE WHEN a.comment_id IS NOT NULL THEN 'task_comment' ELSE 'task' END)::text AS parent_kind,
    COALESCE(a.comment_id, t.id)::text AS parent_id,
    t.title::text AS parent_title,
    t.id::text AS parent_ref,
    COALESCE(f.original_filename, a.filename)::text AS name,
    COALESCE(f.content_type, a.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, a.size_bytes, 0)::bigint AS size_bytes,
    a.uploader_id::text AS owner_id,
    a.uploader_type::text AS owner_kind,
    COALESCE(uu.display_name, ag.name, '')::text AS owner_name
  FROM attachments a
  LEFT JOIN task_comments c ON c.id = a.comment_id AND c.organization_id = a.organization_id
  JOIN tasks t ON t.id = COALESCE(a.task_id, c.task_id)
    AND t.organization_id = a.organization_id AND t.workspace_id = a.workspace_id
  LEFT JOIN files f ON f.id = a.file_id
  LEFT JOIN users uu ON uu.id = a.uploader_id
  LEFT JOIN agents ag ON ag.id = a.uploader_id AND ag.organization_id = a.organization_id
  WHERE a.organization_id = sqlc.arg(organization_id)::text
    AND a.workspace_id = sqlc.arg(workspace_id)::text
    AND (a.task_id IS NOT NULL OR a.comment_id IS NOT NULL)
    AND (a.comment_id IS NULL OR c.id IS NOT NULL)
    AND (a.file_id IS NULL OR f.status = 'ready')
    AND (sqlc.narg(row_id)::text IS NULL OR a.id = sqlc.narg(row_id)::text)
)
SELECT source_id, row_id, sort_at, parent_kind, parent_id, parent_title, parent_ref,
  name, mime_type, size_bytes, owner_id, owner_kind, owner_name
FROM src
WHERE (sqlc.narg(cursor_at)::timestamptz IS NULL
    OR (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C"))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q)::text || '%')
  AND CASE sqlc.arg(type_mode)::text
    WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
    WHEN 'image' THEN mime_type LIKE 'image/%'
    WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
      AND mime_type NOT LIKE 'image/%'
    ELSE true
  END
ORDER BY sort_at DESC, source_id COLLATE "C" DESC
LIMIT sqlc.arg(row_limit)::int;

-- name: ListDocumentSourceMeetingFiles :many
-- Meetings' read gate for a member (MeetingService.authorize): any member of
-- the meeting's workspace. Only complete recordings whose bytes are a ready
-- FileService file; legacy egress rows (file_id NULL) are not servable by the
-- meeting domain either. AI summaries/minutes are text rows, not files.
WITH src AS (
  SELECT
    ('meeting:' || rec.id)::text AS source_id,
    rec.id AS row_id,
    COALESCE(rec.ended_at, rec.started_at) AS sort_at,
    'meeting'::text AS parent_kind,
    mt.id::text AS parent_id,
    mt.title::text AS parent_title,
    ''::text AS parent_ref,
    f.original_filename AS name,
    COALESCE(f.content_type, '')::text AS mime_type,
    COALESCE(f.size_bytes, 0)::bigint AS size_bytes,
    rec.started_by::text AS owner_id,
    'member'::text AS owner_kind,
    COALESCE(su.display_name, '')::text AS owner_name
  FROM meeting_recordings rec
  JOIN meetings mt ON mt.id = rec.meeting_id AND mt.organization_id = rec.organization_id
  JOIN files f ON f.id = rec.file_id AND f.status = 'ready'
  LEFT JOIN users su ON su.id = rec.started_by
  WHERE mt.organization_id = sqlc.arg(organization_id)::text
    AND mt.workspace_id = sqlc.arg(workspace_id)::text
    AND rec.status = 'COMPLETE'
    AND (sqlc.narg(row_id)::text IS NULL OR rec.id = sqlc.narg(row_id)::text)
)
SELECT source_id, row_id, sort_at, parent_kind, parent_id, parent_title, parent_ref,
  name, mime_type, size_bytes, owner_id, owner_kind, owner_name
FROM src
WHERE (sqlc.narg(cursor_at)::timestamptz IS NULL
    OR (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C"))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q)::text || '%')
  AND CASE sqlc.arg(type_mode)::text
    WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
    WHEN 'image' THEN mime_type LIKE 'image/%'
    WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
      AND mime_type NOT LIKE 'image/%'
    ELSE true
  END
ORDER BY sort_at DESC, source_id COLLATE "C" DESC
LIMIT sqlc.arg(row_limit)::int;

-- name: ListDocumentSourceEmailFiles :many
-- Email Hub's read gate (EmailHubService.OpenAttachment): a mailbox is its
-- owner's alone - the viewer's own connected accounts in this organization.
-- Attachments of mail sent from UniWork ("sent:" parts) have no IMAP part to
-- fetch, so they are left out. parent_ref carries the account id the domain's
-- open path needs.
WITH src AS (
  SELECT
    ('email:' || ea.id)::text AS source_id,
    ea.id AS row_id,
    COALESCE(th.sent_at, ea.created_at) AS sort_at,
    'email_thread'::text AS parent_kind,
    th.id::text AS parent_id,
    th.subject::text AS parent_title,
    acc.id::text AS parent_ref,
    ea.filename::text AS name,
    ea.mime_type::text AS mime_type,
    ea.size_bytes::bigint AS size_bytes,
    ''::text AS owner_id,
    ''::text AS owner_kind,
    ''::text AS owner_name
  FROM email_hub_attachments ea
  JOIN email_hub_threads th ON th.id = ea.thread_id
    AND th.account_id = ea.account_id AND th.organization_id = ea.organization_id
  JOIN email_hub_accounts acc ON acc.id = ea.account_id AND acc.organization_id = ea.organization_id
  WHERE ea.organization_id = sqlc.arg(organization_id)::text
    AND acc.user_id = sqlc.arg(viewer_id)::text
    AND acc.disconnected_at IS NULL
    AND ea.part_id NOT LIKE 'sent:%'
    AND (sqlc.narg(row_id)::text IS NULL OR ea.id = sqlc.narg(row_id)::text)
)
SELECT source_id, row_id, sort_at, parent_kind, parent_id, parent_title, parent_ref,
  name, mime_type, size_bytes, owner_id, owner_kind, owner_name
FROM src
WHERE (sqlc.narg(cursor_at)::timestamptz IS NULL
    OR (sort_at, source_id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C"))
  AND (sqlc.narg(q)::text IS NULL OR name ILIKE '%' || sqlc.narg(q)::text || '%')
  AND CASE sqlc.arg(type_mode)::text
    WHEN 'ext' THEN lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[])
    WHEN 'image' THEN mime_type LIKE 'image/%'
    WHEN 'other' THEN NOT (lower(COALESCE(substring(name FROM '\.([A-Za-z0-9]+)$'), '')) = ANY(sqlc.arg(type_exts)::text[]))
      AND mime_type NOT LIKE 'image/%'
    ELSE true
  END
ORDER BY sort_at DESC, source_id COLLATE "C" DESC
LIMIT sqlc.arg(row_limit)::int;
