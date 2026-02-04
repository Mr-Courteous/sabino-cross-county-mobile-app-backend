# Transaction-Based Enrollment Integration Guide

## Overview

This document describes the synchronized, transaction-based enrollment system connecting:
- **Schools** (root entity) → **Academic Sessions** (multi-year support) → **Classes** (JSS1-SSS3) → **Enrollments** (student-class links) → **Scores** (CA + Exam per enrollment)

All database modifications are now transactional, preventing data inconsistency and orphaned records.

---

## Database Architecture

### Table Hierarchy (Schools as Root)

```
users
  ↓
schools (root - owner_id → users)
  ├── academic_sessions (session_name, is_active flag)
  ├── classes (independent of sessions)
  ├── students (independent of classes)
  ├── enrollments (student ↔ class ↔ session bridge)
  ├── subjects
  ├── school_subscriptions
  └── school_preferences

scores table:
  enrollment_id → enrollments(id)
    ├── school_id
    ├── student_id
    ├── class_id
    └── session_id
```

### Key Changes from Previous System

| Previous | New | Benefit |
|----------|-----|---------|
| academic_years (start_year, end_year) | academic_sessions (session_name: "YYYY/YYYY") | Simpler, matches UI format |
| classes linked to academic_years | classes independent + enrollments for session | Reusable class definitions |
| scores.academic_session (VARCHAR) | enrollments.session_id (FK) | Referential integrity, no orphans |
| Student creation standalone | Student + auto-enrollment transaction | Guaranteed enrollment on creation |
| Direct student→class link in students | Bridge table (enrollments) | Supports promotions, repeaters, transfers |

---

## API Endpoints & Workflows

### 1. School Registration (Auto-creates Default Session)

**Endpoint**: `POST /api/schools`

**Request**:
```json
{
  "name": "Springfield Academy",
  "email": "admin@springfield.edu",
  "password": "secure_password",
  "school_type": "Secondary",
  "address": "123 Main St",
  "country": "Nigeria"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "School registered successfully",
  "data": {
    "token": "eyJhbGc...",
    "user": {
      "schoolId": 1,
      "email": "admin@springfield.edu",
      "name": "Springfield Academy",
      "type": "school"
    }
  }
}
```

**Behind the Scenes** (in transaction):
```
1. Insert user (owner)
2. Insert school
3. Auto-create default academic_session (e.g., "2025/2026")
4. Set is_active = true
5. Create school_preferences
6. Commit all or rollback
```

---

### 2. Class Setup (Reusable Across Sessions)

