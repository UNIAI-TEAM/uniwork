-- Public intake is above every organization: a prospective team has no tenant yet.
-- name: CreateDemoRequest :one
INSERT INTO demo_requests (id, request_key, full_name, work_email, company_name, team_size, message, locale)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (request_key) DO NOTHING
RETURNING id;

-- name: GetDemoRequestReceipt :one
SELECT id FROM demo_requests WHERE request_key = $1;
