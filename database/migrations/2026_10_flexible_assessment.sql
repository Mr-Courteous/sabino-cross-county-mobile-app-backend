-- =====================================================================
-- Flexible academic structure & configurable results
-- Idempotent and additive: safe to run more than once, and existing
-- scores / report cards are not modified (see notes at each step).
-- Requires PostgreSQL 13+ (ALTER COLUMN ... DROP EXPRESSION).
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Per-school assessment configuration (components + grading scale).
--    A school with NO row here keeps the built-in default layout
--    (CA1-CA4 /10, Exam /60, A-F bands) exactly as before.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_configs (
  id            SERIAL PRIMARY KEY,
  school_id     INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  components    JSONB   NOT NULL,
  grading_bands JSONB   NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_by    INTEGER,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 2. Score records carry their own frozen copy of the template and
--    grading scale they were saved under. Existing rows keep NULL here
--    and are treated as the built-in default, so nothing changes for
--    them. Changing a school's template never touches these columns;
--    they are only refreshed when a record is edited or when the school
--    explicitly applies the new template.
-- ---------------------------------------------------------------------
ALTER TABLE scores ADD COLUMN IF NOT EXISTS components        JSONB;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS template_snapshot JSONB;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS grading_snapshot  JSONB;

-- ---------------------------------------------------------------------
-- 3. total_score used to be GENERATED ALWAYS from the five fixed
--    columns. A custom template needs a different sum, so the column
--    becomes a plain column kept correct by a trigger. Every existing
--    query that reads sc.total_score keeps working, and legacy rows
--    compute exactly the same value as before.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'scores'::regclass AND attname = 'total_score'
       AND attgenerated = 's'
  ) THEN
    ALTER TABLE scores ALTER COLUMN total_score DROP EXPRESSION;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION scores_compute_total() RETURNS trigger AS $fn$
BEGIN
  IF NEW.template_snapshot IS NULL OR NEW.components IS NULL THEN
    -- Built-in layout: identical to the old generated expression.
    NEW.total_score := COALESCE(NEW.ca1_score, 0) + COALESCE(NEW.ca2_score, 0)
                     + COALESCE(NEW.ca3_score, 0) + COALESCE(NEW.ca4_score, 0)
                     + COALESCE(NEW.exam_score, 0);
  ELSE
    -- Custom layout: sum the numeric components flagged as counting
    -- toward the total, using the template frozen on this very record.
    SELECT COALESCE(SUM((NEW.components ->> (c ->> 'key'))::numeric), 0)
      INTO NEW.total_score
      FROM jsonb_array_elements(NEW.template_snapshot -> 'components') AS c
     WHERE c ->> 'type' = 'number'
       AND COALESCE((c ->> 'counts_toward_total')::boolean, true)
       AND jsonb_typeof(NEW.components -> (c ->> 'key')) = 'number';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scores_compute_total ON scores;
CREATE TRIGGER trg_scores_compute_total
  BEFORE INSERT OR UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION scores_compute_total();

-- ---------------------------------------------------------------------
-- 4. School-owned subjects. They live in the same table the app already
--    joins everywhere (global_subjects); school_id NULL = shared library.
-- ---------------------------------------------------------------------
ALTER TABLE global_subjects ADD COLUMN IF NOT EXISTS school_id  INTEGER REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE global_subjects ADD COLUMN IF NOT EXISTS created_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_global_subjects_school ON global_subjects(school_id);

-- A single-column UNIQUE(subject_name) would stop two schools from both
-- adding e.g. "Dance". Replace it with uniqueness per school scope.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'global_subjects'::regclass
       AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(con.conkey) k
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) = ARRAY['subject_name']
  LOOP
    EXECUTE format('ALTER TABLE global_subjects DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped single-column unique constraint % on global_subjects(subject_name)', r.conname;
  END LOOP;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_global_subjects_scope_name
    ON global_subjects (COALESCE(school_id, 0), LOWER(subject_name));
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped uq_global_subjects_scope_name: shared library has case-insensitive duplicate names. The app still works; duplicates of custom subjects are checked in code.';
END $$;

-- ---------------------------------------------------------------------
-- 5. Class management: rename / archive without the template top-up in
--    GET /api/classes/school re-creating the class.
-- ---------------------------------------------------------------------
ALTER TABLE classes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS origin_name VARCHAR(50);

-- ---------------------------------------------------------------------
-- 6. Class arms and teacher assignments.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_arms (
  id         SERIAL PRIMARY KEY,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  arm_name   VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (class_id, arm_name)
);
CREATE INDEX IF NOT EXISTS idx_class_arms_school ON class_arms(school_id, class_id);

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS arm_id INTEGER REFERENCES class_arms(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id         SERIAL PRIMARY KEY,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id   INTEGER NOT NULL,                       -- staff.id (no FK: staff table is created lazily)
  subject_id INTEGER NOT NULL REFERENCES global_subjects(id) ON DELETE CASCADE,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  arm_id     INTEGER REFERENCES class_arms(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_assignment
  ON teacher_assignments (staff_id, subject_id, class_id, COALESCE(arm_id, 0));
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_school ON teacher_assignments(school_id, class_id);

COMMIT;
