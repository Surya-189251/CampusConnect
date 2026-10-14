BEGIN;

CREATE TABLE IF NOT EXISTS colleges (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO colleges (code, name)
VALUES ('VIKAS', 'VIKAS College of Engineering & Technology')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES colleges(id);

-- Assign existing development accounts to our first college.
UPDATE users
SET college_id = (
    SELECT id FROM colleges WHERE code = 'VIKAS'
)
WHERE college_id IS NULL;

ALTER TABLE users
ALTER COLUMN college_id SET NOT NULL;

-- IDs and emails must be unique within each college.
DROP INDEX IF EXISTS users_login_id_unique;
DROP INDEX IF EXISTS users_email_unique;

CREATE UNIQUE INDEX IF NOT EXISTS users_college_login_unique
ON users (college_id, LOWER(login_id));

CREATE UNIQUE INDEX IF NOT EXISTS users_college_email_unique
ON users (college_id, LOWER(email))
WHERE email IS NOT NULL;

INSERT INTO permissions (code, description)
VALUES (
    'students.manage',
    'Create student accounts individually or import them from spreadsheets'
)
ON CONFLICT (code) DO NOTHING;

-- Require everyone to sign in again after the college migration.
DELETE FROM sessions;

COMMIT;