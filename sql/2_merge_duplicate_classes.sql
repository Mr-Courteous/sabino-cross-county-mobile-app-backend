-- ============================================================
-- STEP 2 — MERGE
-- Run AFTER reviewing step 1's output and taking a DB backup/
-- snapshot (Render/Railway both offer one-click backups — take
-- one first regardless of how confident you are).
--
-- For every school + class name that has duplicate rows (e.g. two
-- "Primary 4" rows with different ids), this:
--   1. Picks a "keeper" — whichever duplicate has the most students
--      enrolled under it (ties broken by the oldest/lowest id).
--   2. Re-points every table that references class_id (enrollments,
--      attendance records + weekly sign-offs, staff class
--      assignments, invite codes, document library, Sabino AI
--      documents) from the other duplicate(s) onto the keeper.
--   3. Deletes the now-empty duplicate class row(s).
--
-- Wrapped in a transaction — nothing is permanent until COMMIT at
-- the bottom runs. If anything looks wrong from the NOTICEs, run
-- ROLLBACK instead of letting it reach COMMIT.
-- ============================================================

BEGIN;

DO $$
DECLARE
  grp RECORD;
  keeper_id INTEGER;
  dup_id INTEGER;
BEGIN
  FOR grp IN
    SELECT
      c.school_id,
      LOWER(TRIM(c.class_name)) AS normalized_name,
      ARRAY_AGG(c.id ORDER BY
        (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) DESC,
        c.id ASC
      ) AS ids_best_first
    FROM classes c
    GROUP BY c.school_id, LOWER(TRIM(c.class_name))
    HAVING COUNT(*) > 1
  LOOP
    keeper_id := grp.ids_best_first[1];
    RAISE NOTICE 'School %, class "%": keeping id %, merging ids % into it',
      grp.school_id, grp.normalized_name, keeper_id,
      grp.ids_best_first[2:array_length(grp.ids_best_first, 1)];

    FOREACH dup_id IN ARRAY grp.ids_best_first[2:array_length(grp.ids_best_first, 1)]
    LOOP
      -- Students / enrollments
      UPDATE enrollments SET class_id = keeper_id WHERE class_id = dup_id;

      -- Attendance
      UPDATE attendance_records SET class_id = keeper_id WHERE class_id = dup_id;

      -- Weekly sign-offs collide on UNIQUE(class_id, session_id, term, week_number) —
      -- if the keeper already has a sign-off for that exact week, drop the
      -- duplicate's row rather than fail the merge; otherwise re-point it.
      DELETE FROM attendance_weekly_signoffs dup
      WHERE dup.class_id = dup_id
        AND EXISTS (
          SELECT 1 FROM attendance_weekly_signoffs keep
          WHERE keep.class_id = keeper_id
            AND keep.session_id = dup.session_id
            AND keep.term = dup.term
            AND keep.week_number = dup.week_number
        );
      UPDATE attendance_weekly_signoffs SET class_id = keeper_id WHERE class_id = dup_id;

      -- Staff assignment / invite codes
      UPDATE staff SET class_id = keeper_id WHERE class_id = dup_id;
      UPDATE staff_invite_codes SET class_id = keeper_id WHERE class_id = dup_id;

      -- Document library + Sabino AI documents (nullable FK, no unique constraint)
      UPDATE document_library SET class_id = keeper_id WHERE class_id = dup_id;
      UPDATE ai_scheme_of_work SET class_id = keeper_id WHERE class_id = dup_id;
      UPDATE ai_lesson_plans SET class_id = keeper_id WHERE class_id = dup_id;
      UPDATE ai_lesson_notes SET class_id = keeper_id WHERE class_id = dup_id;

      -- Now safe to remove the duplicate class row itself
      DELETE FROM classes WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;

-- Review the NOTICEs above. If everything looks right:
COMMIT;
-- If anything looks wrong, run ROLLBACK; instead of the COMMIT above.
