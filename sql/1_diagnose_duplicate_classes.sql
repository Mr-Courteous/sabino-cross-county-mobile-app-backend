-- ============================================================
-- STEP 1 — DIAGNOSE
-- Run this first. It only reads data — nothing is changed.
-- Shows every case where one school has 2+ "classes" rows whose
-- name is the same once you ignore case/extra spaces (e.g. two
-- rows that both display as "Primary 4"). This is the bug behind
-- "some classes hidden" / "student not showing under Primary 4".
-- ============================================================

SELECT
  c.school_id,
  LOWER(TRIM(c.class_name))                         AS normalized_name,
  COUNT(*)                                           AS duplicate_rows,
  ARRAY_AGG(c.id ORDER BY c.id)                      AS class_ids,
  ARRAY_AGG(c.class_name ORDER BY c.id)              AS raw_names,
  -- How many students are enrolled under each duplicate id, in the
  -- same order as class_ids above — the id with the most enrollments
  -- is almost always the "real" one everyone has been using.
  ARRAY_AGG(
    (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id)
    ORDER BY c.id
  )                                                   AS enrollment_counts
FROM classes c
GROUP BY c.school_id, LOWER(TRIM(c.class_name))
HAVING COUNT(*) > 1
ORDER BY c.school_id, normalized_name;

-- Read the output as: for each (school_id, normalized_name) row,
-- class_ids / raw_names / enrollment_counts line up positionally.
-- The class_id with the highest enrollment_count is the one to KEEP
-- (the "keeper") in step 2 — the others are the accidental duplicates
-- to merge away.
