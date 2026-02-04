# Common SQL Queries Reference

## Academic Sessions Management

### List All Sessions for a School
```sql
SELECT id, session_name, is_active, created_at
FROM academic_sessions
WHERE school_id = 1
ORDER BY session_name DESC;
```

### Set Active Session
```sql
-- Deactivate all sessions for school
UPDATE academic_sessions
SET is_active = false
WHERE school_id = 1;

-- Activate specific session
UPDATE academic_sessions
SET is_active = true
WHERE school_id = 1 AND session_name = '2025/2026';
```

### Create New Academic Session
```sql
INSERT INTO academic_sessions (school_id, session_name, is_active)
VALUES (1, '2026/2027', false)
RETURNING id, session_name;
```

---

## Class Management

### Get All Classes for School
```sql
SELECT id, class_name, form_teacher, capacity, created_at
FROM classes
WHERE school_id = 1
ORDER BY class_name;
```

### Get Class with Enrollment Count
```sql
SELECT 
  c.id,
  c.class_name,
  c.form_teacher,
  COUNT(e.id) as enrollment_count,
  c.capacity
FROM classes c
LEFT JOIN enrollments e ON c.id = e.class_id AND e.status IN ('active', 'promoted')
WHERE c.school_id = 1
GROUP BY c.id
ORDER BY c.class_name;
```

---

## Student & Enrollment Queries

### Get All Students for School
```sql
SELECT id, first_name, last_name, registration_number, email, created_at
FROM students
WHERE school_id = 1
ORDER BY last_name, first_name;
```

### Get Student with Current Enrollment
```sql
SELECT 
  s.id,
  s.first_name,
  s.last_name,
  s.registration_number,
  c.class_name,
  a.session_name,
  e.status,
  e.id as enrollment_id
FROM students s
LEFT JOIN enrollments e ON s.id = e.student_id AND a.is_active = true
LEFT JOIN classes c ON e.class_id = c.id
LEFT JOIN academic_sessions a ON e.session_id = a.id
WHERE s.id = 10 AND s.school_id = 1;
```

### Get Class Roster (Active Session)
```sql
SELECT 
  e.id as enrollment_id,
  s.id as student_id,
  s.first_name,
  s.last_name,
  s.registration_number,
  e.status
FROM enrollments e
JOIN students s ON e.student_id = s.id
JOIN academic_sessions a ON e.session_id = a.id
WHERE e.class_id = 1 AND a.session_name = '2025/2026' AND a.is_active = true
ORDER BY s.last_name, s.first_name;
```

### Get Complete Enrollment History for Student
```sql
SELECT 
  e.id as enrollment_id,
  e.status,
  c.class_name,
  a.session_name,
  e.created_at,
  e.updated_at
FROM enrollments e
JOIN classes c ON e.class_id = c.id
JOIN academic_sessions a ON e.session_id = a.id
WHERE e.student_id = 10 AND e.school_id = 1
ORDER BY a.session_name DESC;
```

### Check for Duplicate Enrollments
```sql
SELECT 
  school_id, student_id, class_id, session_id, COUNT(*) as duplicate_count
FROM enrollments
GROUP BY school_id, student_id, class_id, session_id
HAVING COUNT(*) > 1;
```

---

## Score Entry & Management

### Get All Scores for Enrollment
```sql
SELECT 
  s.id,
  s.enrollment_id,
  s.subject_id,
  sub.subject_name,
  s.term,
  s.ca1_score,
  s.ca2_score,
  s.ca3_score,
  s.ca4_score,
  s.exam_score,
  s.total_score,
  s.teacher_remark
FROM scores s
JOIN subjects sub ON s.subject_id = sub.id
WHERE s.enrollment_id = 100 AND s.school_id = 1
ORDER BY s.term, sub.subject_name;
```

### Get Scores for Subject in Class
```sql
SELECT 
  s.id,
  st.first_name,
  st.last_name,
  s.term,
  s.ca1_score,
  s.ca2_score,
  s.ca3_score,
  s.ca4_score,
  s.exam_score,
  s.total_score
FROM scores s
JOIN enrollments e ON s.enrollment_id = e.id
JOIN students st ON e.student_id = st.id
WHERE e.class_id = 1 AND s.subject_id = 5 AND s.term = 1
ORDER BY s.total_score DESC;
```

### Get Student Performance Summary
```sql
SELECT 
  s.first_name,
  s.last_name,
  COUNT(DISTINCT sc.subject_id) as subjects_entered,
  ROUND(AVG(sc.total_score), 2) as average_score,
  MAX(sc.total_score) as highest_score,
  MIN(sc.total_score) as lowest_score,
  COUNT(CASE WHEN sc.total_score >= 50 THEN 1 END) as passed_count,
  COUNT(CASE WHEN sc.total_score < 50 THEN 1 END) as failed_count
FROM scores sc
JOIN enrollments e ON sc.enrollment_id = e.id
JOIN students s ON e.student_id = s.id
WHERE e.id = 100 AND sc.term = 1
GROUP BY s.id, s.first_name, s.last_name;
```

