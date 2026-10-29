-- When the person behind a device session last proved a credential (ADR
-- 0049): the app's own sign-in, or the start of the browser session that
-- approved its consent, which the attempt carries from the approval to the
-- code exchange. A sign-in ticket links only into a session that signed in
-- after the ticket was issued, and a consent turns any live browser token
-- into a fresh device row, so the row's created_at cannot say it. Rows from
-- before stay NULL: never a sign-in younger than a ticket.
ALTER TABLE device_sessions ADD COLUMN signed_in_at TIMESTAMPTZ;
ALTER TABLE desktop_auth_attempts ADD COLUMN approver_signed_in_at TIMESTAMPTZ;
