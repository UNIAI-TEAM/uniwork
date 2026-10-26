-- Platform admin (F-11). Only service/admin.go calls these (arch test
-- name: AdminListDemoRequests :many
SELECT * FROM demo_requests
WHERE (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status')::text)
ORDER BY created_at DESC, id DESC LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminCountDemoRequests :one
SELECT count(*) FROM demo_requests
WHERE (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status')::text);

-- name: AdminGetDemoRequest :one
SELECT * FROM demo_requests WHERE id = $1 FOR UPDATE;

-- name: AdminUpdateDemoRequest :one
UPDATE demo_requests SET status = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- TestAdminQueriesStayInAdminService). Metadata only: no task body, no
-- message, no file ever leaves through here.

-- name: AdminListOrganizations :many
-- tenant: platform
-- total_count is the window count over the filtered set, so the console can
-- paginate without a second round trip. Sorting is decided here, never in the
-- browser: a client-side sort would only order the page it happens to hold.
SELECT t.id, t.slug, t.name, t.status, t.created_at, t.plan_code,
  t.member_count, t.workspace_count, t.last_activity_at, t.total_count
FROM (
  SELECT o.id, o.slug, o.name, o.status, o.created_at,
    COALESCE(p.code, '')::text AS plan_code,
    (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id)::bigint AS member_count,
    (SELECT count(*) FROM workspaces w WHERE w.organization_id = o.id)::bigint AS workspace_count,
    (SELECT max(a.occurred_at) FROM audit_events a WHERE a.organization_id = o.id)::timestamptz AS last_activity_at,
    count(*) OVER ()::bigint AS total_count
  FROM organizations o
  LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status <> 'canceled'
  LEFT JOIN plans p ON p.id = s.plan_id
  WHERE (sqlc.narg('status')::text IS NULL OR o.status = sqlc.narg('status')::text)
    AND (sqlc.narg('q')::text IS NULL OR o.name ILIKE '%' || sqlc.narg('q')::text || '%' OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%')
) t
ORDER BY
  CASE WHEN sqlc.arg('sort')::text = 'activity_asc' THEN t.last_activity_at END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort')::text = 'activity_desc' THEN t.last_activity_at END DESC NULLS LAST,
  t.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminCountOrganizations :one
-- Only for a page that came back empty: the window count above has no row to
-- ride on there, and "page 3 of 0" is worse than one extra query.
SELECT count(*)::bigint FROM organizations o
WHERE (sqlc.narg('status')::text IS NULL OR o.status = sqlc.narg('status')::text)
  AND (sqlc.narg('q')::text IS NULL OR o.name ILIKE '%' || sqlc.narg('q')::text || '%' OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%');

-- name: AdminGetOrganization :one
-- tenant: platform
SELECT o.id, o.slug, o.name, o.status, o.suspended_at, o.suspended_reason, o.deletion_scheduled_at, o.created_at,
  COALESCE(p.code, '')::text AS plan_code,
  (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id)::bigint AS member_count,
  (SELECT count(*) FROM workspaces w WHERE w.organization_id = o.id)::bigint AS workspace_count,
  (SELECT max(a.occurred_at) FROM audit_events a WHERE a.organization_id = o.id)::timestamptz AS last_activity_at
FROM organizations o
LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status <> 'canceled'
LEFT JOIN plans p ON p.id = s.plan_id
WHERE o.id = $1;

-- name: AdminSetOrganizationStatus :one
-- Suspend and unsuspend only: an archived organization (closed or deleted)
-- stays archived, so no row comes back when it moved there under the caller.
UPDATE organizations SET status = $2, suspended_at = $3, suspended_reason = $4, updated_at = now()
WHERE id = $1 AND status IN ('active', 'suspended')
RETURNING *;

-- name: InsertAdminAction :exec
INSERT INTO admin_actions (id, actor_id, action, target_type, target_id, before, after, reason, trace_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListAdminActionsByTarget :many
SELECT * FROM admin_actions WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT $3;

-- name: ListAdminActionsByTrace :many
SELECT * FROM admin_actions WHERE trace_id = $1 ORDER BY created_at ASC LIMIT 500;

-- name: AdminListAuditEventsByCorrelation :many
-- tenant: platform
SELECT id, organization_id, workspace_id, actor_kind, actor_id, action, resource_type, resource_id, request_id, occurred_at
FROM audit_events WHERE correlation_id = $1 ORDER BY occurred_at ASC LIMIT 500;

-- name: AdminListOutboxEventsByCorrelation :many
-- tenant: platform
SELECT id, organization_id, workspace_id, topic, status, attempts, last_error, created_at, done_at, dead_at
FROM outbox_events WHERE correlation_id = $1 ORDER BY created_at ASC LIMIT 500;

-- name: AdminOutboxSummary :one
-- tenant: platform
SELECT count(*) FILTER (WHERE status = 'PENDING')::bigint AS pending,
  count(*) FILTER (WHERE dead_at IS NOT NULL)::bigint AS dead,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'PENDING'))), 0)::float8 AS oldest_pending_age_seconds
FROM outbox_events;

-- name: SetUserPlatformRole :one
UPDATE users SET platform_role = $2, platform_role_granted_by = $3, platform_role_granted_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
WHERE id = $1
RETURNING *;

-- name: ListPlatformRoleUsers :many
SELECT id, email, platform_role, platform_role_granted_by, platform_role_granted_at FROM users
WHERE platform_role IS NOT NULL ORDER BY platform_role_granted_at DESC;

-- name: AdminListInvoices :many
-- tenant: platform
SELECT t.id, t.organization_id, t.subscription_id, t.provider, t.provider_invoice_id, t.number,
  t.status, t.amount_due, t.amount_paid, t.currency, t.period_start, t.period_end, t.hosted_url,
  t.issued_at, t.paid_at, t.created_at, t.updated_at, t.org_slug, t.org_name,
  t.user_id, t.user_display_name, t.user_email, t.plan_code, t.plan_name,
  t.refund_requested_at, t.refunded_at, t.refund_provider_ref, t.amount_refunded, t.partial_refund_amount,
  t.refund_reason, t.refund_confirm_reason,
  t.provider_bank_code, t.provider_transaction_no, t.provider_txn_ref, t.payment_intent_id, t.total_count
FROM (
  SELECT i.id, i.organization_id, i.subscription_id, i.provider, i.provider_invoice_id, i.number,
    i.status, i.amount_due, i.amount_paid, i.currency, i.period_start, i.period_end, i.hosted_url,
    i.issued_at, i.paid_at, i.created_at, i.updated_at,
    i.refund_requested_at, i.refunded_at, i.refund_provider_ref, i.amount_refunded, i.partial_refund_amount,
    i.refund_reason, i.refund_confirm_reason, i.payment_intent_id,
    o.slug AS org_slug, o.name AS org_name,
    pl.code AS plan_code, pl.name AS plan_name,
    COALESCE(init_u.id, owner_u.id, '')::text AS user_id,
    COALESCE(init_u.display_name, owner_u.display_name, '')::text AS user_display_name,
    COALESCE(init_u.email, owner_u.email, '')::text AS user_email,
    COALESCE(pi_link.provider_bank_code, pi_match.provider_bank_code) AS provider_bank_code,
    COALESCE(pi_link.provider_transaction_no, pi_match.provider_transaction_no) AS provider_transaction_no,
    COALESCE(pi_link.provider_txn_ref, pi_match.provider_txn_ref, '')::text AS provider_txn_ref,
    count(*) OVER ()::bigint AS total_count
  FROM invoices i
  JOIN organizations o ON o.id = i.organization_id
  LEFT JOIN subscriptions sub ON sub.id = i.subscription_id
  LEFT JOIN billing_payment_intents pi_link ON pi_link.id = i.payment_intent_id
  LEFT JOIN plans pl ON pl.id = COALESCE(pi_link.plan_id, sub.plan_id)
  LEFT JOIN users init_u ON init_u.id = i.initiated_by
  LEFT JOIN organization_members owner_m ON owner_m.organization_id = i.organization_id AND owner_m.role = 'owner'
  LEFT JOIN users owner_u ON owner_u.id = owner_m.user_id
  LEFT JOIN LATERAL (
    SELECT pi.provider_bank_code, pi.provider_transaction_no, pi.provider_txn_ref
    FROM billing_payment_intents pi
    WHERE i.payment_intent_id IS NULL
      AND pi.organization_id = i.organization_id AND pi.provider = i.provider
      AND pi.status = 'completed' AND pi.amount = i.amount_paid
    ORDER BY COALESCE(pi.completed_at, pi.created_at) DESC
    LIMIT 1
  ) pi_match ON i.payment_intent_id IS NULL
  WHERE (sqlc.narg('provider')::text IS NULL OR i.provider = sqlc.narg('provider')::text)
    AND (sqlc.narg('status')::text IS NULL OR i.status = sqlc.narg('status')::text)
    AND (sqlc.narg('q')::text IS NULL OR i.number ILIKE '%' || sqlc.narg('q')::text || '%'
      OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%' OR o.name ILIKE '%' || sqlc.narg('q')::text || '%'
      OR init_u.email ILIKE '%' || sqlc.narg('q')::text || '%' OR init_u.display_name ILIKE '%' || sqlc.narg('q')::text || '%')
    AND (sqlc.narg('date_from')::timestamptz IS NULL OR COALESCE(i.refund_requested_at, i.refunded_at, i.paid_at, i.created_at) >= sqlc.narg('date_from')::timestamptz)
    AND (sqlc.narg('date_to')::timestamptz IS NULL OR COALESCE(i.refund_requested_at, i.refunded_at, i.paid_at, i.created_at) < sqlc.narg('date_to')::timestamptz)
) t
ORDER BY COALESCE(t.paid_at, t.created_at) DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminCountInvoices :one
-- tenant: platform
SELECT count(*)::bigint FROM invoices i
JOIN organizations o ON o.id = i.organization_id
LEFT JOIN users init_u ON init_u.id = i.initiated_by
WHERE (sqlc.narg('provider')::text IS NULL OR i.provider = sqlc.narg('provider')::text)
  AND (sqlc.narg('status')::text IS NULL OR i.status = sqlc.narg('status')::text)
  AND (sqlc.narg('q')::text IS NULL OR i.number ILIKE '%' || sqlc.narg('q')::text || '%'
    OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%' OR o.name ILIKE '%' || sqlc.narg('q')::text || '%'
    OR init_u.email ILIKE '%' || sqlc.narg('q')::text || '%' OR init_u.display_name ILIKE '%' || sqlc.narg('q')::text || '%')
  AND (sqlc.narg('date_from')::timestamptz IS NULL OR COALESCE(i.refund_requested_at, i.refunded_at, i.paid_at, i.created_at) >= sqlc.narg('date_from')::timestamptz)
  AND (sqlc.narg('date_to')::timestamptz IS NULL OR COALESCE(i.refund_requested_at, i.refunded_at, i.paid_at, i.created_at) < sqlc.narg('date_to')::timestamptz);

-- name: AdminListPaymentIntents :many
-- tenant: platform
SELECT t.id, t.organization_id, t.subscription_id, t.plan_id, t.provider, t.provider_txn_ref,
  t.amount, t.currency, t.status, t.expires_at, t.completed_at, t.created_at, t.updated_at,
  t.provider_bank_code, t.provider_transaction_no,
  t.org_slug, t.org_name, t.plan_code, t.user_id, t.user_display_name, t.user_email, t.total_count
FROM (
  SELECT pi.id, pi.organization_id, pi.subscription_id, pi.plan_id, pi.provider, pi.provider_txn_ref,
    pi.amount, pi.currency, pi.status, pi.expires_at, pi.completed_at, pi.created_at, pi.updated_at,
    pi.provider_bank_code, pi.provider_transaction_no,
    o.slug AS org_slug, o.name AS org_name, p.code AS plan_code,
    COALESCE(pay_u.id, owner_u.id, '')::text AS user_id,
    COALESCE(pay_u.display_name, owner_u.display_name, '')::text AS user_display_name,
    COALESCE(pay_u.email, owner_u.email, '')::text AS user_email,
    count(*) OVER ()::bigint AS total_count
  FROM billing_payment_intents pi
  JOIN organizations o ON o.id = pi.organization_id
  JOIN plans p ON p.id = pi.plan_id
  LEFT JOIN users pay_u ON pay_u.id = pi.created_by
  LEFT JOIN organization_members owner_m ON owner_m.organization_id = pi.organization_id AND owner_m.role = 'owner'
  LEFT JOIN users owner_u ON owner_u.id = owner_m.user_id
  WHERE (sqlc.narg('provider')::text IS NULL OR pi.provider = sqlc.narg('provider')::text)
    AND (sqlc.narg('status')::text IS NULL OR pi.status = sqlc.narg('status')::text)
    AND (sqlc.narg('q')::text IS NULL OR pi.id = sqlc.narg('q')::text
      OR pi.provider_txn_ref ILIKE '%' || sqlc.narg('q')::text || '%'
      OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%' OR o.name ILIKE '%' || sqlc.narg('q')::text || '%'
      OR pay_u.email ILIKE '%' || sqlc.narg('q')::text || '%' OR pay_u.display_name ILIKE '%' || sqlc.narg('q')::text || '%')
    AND (sqlc.narg('date_from')::timestamptz IS NULL OR pi.created_at >= sqlc.narg('date_from')::timestamptz)
    AND (sqlc.narg('date_to')::timestamptz IS NULL OR pi.created_at < sqlc.narg('date_to')::timestamptz)
) t
ORDER BY t.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminCountPaymentIntents :one
-- tenant: platform
SELECT count(*)::bigint FROM billing_payment_intents pi
JOIN organizations o ON o.id = pi.organization_id
LEFT JOIN users pay_u ON pay_u.id = pi.created_by
WHERE (sqlc.narg('provider')::text IS NULL OR pi.provider = sqlc.narg('provider')::text)
  AND (sqlc.narg('status')::text IS NULL OR pi.status = sqlc.narg('status')::text)
  AND (sqlc.narg('q')::text IS NULL OR pi.id = sqlc.narg('q')::text
    OR pi.provider_txn_ref ILIKE '%' || sqlc.narg('q')::text || '%'
    OR o.slug ILIKE '%' || sqlc.narg('q')::text || '%' OR o.name ILIKE '%' || sqlc.narg('q')::text || '%'
    OR pay_u.email ILIKE '%' || sqlc.narg('q')::text || '%' OR pay_u.display_name ILIKE '%' || sqlc.narg('q')::text || '%')
  AND (sqlc.narg('date_from')::timestamptz IS NULL OR pi.created_at >= sqlc.narg('date_from')::timestamptz)
  AND (sqlc.narg('date_to')::timestamptz IS NULL OR pi.created_at < sqlc.narg('date_to')::timestamptz);

-- name: AdminGetInvoiceByID :one
-- tenant: platform
SELECT i.*, o.slug AS org_slug, o.name AS org_name,
  pl.code AS plan_code, pl.name AS plan_name,
  COALESCE(pi_link.provider_bank_code, pi_match.provider_bank_code) AS provider_bank_code,
  COALESCE(pi_link.provider_transaction_no, pi_match.provider_transaction_no) AS provider_transaction_no,
  COALESCE(pi_link.provider_txn_ref, pi_match.provider_txn_ref, '')::text AS provider_txn_ref
FROM invoices i
JOIN organizations o ON o.id = i.organization_id
LEFT JOIN subscriptions sub ON sub.id = i.subscription_id
LEFT JOIN billing_payment_intents pi_link ON pi_link.id = i.payment_intent_id
LEFT JOIN plans pl ON pl.id = COALESCE(pi_link.plan_id, sub.plan_id)
LEFT JOIN LATERAL (
  SELECT pi.provider_bank_code, pi.provider_transaction_no, pi.provider_txn_ref
  FROM billing_payment_intents pi
  WHERE i.payment_intent_id IS NULL
    AND pi.organization_id = i.organization_id AND pi.provider = i.provider
    AND pi.status = 'completed' AND pi.amount = i.amount_paid
  ORDER BY COALESCE(pi.completed_at, pi.created_at) DESC
  LIMIT 1
) pi_match ON i.payment_intent_id IS NULL
WHERE i.id = $1;

-- name: AdminMarkInvoiceRefunded :one
-- tenant: platform
UPDATE invoices SET
  status = 'refunded',
  refunded_at = now(),
  refund_provider_ref = sqlc.narg('refund_provider_ref'),
  refund_reason = sqlc.arg('refund_reason'),
  amount_refunded = amount_paid,
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'paid'
RETURNING *;

-- name: AdminRequestInvoiceRefund :one
-- tenant: platform
UPDATE invoices SET
  status = 'refund_pending',
  refund_requested_at = now(),
  refund_provider_ref = sqlc.narg('refund_provider_ref'),
  refund_reason = sqlc.arg('refund_reason'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'paid'
RETURNING *;

-- name: AdminRequestPartialInvoiceRefund :one
-- tenant: platform
UPDATE invoices SET
  status = 'partial_refund_pending',
  refund_requested_at = now(),
  partial_refund_amount = sqlc.arg('partial_refund_amount'),
  refund_provider_ref = sqlc.narg('refund_provider_ref'),
  refund_reason = sqlc.arg('refund_reason'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'paid'
RETURNING *;

-- name: AdminRevertInvoiceRefundRequest :one
-- tenant: platform
UPDATE invoices SET
  status = 'paid',
  refund_requested_at = NULL,
  partial_refund_amount = NULL,
  refund_provider_ref = NULL,
  refund_reason = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('refund_pending', 'partial_refund_pending')
RETURNING *;

-- name: AdminPatchInvoiceRefundProviderRef :one
-- tenant: platform
UPDATE invoices SET
  refund_provider_ref = sqlc.narg('refund_provider_ref'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('refund_pending', 'partial_refund_pending')
RETURNING *;

-- The operator's queue of chat reports (store UGC policy, Apple 1.2: the operator acts on every report within 24
-- hours). Ids, the reason, the status and when: the reporter's own words (details) and the reported message never
-- leave through here, as nothing of content does from this file.

-- name: AdminListChatReports :many
-- tenant: platform
SELECT r.id, r.organization_id, o.slug AS organization_slug, o.name AS organization_name, o.status AS organization_status,
  r.workspace_id, r.room_id, r.message_id, r.target_user_id, r.reason, r.status, r.created_by, r.created_at,
  count(*) OVER ()::bigint AS total_count
FROM chat_reports r
JOIN organizations o ON o.id = r.organization_id
WHERE (sqlc.narg('status')::text IS NULL OR r.status = sqlc.narg('status')::text)
ORDER BY r.created_at DESC, r.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: AdminChatReportQueue :one
-- tenant: platform
-- How many reports wait and since when: the console's banner and the 24-hour promise.
SELECT count(*)::bigint AS open_count, min(created_at)::timestamptz AS oldest_open_at
FROM chat_reports WHERE status = 'open';

-- name: AdminGetChatReportForUpdate :one
-- tenant: platform
-- room_id and message_id name what a takedown removes (AdminService.RemoveReportedMessage); never the content.
SELECT id, organization_id, workspace_id, room_id, message_id, status FROM chat_reports WHERE id = $1 FOR UPDATE;

-- name: AdminResolveChatReport :one
-- tenant: platform
UPDATE chat_reports SET status = 'resolved' WHERE id = $1 AND status = 'open'
RETURNING id, organization_id, workspace_id, status;
