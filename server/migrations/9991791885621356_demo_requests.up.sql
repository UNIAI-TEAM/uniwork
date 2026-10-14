CREATE TABLE demo_requests (
 id TEXT PRIMARY KEY,
 request_key TEXT NOT NULL,
 full_name TEXT NOT NULL,
 work_email TEXT NOT NULL,
 company_name TEXT NOT NULL,
 team_size TEXT NOT NULL CHECK (team_size IN ('1-10', '11-50', '51-200', '201-1000', '1000+')),
 message TEXT NOT NULL DEFAULT '',
 locale TEXT NOT NULL CHECK (locale IN ('en', 'vi')),
 status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