### Get Partial Score Entry Status
```sql
-- Find subjects with only CA1 entered (exam not yet entered)
SELECT 
  st.first_name,
  st.last_name,
  sub.subject_name,
  sc.ca1_score,
  sc.ca2_score,
  sc.ca3_score,
  sc.ca4_score,
  sc.exam_score,
  sc.total_score
FROM scores sc
JOIN enrollments e ON sc.enrollment_id = e.id
JOIN students st ON e.student_id = st.id
JOIN subjects sub ON sc.subject_id = sub.id
WHERE e.class_id = 1 AND sc.term = 1 AND sc.exam_score IS NULL
ORDER BY st.last_name;
```

---

## Bulk Operations & Analytics

### Promote Entire Class to Next Grade
```sql
-- Step 1: Get enrollments for current class
SELECT id, student_id, class_id, session_id, status
FROM enrollments
WHERE class_id = 1 AND status = 'active' AND session_id IN (
  SELECT id FROM academic_sessions WHERE school_id = 1 AND is_active = true
)
LIMIT 45;

-- Step 2: Create new enrollments for next session/class
INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
SELECT 
  e.school_id,
  e.student_id,
  2,  -- New class_id (JSS2A)
  (SELECT id FROM academic_sessions WHERE school_id = 1 AND session_name = '2026/2027'),
  'promoted'
FROM enrollments e
WHERE e.class_id = 1 AND e.school_id = 1 AND e.status = 'active'
AND e.session_id = (SELECT id FROM academic_sessions WHERE school_id = 1 AND is_active = true);

-- Step 3: Update old enrollments status
UPDATE enrollments
SET status = 'promoted'
WHERE class_id = 1 AND status = 'active' 
AND session_id = (SELECT id FROM academic_sessions WHERE school_id = 1 AND is_active = true);
```

### Handle Repeaters (Same Class, New Session)
```sql
-- Create new enrollments for repeaters
INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
SELECT 
  e.school_id,
  e.student_id,
  e.class_id,  -- Same class
  (SELECT id FROM academic_sessions WHERE school_id = 1 AND session_name = '2026/2027'),
  'repeated'
FROM enrollments e
WHERE e.school_id = 1 AND e.student_id IN (
  -- Students who failed (average < 50)
  SELECT DISTINCT e2.student_id
  FROM enrollments e2
  JOIN scores s ON e2.id = s.enrollment_id
  GROUP BY e2.student_id
  HAVING AVG(s.total_score) < 50
);
```

### Transfer Student to Different Class (Same Session)
```sql
UPDATE enrollments
SET class_id = 2,  -- New class
    status = 'transferred',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 100 AND school_id = 1;
```

---

## Data Integrity Checks

### Find Orphaned Records
```sql
-- Students with no enrollments
SELECT s.id, s.first_name, s.last_name
FROM students s
WHERE NOT EXISTS (
  SELECT 1 FROM enrollments e WHERE e.student_id = s.id
) AND s.school_id = 1;

-- Enrollments with deleted students
SELECT e.id, e.student_id
FROM enrollments e
WHERE NOT EXISTS (
  SELECT 1 FROM students s WHERE s.id = e.student_id
);

-- Scores with deleted enrollments
SELECT s.id, s.enrollment_id
FROM scores s
WHERE NOT EXISTS (
  SELECT 1 FROM enrollments e WHERE e.id = s.enrollment_id
);
```

### Check Referential Integrity
```sql
-- Verify all enrollments reference valid schools
SELECT COUNT(*) as invalid_enrollments
FROM enrollments e
WHERE NOT EXISTS (SELECT 1 FROM schools sc WHERE sc.id = e.school_id);

-- Verify all enrollments reference valid sessions
SELECT COUNT(*) as invalid_enrollments
FROM enrollments e
WHERE NOT EXISTS (SELECT 1 FROM academic_sessions a WHERE a.id = e.session_id);

-- Verify cascade delete works
DELETE FROM students WHERE id = 999;  -- Should cascade to enrollments and scores
SELECT COUNT(*) FROM enrollments WHERE student_id = 999;  -- Should return 0
```

### Duplicate Detection
```sql
-- Find duplicate registrations
SELECT registration_number, COUNT(*) as count
FROM students
GROUP BY registration_number
HAVING COUNT(*) > 1;

-- Find students enrolled in same class multiple times
SELECT school_id, student_id, class_id, session_id, COUNT(*) as duplicates
FROM enrollments
GROUP BY school_id, student_id, class_id, session_id
HAVING COUNT(*) > 1;

-- Find multiple score entries for same enrollment-subject-term
SELECT enrollment_id, subject_id, term, COUNT(*) as duplicates
FROM scores
GROUP BY enrollment_id, subject_id, term
HAVING COUNT(*) > 1;
```

