BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT college_id FROM users WHERE role='admin' AND status='approved' GROUP BY college_id HAVING COUNT(*)>1) THEN
  RAISE EXCEPTION 'Multiple approved admins exist in a college. Review those accounts before applying this update.';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_admin_per_college ON users(college_id) WHERE role='admin' AND status='approved';
CREATE UNIQUE INDEX IF NOT EXISTS colleges_code_case_unique ON colleges(LOWER(code));
INSERT INTO permissions(code,description) VALUES ('notices.manage','Publish and manage college notices'),('timetable.manage','Manage the college timetable') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS college_notices (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, college_id INTEGER NOT NULL REFERENCES colleges(id),
 title VARCHAR(160) NOT NULL, body TEXT NOT NULL CHECK(LENGTH(body)<=5000),
 audience VARCHAR(10) NOT NULL CHECK(audience IN ('all','students','faculty')),
 department VARCHAR(100) NOT NULL DEFAULT '', pinned BOOLEAN NOT NULL DEFAULT FALSE,
 status VARCHAR(10) NOT NULL CHECK(status IN ('draft','published','archived')),
 publish_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ, CHECK(expires_at IS NULL OR expires_at>publish_at),
 version INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id), updated_by INTEGER NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notices_college_index ON college_notices(college_id,status,publish_at);
CREATE TABLE IF NOT EXISTS notice_reads (
 notice_id INTEGER NOT NULL REFERENCES college_notices(id), user_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL, read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(notice_id,user_id)
);
CREATE TABLE IF NOT EXISTS timetable_slots (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES academic_courses(id),
 weekday SMALLINT NOT NULL CHECK(weekday BETWEEN 1 AND 7), start_minute SMALLINT NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute SMALLINT NOT NULL CHECK(end_minute BETWEEN 1 AND 1440), CHECK(end_minute>start_minute), room VARCHAR(80) NOT NULL,
 valid_from DATE NOT NULL, valid_until DATE NOT NULL, CHECK(valid_until>=valid_from),
 archived BOOLEAN NOT NULL DEFAULT FALSE, version INTEGER NOT NULL DEFAULT 1,
 updated_by INTEGER NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS timetable_course_index ON timetable_slots(course_id,weekday);
COMMIT;
