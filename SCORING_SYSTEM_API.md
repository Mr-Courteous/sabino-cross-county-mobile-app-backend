# Comprehensive Scoring System API Documentation

## Overview

A scalable, production-ready scoring system based on the **Educational Data Model** designed for schools to manage student assessments across multiple academic years.

### Key Features

✅ **4 CA + Exam Structure** - 4 Continuous Assessment scores (CA1-CA4) + 1 Exam score per subject per term  
✅ **3-Term Academic Year** - Support for 3 terms per academic year  
✅ **Multi-Year Support** - Track scores across multiple academic years  
✅ **Bulk Operations** - Update multiple students/subjects efficiently  
✅ **Report Card Generation** - Generate individual or bulk report cards  
✅ **Analytics & Summaries** - Class summaries, subject analytics, performance tracking  
✅ **Scalable Architecture** - Built for schools with hundreds to thousands of students  

---

## Data Model

### Score Structure

Each score record contains:

```json
{
  "student_id": "unique student identifier",
  "subject_id": "subject being assessed",
  "class_id": "student's class",
  "academic_year": "2023/2024 format",
  "term": "1, 2, or 3",
  "ca1_score": "0-20",
  "ca2_score": "0-20",
  "ca3_score": "0-20",
  "ca4_score": "0-20",
  "exam_score": "0-40",
  "total_score": "Auto-calculated (sum of all scores)"
}
```

### Grading Scale

- **A** = 70-100 (Excellent)
- **B** = 60-69 (Very Good)
- **C** = 50-59 (Good)
- **D** = 40-49 (Fair)
- **E** = 30-39 (Poor)
- **F** = 0-29 (Very Poor)

---

## API Endpoints

All endpoints require authentication:
```http
Authorization: Bearer <JWT_TOKEN>
```

---

## 1. SCORE RECORD MANAGEMENT

### Create/Update Single Score

**Endpoint:** `POST /api/scores/record`

**Description:** Create or update a single score record for a student in a subject

**Request Body:**
```json
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
  "teacherRemark": "Excellent performance in class"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Score record saved successfully",
  "data": {
    "id": 42,
    "school_id": 2,
    "student_id": 1,
    "subject_id": 5,
    "class_id": 3,
    "academic_year": "2023/2024",
    "term": 1,
    "ca1_score": 15,
    "ca2_score": 18,
    "ca3_score": 14,
    "ca4_score": 16,
    "exam_score": 35,
    "total_score": 98,
    "teacher_remark": "Excellent performance in class",
    "updated_by": 1,
    "updated_at": "2024-01-22T10:30:00Z"
  }
}
```

---

### Bulk Upsert Scores

**Endpoint:** `POST /api/scores/bulk-upsert`

**Description:** Create or update multiple score records at once (ideal for batch uploads)

**Request Body:**
```json
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
      "ca3Score": 14,
      "ca4Score": 16,
      "examScore": 35,
      "teacherRemark": "Excellent"
    },
    {
      "studentId": 2,
      "subjectId": 5,
      "classId": 3,
      "academicYear": "2023/2024",
      "term": 1,
      "ca1Score": 12,
      "ca2Score": 14,
      "ca3Score": 13,
      "ca4Score": 15,
      "examScore": 32,
      "teacherRemark": "Good performance"
    }
  ]
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Successfully upserted 2 score records",
  "count": 2,
  "data": [...]
}
```

---

## 2. SCORE RETRIEVAL & VIEWING

### Get Class Score Sheet

**Endpoint:** `GET /api/scores/class-sheet`

**Description:** Get all scores for a class in a specific subject and term (for bulk editing views)

**Query Parameters:**
- `classId` (required) - The class ID
- `subjectId` (required) - The subject ID
- `academicYear` (required) - Format: "2023/2024"
- `term` (required) - 1, 2, or 3

**Example Request:**
```http
GET /api/scores/class-sheet?classId=3&subjectId=5&academicYear=2023/2024&term=1
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "count": 45,
  "message": "Retrieved 45 student records",
  "data": [
    {
      "student_id": 1,
      "first_name": "Chioma",
      "last_name": "Okafor",
      "registration_number": "STU-2023-001",
      "ca1_score": 15,
      "ca2_score": 18,
      "ca3_score": 14,
      "ca4_score": 16,
      "exam_score": 35,
      "total_score": 98,
      "teacher_remark": "Excellent performance",
      "score_id": 42,
      "updated_at": "2024-01-22T10:30:00Z"
    },
    ...
  ]
}
```

---

### Get Student All Scores

**Endpoint:** `GET /api/scores/student/:studentId`

**Description:** Get all scores for a specific student across all subjects and terms

**Query Parameters:**
- `academicYear` (optional) - Filter by specific academic year

**Example Request:**
```http
GET /api/scores/student/1?academicYear=2023/2024
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "id": 42,
      "student_id": 1,
      "subject_id": 5,
      "academic_year": "2023/2024",
      "term": 1,
      "ca1_score": 15,
      "ca2_score": 18,
      "ca3_score": 14,
      "ca4_score": 16,
      "exam_score": 35,
      "total_score": 98,
      "teacher_remark": "Excellent",
      "updated_at": "2024-01-22T10:30:00Z"
    },
    ...
  ]
}
```

