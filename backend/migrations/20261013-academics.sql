BEGIN;
CREATE TABLE IF NOT EXISTS academic_courses (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 college_id INTEGER NOT NULL REFERENCES colleges(id),
 code VARCHAR(30) NOT NULL, name VARCHAR(150) NOT NULL,
 academic_year VARCHAR(9) NOT NULL, department VARCHAR(100) NOT NULL,
 admission_year INTEGER NOT NULL CHECK(admission_year BETWEEN 2000 AND 2100),
 semester SMALLINT NOT NULL CHECK(semester BETWEEN 1 AND 8),
 section VARCHAR(20) NOT NULL,
 faculty_id INTEGER REFERENCES users(id),
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS academic_course_class_unique ON academic_courses
 (college_id,LOWER(code),academic_year,LOWER(department),admission_year,semester,LOWER(section));
CREATE TABLE IF NOT EXISTS course_enrollments (
 course_id INTEGER NOT NULL REFERENCES academic_courses(id),
 student_id INTEGER NOT NULL REFERENCES users(id), enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(course_id,student_id)
);
CREATE TABLE IF NOT EXISTS attendance_sessions (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 course_id INTEGER NOT NULL REFERENCES academic_courses(id),
 class_date DATE NOT NULL, period SMALLINT NOT NULL CHECK(period BETWEEN 1 AND 12),
 version INTEGER NOT NULL DEFAULT 1, recorded_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(course_id,class_date,period), UNIQUE(id,course_id)
);
CREATE TABLE IF NOT EXISTS attendance_records (
 session_id INTEGER NOT NULL, course_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 status VARCHAR(10) NOT NULL CHECK(status IN ('present','absent','excused')),
 PRIMARY KEY(session_id,student_id),
 FOREIGN KEY(session_id,course_id) REFERENCES attendance_sessions(id,course_id),
 FOREIGN KEY(course_id,student_id) REFERENCES course_enrollments(course_id,student_id)
);
CREATE TABLE IF NOT EXISTS assessments (
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 course_id INTEGER NOT NULL REFERENCES academic_courses(id), title VARCHAR(100) NOT NULL,
 assessment_date DATE NOT NULL, max_score NUMERIC(7,2) NOT NULL CHECK(max_score>0 AND max_score<=1000),
 version INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(id,course_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_title_unique ON assessments(course_id,LOWER(title));
CREATE TABLE IF NOT EXISTS assessment_scores (
 assessment_id INTEGER NOT NULL, course_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
 score NUMERIC(7,2), status VARCHAR(10) NOT NULL DEFAULT 'ungraded' CHECK(status IN ('ungraded','graded','absent')),
 CHECK((status='graded' AND score IS NOT NULL AND score>=0) OR (status IN ('ungraded','absent') AND score IS NULL)),
 PRIMARY KEY(assessment_id,student_id),
 FOREIGN KEY(assessment_id,course_id) REFERENCES assessments(id,course_id),
 FOREIGN KEY(course_id,student_id) REFERENCES course_enrollments(course_id,student_id)
);
CREATE INDEX IF NOT EXISTS enrollments_student_index ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS attendance_student_index ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS scores_student_index ON assessment_scores(student_id);
COMMIT;