**Endpoint**: `GET /api/classes` (returns school's classes)

**Endpoint**: `POST /api/classes` (would need implementation)

**Example Classes** (same for all sessions):
```json
[
  { "id": 1, "class_name": "JSS1A", "form_teacher": "Mr. Okonkwo" },
  { "id": 2, "class_name": "JSS1B", "form_teacher": "Ms. Adeyemi" },
  { "id": 3, "class_name": "SSS2A", "form_teacher": "Mr. Ibrahim" }
]
```

---

### 3. Student Creation with Auto-Enrollment (Transaction)

**Endpoint**: `POST /api/students` (Single)

**Request**:
```json
{
  "firstName": "Chinedu",
  "lastName": "Okafor",
  "email": "chinedu@student.edu",
  "gender": "Male",
  "dateOfBirth": "2010-03-15",
  "registrationNumber": "STU-2025-001",
  "classId": 1,
  "phone": "+234812345678"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Student created and auto-enrolled successfully",
  "data": {
    "student": {
      "id": 10,
      "school_id": 1,
      "first_name": "Chinedu",
      "last_name": "Okafor",
      "registration_number": "STU-2025-001",
      "email": "chinedu@student.edu",
      "gender": "Male",
      "date_of_birth": "2010-03-15",
      "created_at": "2025-01-22T10:30:00Z"
    },
    "enrollment": {
      "id": 100,
      "school_id": 1,
      "student_id": 10,
      "class_id": 1,
      "session_id": 5,
      "status": "active",
      "created_at": "2025-01-22T10:30:00Z"
    }
  }
}
```

**Transaction Flow**:
```
BEGIN TRANSACTION
  1. Verify school authentication
  2. Get active academic_session (is_active = true)
  3. INSERT INTO students → Returns student.id
  4. Verify classId belongs to school
  5. INSERT INTO enrollments (student_id, class_id, session_id)
  6. Return both student and enrollment
COMMIT or ROLLBACK on error
```

**Bulk Endpoint**: `POST /api/students/bulk`

**Request**:
```json
{
  "students": [
    {
      "firstName": "Chinedu",
      "lastName": "Okafor",
      "classId": 1,
      "registrationNumber": "STU-2025-001"
    },
    {
      "firstName": "Amara",
      "lastName": "Adeyemi",
      "classId": 2,
      "registrationNumber": "STU-2025-002"
    }
  ]
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Successfully registered 2 students with auto-enrollment.",
  "data": {
    "students": [
      { "id": 10, "first_name": "Chinedu", ... },
      { "id": 11, "first_name": "Amara", ... }
    ],
    "enrollments": [
      { "id": 100, "student_id": 10, "class_id": 1, "session_id": 5 },
      { "id": 101, "student_id": 11, "class_id": 2, "session_id": 5 }
    ]
  }
}
```

---

### 4. Enrollment Management

#### 4.1 Create Custom Enrollment (Manual)

**Endpoint**: `POST /api/students/enrollments/create`

**Use Case**: Student transfer, grade repetition, or manual session assignment

**Request**:
```json
{
  "studentId": 10,
  "classId": 2,
  "sessionId": 6,
  "status": "repeated"
}
```

**Status Values**:
- `active`: Currently enrolled in class
- `promoted`: Moved to higher class
- `repeated`: Repeating same class
- `transferred`: Moved to different class (same session)
- `graduated`: Completed course

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Enrollment record saved successfully",
  "data": {
    "id": 102,
    "school_id": 1,
    "student_id": 10,
    "class_id": 2,
    "session_id": 6,
    "status": "repeated",
    "created_at": "2025-01-22T11:00:00Z"
  }
}
```

#### 4.2 Bulk Enrollment Creation

**Endpoint**: `POST /api/students/enrollments/bulk`

**Use Case**: Promote entire class or batch re-enrollment

**Request**:
```json
{
  "enrollments": [
    {
      "studentId": 10,
      "classId": 2,
      "sessionId": 6,
      "status": "promoted"
    },
    {
      "studentId": 11,
      "classId": 2,
      "sessionId": 6,
      "status": "promoted"
    }
  ]
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Successfully created/updated 2 enrollment records",
  "count": 2,
  "data": [...]
}
```

#### 4.3 Get Class Roster

**Endpoint**: `GET /api/students/enrollments/class/:classId?sessionId=5`

**Response** (200 OK):
```json
{
  "success": true,
  "count": 45,
  "data": [
    {
      "enrollment_id": 100,
      "student_id": 10,
      "first_name": "Chinedu",
      "last_name": "Okafor",
      "registration_number": "STU-2025-001",
      "academic_session": "2025/2026",
      "status": "active"
    }
  ]
}
```

#### 4.4 Get Student Enrollment History

**Endpoint**: `GET /api/students/:studentId/enrollments`

**Response** (200 OK):
```json
{
  "success": true,
  "count": 3,
  "message": "Retrieved 3 enrollment records for student",
  "data": [
    {
      "enrollment_id": 100,
      "academic_session": "2025/2026",
      "status": "active",
      "class_id": 1,
      "class_name": "JSS1A"
    },
    {
      "enrollment_id": 102,
      "academic_session": "2024/2025",
      "status": "promoted",
      "class_id": 4,
      "class_name": "JSS2A"
    }
  ]
}
```

#### 4.5 Update Enrollment (Promotion/Transfer)

**Endpoint**: `PUT /api/students/enrollments/:enrollmentId`

**Request** (Promote to next class):
```json
{
  "classId": 3,
  "status": "promoted"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Enrollment record updated successfully",
  "data": {
    "id": 100,
    "status": "promoted",
    "class_id": 3,
    "updated_at": "2025-01-22T12:00:00Z"
  }
}
```

---

### 5. Score Entry (Uses enrollment_id)

**Endpoint**: `POST /api/scores/record`

**Request** (Partial entry - CA1 only):
```json
{
  "enrollmentId": 100,
  "subjectId": 1,
  "term": 1,
  "ca1Score": 18
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": 5000,
    "enrollment_id": 100,
    "subject_id": 1,
    "term": 1,
    "ca1_score": 18,
    "ca2_score": null,
    "ca3_score": null,
    "ca4_score": null,
    "exam_score": null,
    "total_score": 18
  }
}
```

**Later** (Add CA2-CA4):
```json
{
  "enrollmentId": 100,
  "subjectId": 1,
  "term": 1,
  "ca2Score": 17,
  "ca3Score": 16,
  "ca4Score": 15
}
```

**Result** (COALESCE preserves CA1):
```json
{
  "ca1_score": 18,
  "ca2_score": 17,
  "ca3_score": 16,
  "ca4_score": 15,
  "exam_score": null,
  "total_score": 66
}
```

---

## Complete Workflow Example

### Scenario: New School Registration → Class Setup → Student Enrollment → Score Entry

```
Step 1: SCHOOL REGISTRATION (2025-01-22)
├─ School: "Springfield Academy"
├─ Auto-created session: "2025/2026" (is_active=true)
└─ Result: school_id=1, session_id=5

