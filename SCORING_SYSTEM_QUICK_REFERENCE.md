# Scoring System - Quick Reference Guide

## 📋 File Locations

- **Backend Route**: `Server/routes/scores.js`
- **Database Schema**: `Server/database/migrate.js`
- **Full API Docs**: `Server/SCORING_SYSTEM_API.md`
- **Implementation Guide**: `Server/SCORING_SYSTEM_README.md`

---

## 🎯 Core Concepts

### Score Structure
```
Student + Subject + Academic Year + Term = Score Record
[4 CA scores] + [1 Exam score] = Total Score (0-100)
```

### Academic Organization
```
School
├── Academic Year (2023/2024)
│   ├── Term 1
│   ├── Term 2
│   └── Term 3
├── Academic Year (2024/2025)
│   ├── Term 1
│   ├── Term 2
│   └── Term 3
└── ... (supports 10+ years)
```

---

## 🔌 Essential Endpoints

### Entry/Update
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/scores/record` | Add/update one score |
| POST | `/api/scores/bulk-upsert` | Add/update many scores |

### Retrieval
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/scores/class-sheet` | Get all scores for bulk editing |
| GET | `/api/scores/student/:id` | Get all scores for a student |
| GET | `/api/scores/term-summary` | Get performance summary |

### Reports
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/scores/report-card/single/:id` | One student's report card |
| POST | `/api/scores/report-cards/bulk` | Multiple report cards |
| GET | `/api/scores/report-cards/class-summary` | Class rankings & stats |

### Analysis
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/scores/analytics/subject` | Subject performance data |

### Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| PUT | `/api/scores/:id` | Update specific score |
| DELETE | `/api/scores/:id` | Delete specific score |

---

## 📊 Score Composition

```
CA1: 0-20  │
CA2: 0-20  │ Continuous Assessment
CA3: 0-20  │ (Over the term)
CA4: 0-20  │
Exam: 0-40 │ End-of-term exam
─────────────
Total: 0-100
```

---

## 🎓 Grading System

```
A  ➜ 70-100  Excellent
B  ➜ 60-69   Very Good
C  ➜ 50-59   Good
D  ➜ 40-49   Fair
E  ➜ 30-39   Poor
F  ➜ 0-29    Very Poor
```

---

## 📝 Request/Response Examples

### Create Single Score
```json
POST /api/scores/record
{
  "studentId": 1,
  "subjectId": 5,
  "classId": 3,
  "academicYear": "2023/2024",
  "term": 1,
  "ca1Score": 15,
  "ca2Score": 18,
  "ca3Score": 14,
  "ca4Score": 16,
  "examScore": 35,
  "teacherRemark": "Good work"
}

✓ Returns: Created score with id, total_score auto-calculated
```

### Bulk Update Scores
```json
POST /api/scores/bulk-upsert
{
  "scores": [
    {
      "studentId": 1,
      "subjectId": 5,
      "classId": 3,
      "academicYear": "2023/2024",
      "term": 1,
      "ca1Score": 15,
      "ca2Score": 18,
      ...
    },
    ...
  ]
}

✓ Returns: Array of all upserted scores
```

### Get Class Sheet
```
GET /api/scores/class-sheet?classId=3&subjectId=5&academicYear=2023/2024&term=1

✓ Returns: All students in class with their scores for that subject
```

### Get Report Card
```
GET /api/scores/report-card/single/1?academicYear=2023/2024&term=1

✓ Returns:
{
  "student": { name, reg#, class, etc },
  "termInfo": { academicYear, term },
  "subjects": [ { subject, scores, grade, performance } ],
  "summary": { average, total, rating }
}
```

---

## 🔑 Key Parameters

| Parameter | Type | Values | Example |
|-----------|------|--------|---------|
| `studentId` | int | student pk | 1 |
| `subjectId` | int | subject pk | 5 |
| `classId` | int | class pk | 3 |
| `academicYear` | string | YYYY/YYYY | "2023/2024" |
| `term` | int | 1, 2, 3 | 1 |
| `ca1Score` | decimal | 0-20 | 15 |
| `examScore` | decimal | 0-40 | 35 |

