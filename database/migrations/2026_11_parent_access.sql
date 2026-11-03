-- =====================================================================
-- Parent accounts: one login, many children (possibly in different schools)
-- Idempotent and additive: nothing existing is changed or removed.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS parents (
  id            SERIAL PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(40),
  password_hash TEXT NOT NULL,
  last_login_at TIMESTAMP,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The connection between a parent and a child. 'revoked' rows are kept so a
-- link the school (or parent) removed is not silently re-created by auto-link.
CREATE TABLE IF NOT EXISTS parent_students (
  id           SERIAL PRIMARY KEY,
  parent_id    INTEGER NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id    INTEGER NOT NULL REFERENCES schools(id)  ON DELETE CASCADE,
  relationship VARCHAR(30) DEFAULT 'parent',
  status       VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  linked_via   VARCHAR(10) NOT NULL DEFAULT 'code'   CHECK (linked_via IN ('code', 'email')),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at   TIMESTAMP,
  UNIQUE (parent_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_students_parent  ON parent_students(parent_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_school  ON parent_students(school_id);

-- Per-student link code + guardian contact the school can record.
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_link_code VARCHAR(12);
ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name    VARCHAR(150);
ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_email   VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone   VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_students_guardian_email ON students (LOWER(guardian_email)) WHERE guardian_email IS NOT NULL;

-- Auto-link by guardian email is OFF until the school switches it on.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS parent_auto_link BOOLEAN NOT NULL DEFAULT false;

-- Code generator + trigger, so every NEW student gets a code without touching
-- any of the existing student-creation routes.
CREATE OR REPLACE FUNCTION make_parent_link_code() RETURNS text AS $fn$
DECLARE c text;
BEGIN
  LOOP
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM students WHERE parent_link_code = c);
  END LOOP;
  RETURN c;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION students_set_parent_code() RETURNS trigger AS $fn$
BEGIN
  IF NEW.parent_link_code IS NULL THEN
    NEW.parent_link_code := make_parent_link_code();
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_students_parent_code ON students;
CREATE TRIGGER trg_students_parent_code
  BEFORE INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION students_set_parent_code();

-- Codes for students that already exist.
UPDATE students SET parent_link_code = make_parent_link_code() WHERE parent_link_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_parent_link_code ON students(parent_link_code);

COMMIT;