Step 2: CLASS SETUP (Admin creates master classes)
├─ JSS1A (class_id=1)
├─ JSS1B (class_id=2)
├─ JSS2A (class_id=3)
└─ SSS2A (class_id=4)

Step 3: BULK STUDENT CREATION + AUTO-ENROLLMENT
├─ POST /api/students/bulk
├─ 45 students for JSS1A, 40 for JSS1B, 38 for JSS2A
└─ Transaction creates:
   ├─ 123 student records
   └─ 123 enrollment records (all with session_id=5, status='active')

Step 4: SCORE ENTRY (Term 1, Multiple Subjects)
├─ Teacher enters CA1 scores for all students (45 × 15 subjects)
├─ Later: Adds CA2-CA4 scores (COALESCE preserves CA1)
├─ End of term: Adds exam scores
└─ Total scores auto-calculated by PostgreSQL generated column

Step 5: GENERATE REPORT CARD
├─ GET /api/scores/report-card/single/:enrollmentId
├─ Query joins: enrollments → students → classes → scores
└─ Returns: Student name, class, all subjects, grades (A-F), average

Step 6: PROMOTION (End of Year, 2026-06)
├─ Query all active JSS1A enrollments (status='active')
├─ Create new enrollments: same students → JSS2A → new session_id=6
├─ Update old enrollments: status='promoted'
└─ New scores enter with new enrollment_id
```

---

## Error Handling

### Common Errors & Solutions

#### 1. No Active Session Found
```json
{
  "success": false,
  "error": "No active academic session found for your school"
}
```

**Solution**: Create and activate a session first
```bash
curl -X POST /api/academic-sessions \
  -d { "sessionName": "2025/2026", "isActive": true }
```

#### 2. Class Not Found in School
```json
{
  "success": false,
  "error": "Class not found in your school"
}
```

**Solution**: Verify classId belongs to authenticated school
```bash
GET /api/classes
# Check returned class IDs
```

#### 3. Duplicate Enrollment
```json
{
  "success": false,
  "error": "Duplicate key value violates unique constraint"
}
```

**Solution**: Student already enrolled in this class for this session
- Use PUT to update status instead of POST
- Or create enrollment for different class/session

#### 4. Transaction Rollback (Bulk Student Creation)
```
Error during bulk creation of students #45
→ ROLLBACK triggered
→ All students rolled back (none created)
→ Check student data format and try again
```

**Solution**: Validate all students before batch submission

---

## Classes.js Updates

### School Isolation (Prevent Data Leakage)

**Before**:
```javascript
// GET /api/classes
router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, class_name FROM master_classes'  // No school filter!
  );
});
```

**After**:
```javascript
// GET /api/classes
router.get('/', async (req, res) => {
  const schoolId = req.user?.schoolId;  // Extract from JWT
  const result = await pool.query(
    'SELECT id, school_id, class_name FROM classes WHERE school_id = $1',
    [schoolId]  // Only return school's classes
  );
});
```

### GET /subjects Endpoint

```javascript
router.get('/subjects', async (req, res) => {
  const schoolId = req.user?.schoolId;
  const result = await pool.query(
    'SELECT id, subject_name, subject_code FROM subjects WHERE school_id = $1',
    [schoolId]
  );
});
```

---

## Transaction Best Practices

### When to Use Transactions

✅ **Use Transactions**:
- Student + Enrollment creation (must both succeed)
- Bulk operations (all-or-nothing)
- Multi-table updates (data consistency)

❌ **Don't Need Transactions**:
- Simple read operations (SELECT only)
- Single INSERT/UPDATE with no dependencies

### Transaction Pattern

```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // Multiple operations
  const result1 = await client.query(query1, params1);
  const result2 = await client.query(query2, params2);
  
  await client.query('COMMIT');
  res.json({ success: true, data: { result1, result2 } });
} catch (error) {
  await client.query('ROLLBACK');
  res.status(500).json({ error: error.message });
} finally {
  client.release();
}
```

---

## Migration from Old System

### Step 1: Backup Database
```bash
pg_dump -U postgres -h localhost sabino_db > backup.sql
```

### Step 2: Run New Migration
```bash
node Server/database/migrate.js
```

### Step 3: Migrate Existing Data (Manual SQL)

#### Option A: If you have academic_years data
```sql
-- Create academic_sessions from academic_years
INSERT INTO academic_sessions (school_id, session_name, is_active)
SELECT 
  school_id,
  CONCAT(start_year, '/', end_year) as session_name,
  is_current as is_active
