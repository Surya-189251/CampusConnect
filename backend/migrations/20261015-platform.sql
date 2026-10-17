BEGIN;
CREATE TABLE IF NOT EXISTS college_directory (
 code VARCHAR(30) PRIMARY KEY, name VARCHAR(200) NOT NULL, place VARCHAR(120) NOT NULL DEFAULT '',
 district VARCHAR(80) NOT NULL DEFAULT '', source TEXT NOT NULL, source_period VARCHAR(100) NOT NULL,
 checked_on DATE NOT NULL
);
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS directory_code VARCHAR(30) REFERENCES college_directory(code);
CREATE UNIQUE INDEX IF NOT EXISTS college_directory_link_unique ON colleges(directory_code) WHERE directory_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS ai_conversations (
 id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), college_id INTEGER NOT NULL REFERENCES colleges(id),
 mode VARCHAR(10) NOT NULL CHECK(mode IN ('support','study')), title VARCHAR(120) NOT NULL DEFAULT 'New chat',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_conversations_owner ON ai_conversations(user_id,college_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_turns (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
 request_key UUID NOT NULL, prompt TEXT NOT NULL CHECK(LENGTH(prompt) BETWEEN 1 AND 3000), answer TEXT,
 status VARCHAR(10) NOT NULL CHECK(status IN ('pending','complete','failed')), error TEXT, incomplete BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(conversation_id,request_key)
);
-- Preserve earlier TEST invoices as TEST records. New office records are separate.
ALTER TABLE fee_invoices DROP CONSTRAINT IF EXISTS fee_invoices_mode_check;
ALTER TABLE fee_invoices ALTER COLUMN mode TYPE VARCHAR(10);
ALTER TABLE fee_invoices ALTER COLUMN mode SET DEFAULT 'office';
ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoices_mode_check CHECK(mode IN ('test','office'));
DROP INDEX IF EXISTS fee_student_title_year_unique;
CREATE UNIQUE INDEX fee_student_title_year_unique ON fee_invoices(college_id,student_id,LOWER(title),academic_year,mode) WHERE status='active';
CREATE TABLE IF NOT EXISTS fee_import_batches (
 id UUID PRIMARY KEY, college_id INTEGER NOT NULL REFERENCES colleges(id), user_id INTEGER NOT NULL REFERENCES users(id),
 fingerprint TEXT NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