---

## ✅ Validation Rules

✓ **Scores**: CA = 0-20, Exam = 0-40  
✓ **Year**: Format must be "2023/2024"  
✓ **Term**: Must be 1, 2, or 3  
✓ **Unique**: No duplicate (school + student + subject + year + term)  
✓ **School**: Automatic isolation - can only access own school data  

---

## 🗄️ Database Tables

### Subjects
```sql
subjects(
  id, school_id, subject_name, subject_code, 
  description, created_at, updated_at
)
```

### Scores
```sql
scores(
  id, school_id, student_id, subject_id, class_id,
  academic_year, term,
  ca1_score, ca2_score, ca3_score, ca4_score, exam_score,
  total_score [AUTO], teacher_remark, updated_by,
  created_at, updated_at
)
```

---

## 🚀 Common Workflows

### Workflow 1: Enter Scores for a Class
```
1. GET /api/scores/class-sheet (fetch current data)
2. Teacher fills in scores locally
3. POST /api/scores/bulk-upsert (save all at once)
```

### Workflow 2: Generate Report Cards
```
1. Get student list from frontend
2. POST /api/scores/report-cards/bulk (generate all)
3. Frontend formats/prints the response
```

### Workflow 3: View Class Performance
```
1. GET /api/scores/report-cards/class-summary
2. Shows rankings, averages, top performer
3. Can drill down to individual student
```

### Workflow 4: Analyze Subject Performance
```
1. GET /api/scores/analytics/subject
2. Shows grade distribution, average, variance
3. Identify struggling students/topics
```

---

## 🔐 Authentication

All endpoints require:
```
Authorization: Bearer <JWT_TOKEN>
```

The token must include `schoolId` for automatic school isolation.

---

## ❌ Common Errors

| Status | Error | Solution |
|--------|-------|----------|
| 400 | Missing required fields | Check all required params |
| 400 | CA score must be 0-20 | Validate score ranges |
| 400 | Term must be 1, 2, or 3 | Use valid term number |
| 403 | Student not found in your school | Verify student belongs to school |
| 404 | Score record not found | Check score ID |

---

## 💾 Database Setup

```bash
# Run migrations to create tables and indexes
npm run migrate

# Tables created:
# - subjects (new)
# - scores (enhanced)
# - All necessary indexes
```

---

## 📱 Frontend Integration

The API is ready for:

1. **Score Entry Screen**
   - Fetch class-sheet
   - Display in editable table
   - Submit bulk updates

2. **Report Card Viewer**
   - Fetch report-card/single
   - Display formatted report
   - Print/export option

3. **Analytics Dashboard**
   - Fetch analytics/subject
   - Fetch report-cards/class-summary
   - Display charts/graphs

4. **Management Interface**
   - CRUD operations for subjects
   - Score corrections
   - Historical data access

---

## 🎯 Performance Tips

- Use bulk-upsert instead of multiple single requests
- Cache class sheets and summaries
- Pre-calculate analytics during off-peak hours
- Use indexes (already created in migration)
- Implement pagination for large result sets

---

## 🔗 Related Files

- Existing students route: `Server/routes/students.js`
- Auth middleware: `Server/middleware/auth.js`
- Database config: `Server/database/db.js`
- Main server: `Server/index.js`

---

## 📞 Getting Help

1. Read: `SCORING_SYSTEM_API.md` (full reference)
2. Read: `SCORING_SYSTEM_README.md` (detailed guide)
3. Check: `routes/scores.js` (source code with comments)
4. Test: Use cURL or Postman with examples in this guide

---

## ✨ Key Features

✅ Auto-calculated totals  
✅ School data isolation  
✅ Bulk operations (500+ scores at once)  
✅ Grade calculation (A-F)  
✅ Performance ratings  
✅ Term summaries  
✅ Class analytics  
✅ Subject analytics  
✅ Comprehensive report cards  
✅ Audit trail (updated_by, updated_at)  