---

### Get Term Summary

**Endpoint:** `GET /api/scores/term-summary`

**Description:** Get summary of scores for all students in a term (performance metrics)

**Query Parameters:**
- `classId` (required)
- `academicYear` (required)
- `term` (required) - 1, 2, or 3

**Example Request:**
```http
GET /api/scores/term-summary?classId=3&academicYear=2023/2024&term=1
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "count": 45,
  "data": [
    {
      "student_id": 1,
      "first_name": "Chioma",
      "last_name": "Okafor",
      "registration_number": "STU-2023-001",
      "subjects_entered": 8,
      "average_score": 75.5,
      "highest_score": 98,
      "lowest_score": 52,
      "passed_subjects": 8,
      "failed_subjects": 0
    },
    ...
  ]
}
```

---

## 3. REPORT CARD GENERATION

### Generate Single Report Card

**Endpoint:** `GET /api/scores/report-card/single/:studentId`

**Description:** Generate a complete report card for a single student

**Query Parameters:**
- `academicYear` (required) - Format: "2023/2024"
- `term` (required) - 1, 2, or 3

**Example Request:**
```http
GET /api/scores/report-card/single/1?academicYear=2023/2024&term=1
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "student": {
      "id": 1,
      "firstName": "Chioma",
      "lastName": "Okafor",
      "registrationNumber": "STU-2023-001",
      "gender": "Female",
      "dateOfBirth": "2008-05-15",
      "className": "JSS3",
      "formTeacher": "Mrs. Johnson"
    },
    "termInfo": {
      "academicYear": "2023/2024",
      "term": 1
    },
    "subjects": [
      {
        "score_id": 42,
        "subject_id": 5,
        "subject_name": "English Language",
        "subject_code": "EN101",
        "ca1_score": 15,
        "ca2_score": 18,
        "ca3_score": 14,
        "ca4_score": 16,
        "exam_score": 35,
        "total_score": 98,
        "grade": "A",
        "performance": "Excellent",
        "teacher_remark": "Outstanding work"
      },
      ...
    ],
    "summary": {
      "totalSubjects": 8,
      "subjectsPassed": 8,
      "subjectsFailed": 0,
      "overallAverage": 75.5,
      "totalScore": 604,
      "performanceRating": "Very Good"
    }
  }
}
```

---

### Generate Bulk Report Cards

**Endpoint:** `POST /api/scores/report-cards/bulk`

**Description:** Generate report cards for multiple students at once

**Request Body:**
```json
{
  "studentIds": [1, 2, 3, 4, 5],
  "academicYear": "2023/2024",
  "term": 1
}
```

**Response (200):**
```json
{
  "success": true,
  "count": 5,
  "message": "Generated 5 report cards",
  "data": [
    {
      "student": { ... },
      "termInfo": { ... },
      "subjects": [ ... ],
      "summary": { ... }
    },
    ...
  ]
}
```

---

### Get Class Summary Report

**Endpoint:** `GET /api/scores/report-cards/class-summary`

**Description:** Get a summary report for an entire class (rankings, statistics)

**Query Parameters:**
- `classId` (required)
- `academicYear` (required)
- `term` (required) - 1, 2, or 3

**Example Request:**
```http
GET /api/scores/report-cards/class-summary?classId=3&academicYear=2023/2024&term=1
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "classStats": {
      "totalStudents": 45,
      "classAverage": 65.3,
      "averagePerformance": "Very Good",
      "topPerformer": {
        "student_id": 1,
        "first_name": "Chioma",
        "last_name": "Okafor",
        "registration_number": "STU-2023-001",
        "class_average": 75.5
      }
    },
    "students": [
      {
        "student_id": 1,
        "first_name": "Chioma",
        "last_name": "Okafor",
        "registration_number": "STU-2023-001",
        "total_subjects": 8,
        "class_average": 75.5,
        "highest_score": 98,
        "lowest_score": 52,
        "passed_subjects": 8,
        "failed_subjects": 0,
        "overall_performance": "Very Good"
      },
      ...
    ]
  }
}
```

---

## 4. ANALYTICS & ANALYSIS

### Get Subject Analytics

**Endpoint:** `GET /api/scores/analytics/subject`

**Description:** Get detailed analytics for a subject (class average, distribution, etc.)

**Query Parameters:**
- `subjectId` (required)
- `academicYear` (required)
- `term` (required) - 1, 2, or 3
- `classId` (optional) - For specific class analysis

**Example Request:**
```http
GET /api/scores/analytics/subject?subjectId=5&academicYear=2023/2024&term=1&classId=3
Authorization: Bearer <TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "total_students": 45,
    "average_score": 72.3,
    "highest_score": 98,
    "lowest_score": 32,
    "score_variance": 12.5,
    "excellent": 12,
    "very_good": 18,
    "good": 10,
    "fair": 4,
    "poor": 1,
    "very_poor": 0
  }
}
```