FROM academic_years;

-- Get session IDs for next step
SELECT * FROM academic_sessions;
```

#### Option B: Fresh Start (Recommended)
```sql
-- Just run: node Server/database/migrate.js
-- Creates empty tables ready for new data
-- Add one school → auto-creates default session "2025/2026"
```

#### Step 4: Backfill Enrollments (if migrating)
```sql
-- Create enrollments from old student-class links
INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
SELECT 
  s.school_id,
  s.id,
  c.id,
  (SELECT id FROM academic_sessions WHERE school_id = s.school_id LIMIT 1),
  'active'
FROM students s
JOIN classes c ON s.class_id = c.id
WHERE s.class_id IS NOT NULL;
```

#### Step 5: Update Scores Table (if migrating)
```sql
-- Link old scores to enrollments
UPDATE scores
SET enrollment_id = (
  SELECT e.id
  FROM enrollments e
  WHERE e.student_id = (
    SELECT student_id FROM scores s2 WHERE s2.id = scores.id
  )
  LIMIT 1
)
WHERE enrollment_id IS NULL;
```

---

## Testing Checklist

- [ ] School registration auto-creates active session
- [ ] Classes retrieved filtered by school_id
- [ ] Single student creation creates enrollment in transaction
- [ ] Bulk student creation all succeed or all rollback
- [ ] Enrollment status updates work (promotion workflow)
- [ ] Class roster shows correct enrolled students
- [ ] Student enrollment history shows all sessions
- [ ] Score entry uses enrollment_id (not student_id)
- [ ] COALESCE partial updates don't overwrite
- [ ] Total score auto-calculated by generated column
- [ ] Report cards work with new enrollment structure
- [ ] Deleting student cascades to enrollments and scores
- [ ] Deleting enrollment cascades to scores

---

## Performance Notes

### Indexes Created
- `idx_academic_sessions_school` (school_id, is_active)
- `idx_enrollments_school_session` (compound for fast roster queries)
- `idx_scores_enrollment` (fast score lookups)

### Query Times (Expected)
- Get class roster (45 students): <100ms
- Get student enrollment history: <50ms
- Bulk student creation (100 students): ~1000ms
- Report card generation: <200ms

---

## Files Modified

1. **Server/database/migrate.js**
   - Replaced academic_years with academic_sessions
   - Updated classes to be independent
   - Updated enrollments with session_id FK
   - Updated scores to use only enrollment_id + term

2. **Server/routes/schools.js**
   - Added auto-session creation on school registration

3. **Server/routes/students.js**
   - Bulk and single POST now use transactions
   - Auto-enroll students on creation
   - All enrollment endpoints use session_id instead of string

4. **Server/routes/classes.js**
   - Added school_id filtering to prevent data leakage
   - All endpoints now school-specific

---

## Next Steps

1. ✅ Run database migration: `node Server/database/migrate.js`
2. ✅ Test school registration (check auto-session creation)
3. ✅ Create test classes
4. ✅ Bulk create test students (verify auto-enrollment)
5. ✅ Test enrollment management (promotion workflow)
6. ✅ Test score entry with enrollmentId
7. ✅ Update frontend API calls to use new parameters
8. ✅ Delete old academic_years table (optional cleanup)
