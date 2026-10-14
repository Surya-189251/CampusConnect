BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS mobile VARCHAR(15);
INSERT INTO permissions (code, description) VALUES
 ('students.manage', 'Create and import student accounts') ON CONFLICT (code) DO NOTHING;
COMMIT;