---

## Performance Analysis

### Index Usage
```sql
-- Check if indexes are being used
EXPLAIN ANALYZE
SELECT * FROM enrollments 
WHERE school_id = 1 AND session_id = 5;

-- Find unused indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname NOT IN (
  SELECT indexrelname 
  FROM pg_stat_user_indexes
);
```

### Slow Queries
```sql
-- Enable query logging
SET log_min_duration_statement = 100;  -- Log queries > 100ms

-- View slow queries
SELECT query, mean_time, calls
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### Table Sizes
```sql
-- Get sizes of tables
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Backup & Recovery

### Full Database Backup
```bash
pg_dump -U postgres -h localhost sabino_db > sabino_backup_$(date +%Y%m%d).sql

# Or with compression
pg_dump -U postgres -h localhost -Fc sabino_db > sabino_backup_$(date +%Y%m%d).dump
```

### Restore from Backup
```bash
# From SQL file
psql -U postgres -h localhost -d sabino_db < sabino_backup_20250122.sql

# From compressed dump
pg_restore -U postgres -h localhost -d sabino_db sabino_backup_20250122.dump
```

### Export School Data
```sql
-- Export all students and enrollments for a school
COPY (
  SELECT s.id, s.first_name, s.last_name, s.registration_number, 
         c.class_name, a.session_name, e.status
  FROM students s
  LEFT JOIN enrollments e ON s.id = e.student_id
  LEFT JOIN classes c ON e.class_id = c.id
  LEFT JOIN academic_sessions a ON e.session_id = a.id
  WHERE s.school_id = 1
) TO '/tmp/school_data.csv' WITH CSV HEADER;
```

---

## Transaction Examples

### Safe Bulk Insert with Transaction
```sql
BEGIN;

-- Insert students
INSERT INTO students (school_id, first_name, last_name, registration_number)
VALUES 
  (1, 'John', 'Doe', 'STU-2025-001'),
  (1, 'Jane', 'Smith', 'STU-2025-002');

-- Insert enrollments
INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
SELECT 1, id, 1, 5, 'active' FROM students WHERE registration_number LIKE 'STU-2025%';

-- If all successful
COMMIT;

-- If error occurred, automatic ROLLBACK
```

---

## Maintenance Tasks

### Weekly
```sql
-- Check for orphaned records
SELECT 'orphaned_students' as issue, COUNT(*) FROM students 
WHERE id NOT IN (SELECT DISTINCT student_id FROM enrollments);

-- Check for duplicate enrollments
SELECT 'duplicate_enrollments' as issue, COUNT(*) FROM (
  SELECT * FROM enrollments 
  GROUP BY school_id, student_id, class_id, session_id 
  HAVING COUNT(*) > 1
) t;

-- Vacuum and analyze
VACUUM ANALYZE;
```

### Monthly
```sql
-- Archive old data (optional)
-- Archive scores from completed sessions
DELETE FROM scores
WHERE enrollment_id IN (
  SELECT id FROM enrollments 
  WHERE session_id IN (
    SELECT id FROM academic_sessions 
    WHERE is_active = false AND session_name < '2024/2025'
  )
)
RETURNING enrollment_id;

-- Or export before deleting
```

---

## Useful Views (Optional)

### Create View: Current Class Rosters
```sql
CREATE VIEW current_class_rosters AS
SELECT 
  c.id as class_id,
  c.class_name,
  COUNT(e.id) as student_count,
  a.session_name,
  a.is_active
FROM classes c
LEFT JOIN enrollments e ON c.id = e.class_id AND e.status IN ('active', 'promoted')
LEFT JOIN academic_sessions a ON e.session_id = a.id
WHERE a.is_active = true
GROUP BY c.id, c.class_name, a.id, a.session_name, a.is_active;

-- Usage
SELECT * FROM current_class_rosters;
```

### Create View: Student Performance
```sql
CREATE VIEW student_performance AS
SELECT 
  s.id,
  s.first_name || ' ' || s.last_name as student_name,
  c.class_name,
  ROUND(AVG(sc.total_score), 2) as average,
  MAX(sc.total_score) as highest,
  MIN(sc.total_score) as lowest,
  COUNT(DISTINCT sc.subject_id) as subjects
FROM students s
JOIN enrollments e ON s.id = e.student_id
JOIN classes c ON e.class_id = c.id
LEFT JOIN scores sc ON e.id = sc.enrollment_id
GROUP BY s.id, s.first_name, s.last_name, c.id, c.class_name;

-- Usage
SELECT * FROM student_performance WHERE average >= 70;
```