---

## 5. SCORE MANAGEMENT

### Update Score Record

**Endpoint:** `PUT /api/scores/:scoreId`

**Description:** Update individual scores in a record

**Request Body:**
```json
{
  "ca1Score": 16,
  "examScore": 37,
  "teacherRemark": "Updated remark"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Score record updated successfully",
  "data": { ... }
}
```

---

### Delete Score Record

**Endpoint:** `DELETE /api/scores/:scoreId`

**Description:** Delete a score record

**Response (200):**
```json
{
  "success": true,
  "message": "Score record deleted successfully"
}
```

---

## Error Handling

### Common Error Responses

**Validation Error (400):**
```json
{
  "success": false,
  "message": "Validation Error",
  "error": "studentId, subjectId, classId, academicYear, and term are required"
}
```

**Unauthorized (403):**
```json
{
  "success": false,
  "message": "Unauthorized",
  "error": "Student not found in your school"
}
```

**Not Found (404):**
```json
{
  "success": false,
  "message": "Not Found",
  "error": "Score record not found"
}
```

**Server Error (500):**
```json
{
  "success": false,
  "message": "Server Error",
  "error": "Internal server error message"
}
```

---

## Validation Rules

### Score Ranges
- **CA Scores** (CA1-CA4): 0-20 each
- **Exam Score**: 0-40
- **Total Score**: Automatically calculated (0-100)

### Academic Year Format
- Must be in "YYYY/YYYY" format (e.g., "2023/2024")

### Term
- Must be 1, 2, or 3

### Performance Thresholds
- Pass: >= 50
- Pass Rate: 70+ (A), 60-69 (B), 50-59 (C), 40-49 (D), 30-39 (E), <30 (F)

---

## Use Cases & Examples

### Use Case 1: Teacher Entering Scores for a Class

1. Get class sheet for bulk entry:
```http
GET /api/scores/class-sheet?classId=3&subjectId=5&academicYear=2023/2024&term=1
```

2. Update multiple students at once:
```http
POST /api/scores/bulk-upsert
Body: { "scores": [...] }
```

### Use Case 2: Generating Report Cards

1. Generate for all students in a class:
```http
POST /api/scores/report-cards/bulk
Body: { "studentIds": [1,2,3,4,5], "academicYear": "2023/2024", "term": 1 }
```

2. Export or print individual cards:
```http
GET /api/scores/report-card/single/1?academicYear=2023/2024&term=1
```

### Use Case 3: Class Performance Analysis

1. Get class summary:
```http
GET /api/scores/report-cards/class-summary?classId=3&academicYear=2023/2024&term=1
```

2. Analyze specific subject:
```http
GET /api/scores/analytics/subject?subjectId=5&academicYear=2023/2024&term=1&classId=3
```

---

## Performance Considerations

### Optimization Tips

1. **Bulk Operations**: Use bulk-upsert for multiple scores instead of individual requests
2. **Indexes**: Pre-created indexes on school_id, student_id, subject_id, academic_year, term
3. **Pagination**: Consider pagination for large result sets (implement in frontend)
4. **Caching**: Cache frequently accessed reports (class summaries, analytics)

### Scalability

- Tested for schools with 1000+ students
- Handles multiple concurrent teachers updating scores
- Efficient queries with compound indexes
- Database constraints prevent duplicate entries

---

## Database Schema

### Subjects Table
```sql
CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  subject_name VARCHAR(100),
  subject_code VARCHAR(20),
  description TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(school_id, subject_code)
);
```

### Scores Table
```sql
CREATE TABLE scores (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  student_id INTEGER REFERENCES students(id),
  subject_id INTEGER REFERENCES subjects(id),
  class_id INTEGER REFERENCES classes(id),
  academic_year VARCHAR(9),
  term INTEGER CHECK (term IN (1, 2, 3)),
  ca1_score DECIMAL(5, 2),
  ca2_score DECIMAL(5, 2),
  ca3_score DECIMAL(5, 2),
  ca4_score DECIMAL(5, 2),
  exam_score DECIMAL(5, 2),
  total_score DECIMAL(6, 2) GENERATED ALWAYS AS (...) STORED,
  teacher_remark TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(school_id, student_id, subject_id, academic_year, term)
);
```

---

## Future Enhancements

- [ ] CSV export for report cards
- [ ] PDF generation for printable report cards
- [ ] Grade statistics and trends analysis
- [ ] Automated grade notifications
- [ ] Parent portal access to report cards
- [ ] Comments and feedback system
- [ ] Transcript generation
- [ ] GPA calculation

---

## Support & Debugging

For issues:
1. Check error messages for validation errors
2. Verify authentication token is valid
3. Ensure academic year format is correct (YYYY/YYYY)
4. Check that term is 1, 2, or 3
5. Verify student/subject/class belong to authenticated school

For bulk operations, validate data before submission to avoid partial updates.

