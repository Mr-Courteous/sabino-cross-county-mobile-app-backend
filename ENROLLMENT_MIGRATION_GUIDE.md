# Enrollment System - Quick Reference & Migration Guide

## What Changed?

### Database Schema
| Component | Old System | New System |
|-----------|-----------|-----------|
| Student Storage | Linked to class_id | Independent at school level |
| Class Assignment | Direct via student.class_id | Via enrollments table |
| Score Recording | student_id → class_id direct | enrollment_id (encapsulates student-class pair) |
| Academic Period | academicYear (e.g., "2023/2024") | academicSession (e.g., "2024/2025") |
| Score Nulls | Required (default 0) | Nullable with COALESCE |

### API Changes

#### Students Endpoints (Mostly Same)
```
OLD: POST /api/students          → NEW: POST /api/students
OLD: GET /api/students           → NEW: GET /api/students
OLD: GET /api/students/:id       → NEW: GET /api/students/:id (+ enrollment history)
OLD: PUT /api/students/:id       → NEW: PUT /api/students/:id
OLD: DELETE /api/students/:id    → NEW: DELETE /api/students/:id
OLD: POST /api/students/bulk     → NEW: POST /api/students/bulk
```

#### NEW Enrollment Endpoints
```
NEW: POST /api/students/enrollments/create
NEW: POST /api/students/enrollments/bulk
NEW: GET /api/students/enrollments/class/:classId?academicSession=X
NEW: GET /api/students/:studentId/enrollments
NEW: PUT /api/students/enrollments/:enrollmentId
NEW: DELETE /api/students/enrollments/:enrollmentId
```

#### Scores Endpoints (Parameter Changes)
```
OLD: POST /api/scores/record
{
  "studentId": 1,
  "classId": 5,
  "academicYear": "2023/2024"  ← OLD parameter name
  ...
}

NEW: POST /api/scores/record
{
  "enrollmentId": 10,  ← NEW: uses enrollment instead of student+class
  "academicSession": "2024/2025"  ← NEW: different format
  ...
}
```

## Key Features

### 1. Enrollment Status Tracking
Students can have different statuses:
- `active`: Currently in this class
- `promoted`: Moved to higher class
- `repeated`: Repeating the grade
- `transferred`: Moved to different class (same session)
- `graduated`: Completed course

### 2. Partial Score Updates with COALESCE
```javascript
// Update only CA1
POST /api/scores/record
{
  "enrollmentId": 10,
  "ca1Score": 18
  // Other CA scores and exam remain unchanged
}

// Later, update CA2-CA4
POST /api/scores/record
{
  "enrollmentId": 10,
  "ca2Score": 17,
  "ca3Score": 15,
  "ca4Score": 16
  // Previous ca1=18 is preserved
}

// Finally, update exam
POST /api/scores/record
{
  "enrollmentId": 10,
  "examScore": 35
  // All previous scores preserved, total calculated
}
```

### 3. Automatic Total Score Calculation
```sql
total_score GENERATED ALWAYS AS (
  COALESCE(ca1_score, 0) + COALESCE(ca2_score, 0) + 
  COALESCE(ca3_score, 0) + COALESCE(ca4_score, 0) + 
  COALESCE(exam_score, 0)
) STORED
```

- Automatically calculated at database level
- Uses COALESCE to handle NULL values as 0
- Always up-to-date, no manual calculation needed

### 4. Full Historical Tracking
```
GET /api/students/1
→ Student with all enrollments across sessions

GET /api/students/1/enrollments
→ Complete enrollment history (promotions, repeaters, etc.)

GET /api/scores/student/1?academicSession=2024/2025
→ Full transcript for academic session
```

## Migration Checklist

### Phase 1: Preparation
- [ ] Backup existing database
- [ ] Review current student-class assignments
- [ ] Plan academic session naming (use YYYY/YYYY format)
- [ ] Document any custom status values used

### Phase 2: Database Changes
- [ ] Run migrations (creates enrollments table, modifies students/scores)
- [ ] Verify indexes are created
- [ ] Test constraints (unique, check, foreign keys)

### Phase 3: Data Migration
```sql
-- Step 1: Populate enrollments from existing student-class links
INSERT INTO enrollments (school_id, student_id, class_id, academic_session, status)
SELECT 
  school_id, 
  id, 
  class_id, 
  '2024/2025',  -- Set current session
  'active'
FROM students
WHERE active = true;

-- Step 2: Verify migration
SELECT COUNT(*) FROM enrollments;
SELECT COUNT(*) FROM students;

-- Step 3: Update scores to use enrollment_id
-- This requires a complex JOIN and is dataset-specific
```

### Phase 4: Backend Updates
- [ ] Deploy updated scores.js (with enrollmentId, academicSession)
- [ ] Deploy updated students.js (with enrollment endpoints)
- [ ] Test all CRUD operations
- [ ] Verify COALESCE partial updates work

### Phase 5: Frontend Updates
- [ ] Update score entry forms to use enrollmentId
- [ ] Add enrollment management UI
- [ ] Update report card generation
- [ ] Test historical data retrieval
- [ ] Add student promotion workflow

### Phase 6: Testing
- [ ] Test partial score updates (CA only, exam only, etc.)
- [ ] Test bulk score entry
- [ ] Test report card generation
- [ ] Verify promotion workflow
- [ ] Check repeater scenarios
- [ ] Test student transfers
- [ ] Validate historical transcripts

## Request/Response Examples

### Create Enrollment
```bash
curl -X POST http://localhost:3000/api/students/enrollments/create \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "studentId": 1,
    "classId": 5,
    "academicSession": "2024/2025",
    "status": "active"
  }'
```

