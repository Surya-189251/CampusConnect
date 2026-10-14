BEGIN;

-- Login accounts for students, faculty, and administrators.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login_id VARCHAR(50) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(254),
    password_hash TEXT NOT NULL,

    role VARCHAR(20) NOT NULL
        CHECK (role IN ('student', 'faculty', 'admin')),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),

    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (login_id = BTRIM(login_id) AND LENGTH(login_id) > 0),
    CHECK (LENGTH(BTRIM(full_name)) > 0)
);

-- Prevent duplicate IDs even if letter case differs.
CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_unique
    ON users (LOWER(login_id));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL;


-- Extra information for student accounts.
-- The student's login_id will be their roll number.
CREATE TABLE IF NOT EXISTS student_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    department VARCHAR(100) NOT NULL,
    admission_year INTEGER NOT NULL
        CHECK (admission_year BETWEEN 2000 AND 2100),
    semester SMALLINT NOT NULL
        CHECK (semester BETWEEN 1 AND 8),
    section VARCHAR(20) NOT NULL
);


-- Extra information submitted by faculty.
-- The faculty member's login_id will be their faculty ID.
CREATE TABLE IF NOT EXISTS faculty_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    department VARCHAR(100) NOT NULL,
    requested_designation VARCHAR(100) NOT NULL,
    approved_designation VARCHAR(100)
);


-- Optional permissions assigned by an administrator.
CREATE TABLE IF NOT EXISTS permissions (
    code VARCHAR(60) PRIMARY KEY,
    description TEXT NOT NULL
);

INSERT INTO permissions (code, description)
VALUES
    ('fees.manage', 'Create and assign student fee amounts'),
    ('payments.view', 'View student payment records and receipts'),
    ('payments.record_offline', 'Record verified offline payments')
ON CONFLICT (code) DO NOTHING;


-- Records who has each extra permission and who granted it.
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    permission_code VARCHAR(60) NOT NULL REFERENCES permissions(code),
    granted_by INTEGER NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, permission_code)
);


-- Login sessions. Only a hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_index
    ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expiry_index
    ON sessions (expires_at);


-- History of important actions such as approvals and fee changes.
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;