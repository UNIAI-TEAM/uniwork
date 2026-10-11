-- Source reads for the Work Graph projector and rebuild (C-11 §5.3). Every
-- query is scoped by the organization the projection runs for.

-- name: GraphSourceTask :one
SELECT * FROM tasks WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceTaskDependencies :many
-- related is not projected: the vocabulary has no RELATED_TO.
SELECT * FROM task_dependencies
WHERE organization_id = sqlc.arg(organization_id)
  AND (task_id = sqlc.arg(task_id)::text OR depends_on_task_id = sqlc.arg(task_id)::text)
  AND type IN ('blocks', 'blocked_by');

-- name: GraphSourceTaskThreadRooms :many
SELECT DISTINCT room_id FROM chat_thread_task_links
WHERE organization_id = sqlc.arg(organization_id) AND task_id = sqlc.arg(task_id)
ORDER BY room_id;

-- name: GraphSourceChatMessageRoom :one
-- Ignores deleted_at on purpose: a task's origin outlives its message.
SELECT room_id FROM chat_messages WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMeeting :one
SELECT * FROM meetings WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMeetingParticipants :many
SELECT DISTINCT user_id::text AS user_id FROM meeting_participants
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id)
  AND status = 'ACTIVE' AND user_id IS NOT NULL
ORDER BY 1;

-- name: GraphSourceProject :one
SELECT * FROM projects WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMember :one
-- A projection read, not a membership decision (that stays in RequireMember).
SELECT m.user_id, m.deactivated_at, m.created_at, u.display_name, p.department_id
FROM organization_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN organization_member_profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
WHERE m.organization_id = sqlc.arg(organization_id) AND m.user_id = sqlc.arg(user_id);

-- name: GraphSourceAgent :one
SELECT * FROM agents WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceDepartment :one
SELECT * FROM departments WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceChatRoom :one
SELECT * FROM chat_rooms WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceChatRoomMembers :many
SELECT DISTINCT user_id FROM chat_room_members
WHERE organization_id = sqlc.arg(organization_id) AND room_id = sqlc.arg(room_id)
  AND status = 'active' AND left_at IS NULL
ORDER BY user_id;

-- name: GraphRebuildTaskIDs :many
SELECT id FROM tasks WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildMeetingIDs :many
SELECT id FROM meetings WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildProjectIDs :many
SELECT id FROM projects WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildMemberIDs :many
SELECT user_id FROM organization_members WHERE organization_id = sqlc.arg(organization_id) AND user_id > sqlc.arg(after_id)::text
ORDER BY user_id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildAgentIDs :many
SELECT id FROM agents WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildDepartmentIDs :many
SELECT id FROM departments WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildChatRoomIDs :many
SELECT id FROM chat_rooms WHERE organization_id = sqlc.arg(organization_id) AND kind <> 'dm' AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;