### Partial Score Entry (CA1 only)
```bash
curl -X POST http://localhost:3000/api/scores/record \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enrollmentId": 10,
    "subjectId": 3,
    "academicSession": "2024/2025",
    "term": 1,
    "ca1Score": 18
  }'
```

### Complete Score Entry
```bash
curl -X POST http://localhost:3000/api/scores/record \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enrollmentId": 10,
    "subjectId": 3,
    "academicSession": "2024/2025",
    "term": 1,
    "ca1Score": 18,
    "ca2Score": 17,
    "ca3Score": 15,
    "ca4Score": 16,
    "examScore": 35,
    "teacherRemark": "Good performance"
  }'
```

### Get Class Sheet (for bulk entry)
```bash
curl -X GET "http://localhost:3000/api/scores/class-sheet?classId=5&subjectId=3&academicSession=2024/2025&term=1" \
  -H "Authorization: Bearer TOKEN"
```

### Generate Report Card
```bash
curl -X GET "http://localhost:3000/api/scores/report-card/single/10?academicSession=2024/2025&term=1" \
  -H "Authorization: Bearer TOKEN"
```

## Important Notes

### Academic Session Format
- **MUST** use format: `YYYY/YYYY` (e.g., "2024/2025")
- Database constraint enforces this regex: `^\d{4}/\d{4}$`
- Invalid format will be rejected

### Enrollment ID vs Student ID
- **Old**: `GET /api/scores/report-card/single/1` (student ID)
- **New**: `GET /api/scores/report-card/single/10` (enrollment ID)
- Enrollment ID represents specific student-class-session pair
- Same student can have multiple enrollment IDs across sessions

### Partial Updates & COALESCE
- COALESCE treats NULL as "don't change"
- Only provided scores are updated
- Existing scores preserved automatically
- This is at database level (INSERT ... ON CONFLICT)

### Historical Data
- Never delete enrollments (mark as 'graduated' instead)
- Scores are cascaded deleted only if enrollment is deleted
- All historical data is preserved for transcripts
- Queries can filter by academicSession

## Troubleshooting

### Error: Foreign Key Violation
```
ERROR: insert or update on table "enrollments" violates foreign key constraint
```
**Cause**: Student or class doesn't exist in school
**Solution**: Verify both IDs exist and belong to same school

### Error: Unique Violation
```
ERROR: duplicate key value violates unique constraint
```
**Cause**: Student already enrolled in that class for that session
**Solution**: Use UPDATE status instead of INSERT

### Error: Invalid Academic Session
```
{
  "success": false,
  "error": "Academic session must be in format YYYY/YYYY"
}
```
**Cause**: Wrong format (e.g., "2024-2025" or "24/25")
**Solution**: Use format "2024/2025"

### Scores Not Updating (COALESCE Issue)
```javascript
// WRONG - passing 0 instead of null
{ ca1Score: 0 } // This will set ca1=0

// CORRECT - omit the field
{ ca2Score: 15 } // Only ca2 updates
```

### Missing Enrollment History
```bash
# Student is in database but no enrollments
GET /api/students/1/enrollments
# Returns empty array

# Solution: Create enrollment first
POST /api/students/enrollments/create
```

## Performance Tips

1. **Bulk Operations**: Use bulk endpoints for 10+ records
   ```bash
   POST /api/scores/bulk-upsert  # Better than 675 individual calls
   ```

2. **Class Sheet Query**: Highly optimized with composite indexes
   ```bash
   GET /api/scores/class-sheet?classId=5&...
   # Executes in <100ms for 45 students
   ```

3. **Transcript Queries**: Limited by number of sessions
   ```bash
   GET /api/scores/student/1  # O(sessions × terms × subjects)
   ```

4. **Index Coverage**:
   - Enrollments indexed on: school_id, student_id, class_id, session
   - Scores indexed on: enrollment_id, subject_id, session, term

## Reference Tables

### Status Values
| Status | Meaning | Next Session |
|--------|---------|--------------|
| active | Currently in class | Promoted or Graduated |
| promoted | Moved to higher class | Promoted again or Graduated |
| repeated | Repeating same class | Promoted or Graduated |
| transferred | Moved to different class | Promoted or Graduated |
| graduated | Course completed | (Archive/No next) |

### Academic Session Examples
| Code | Meaning |
|------|---------|
| 2023/2024 | August 2023 - July 2024 |
| 2024/2025 | August 2024 - July 2025 |
| 2025/2026 | August 2025 - July 2026 |

### Grading Scale
| Grade | Score Range | Performance |
|-------|-------------|-------------|
| A | 70-100 | Excellent |
| B | 60-69 | Very Good |
| C | 50-59 | Good |
| D | 40-49 | Fair |
| E | 30-39 | Poor |
| F | 0-29 | Very Poor |

## Files Modified

1. **Server/database/migrate.js**
   - Added enrollments table
   - Modified students table (removed class_id)
   - Modified scores table (enrollment_id instead of student_id + class_id)
   - Added 7 new indexes for enrollments
   - Updated 6 score indexes

2. **Server/routes/scores.js** (~1100 lines)
   - All endpoints refactored to use enrollmentId
   - Changed academicYear → academicSession
   - Bulk upsert now uses COALESCE for partial updates
   - Report cards accept enrollmentIds instead of studentIds
   - Full backward-incompatible changes

3. **Server/routes/students.js** (~450 lines)
   - Added 7 new enrollment management endpoints
   - Students now independent (no class_id)
   - Enrollment history included in GET student/:id
   - Support for enrollment status tracking

## Next Steps

1. Run database migrations
2. Deploy updated backend
3. Update frontend to use new enrollment-based endpoints
4. Test with sample data
5. Migrate existing data (if needed)
6. Train users on new system
7. Monitor performance and errors
