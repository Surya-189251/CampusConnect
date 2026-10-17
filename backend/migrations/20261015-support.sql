BEGIN;
CREATE TABLE IF NOT EXISTS support_tickets (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 college_id INTEGER NOT NULL REFERENCES colleges(id), reporter_id INTEGER NOT NULL REFERENCES users(id),
 title VARCHAR(160) NOT NULL, description TEXT NOT NULL CHECK(LENGTH(description) BETWEEN 1 AND 5000),
 category VARCHAR(20) NOT NULL CHECK(category IN ('attendance','marks','fees','account','facilities','other')),
 status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
 priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
 request_key UUID NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(reporter_id,request_key)
);
CREATE INDEX IF NOT EXISTS support_college_index ON support_tickets(college_id,status,id DESC);
CREATE INDEX IF NOT EXISTS support_reporter_index ON support_tickets(reporter_id,id DESC);
CREATE TABLE IF NOT EXISTS support_messages (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES support_tickets(id),
 author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL CHECK(LENGTH(body) BETWEEN 1 AND 3000),
 status_after VARCHAR(20) NOT NULL CHECK(status_after IN ('open','in_progress','resolved','closed')),
 request_key UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(author_id,request_key)
);
CREATE TABLE IF NOT EXISTS ai_usage_daily (
 scope VARCHAR(10) NOT NULL CHECK(scope IN ('global','college','user')), scope_id INTEGER NOT NULL,
 day DATE NOT NULL, requests INTEGER NOT NULL DEFAULT 0 CHECK(requests>=0), PRIMARY KEY(scope,scope_id,day)
);
COMMIT;
