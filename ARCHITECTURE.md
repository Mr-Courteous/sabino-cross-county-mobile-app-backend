# Sabino Backend - Architecture & System Design

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Application                        │
│                  (React Native / Expo)                       │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/HTTPS
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Express.js Server                         │
│                 (Node.js Backend API)                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          API Routes Layer                           │   │
│  │  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │  /api/auth   │  │  /api/schools│  ...          │   │
│  │  └──────┬───────┘  └──────┬───────┘                │   │
│  └─────────┼──────────────────┼────────────────────────┘   │
│            │                  │                             │
│  ┌─────────↓──────────────────↓────────────────────────┐   │
│  │       Middleware Layer                               │   │
│  │  ┌──────────────────┐  ┌──────────────────────┐    │   │
│  │  │  Auth Middleware │  │  CORS, JSON Parser  │    │   │
│  │  │  (JWT Verify)    │  │  Error Handling     │    │   │
│  │  └──────┬───────────┘  └─────────┬───────────┘    │   │
│  └─────────┼────────────────────────┼────────────────┘   │
│            │                        │                     │
│  ┌─────────↓────────────────────────↓────────────────┐   │
│  │      Controllers Layer                            │   │
│  │  ┌─────────────────────────────────────┐         │   │
│  │  │ Auth | School | Year | Class       │         │   │
│  │  │ Student | Preferences | Subscription│         │   │
│  │  └─────────────────┬───────────────────┘         │   │
│  └────────────────────┼──────────────────────────────┘   │
│                       │                                   │
│  ┌────────────────────↓──────────────────────────────┐   │
│  │      Database Layer (PostgreSQL)                  │   │
│  │  ┌────────────────────────────────────────┐      │   │
│  │  │ Connection Pool (pg module)            │      │   │
│  │  │ Query Builders & Parameterized Queries│      │   │
│  │  └────────────────────┬───────────────────┘      │   │
│  └─────────────────────────┼────────────────────────┘   │
└──────────────────────────────┼─────────────────────────────┘
                               │
                               ↓
                    ┌──────────────────┐
                    │   PostgreSQL DB  │
                    │  (sabino_schools)│
                    └──────────────────┘
```

---

## Request/Response Flow

```
1. CLIENT REQUEST
   ↓
   POST /api/schools
   Authorization: Bearer JWT_TOKEN
   Content-Type: application/json
   { "name": "School", "city": "Lagos" }
   ↓

2. SERVER RECEIVES
   ↓
   Express Router matches route
   ↓

3. MIDDLEWARE PROCESSING
   ↓
   CORS check → JSON parsing → Auth verification
   ↓
   Token valid? School ownership OK?
   ↓

4. CONTROLLER LOGIC
   ↓
   schoolController.create()
   ↓
   Input validation → Business logic
   ↓

5. DATABASE OPERATION
   ↓
   pool.query('INSERT INTO schools...')
   ↓
   Connection from pool → Execute → Return result
   ↓

6. RESPONSE
   ↓
   Format response → Set status code (201)
   ↓
   {
     "message": "School created",
     "school": { id: 1, name: "School", ... }
   }
   ↓

7. CLIENT RECEIVES
   ↓
   Parse JSON → Update UI → Show result
```

---

## Database Schema Relationships

```
┌──────────────────┐
│     users        │
├──────────────────┤
│ id (PK)          │
│ email (UNIQUE)   │
│ password_hash    │
│ name fields      │
└────────┬─────────┘
         │ (1)
         │ (Many)
         ↓
┌──────────────────────────┐
│     schools              │
├──────────────────────────┤
│ id (PK)                  │
│ owner_id (FK → users)    │◄──────┐
│ name, address, etc       │        │
└────────┬─────────────────┘        │
         │                          │
    (1)  │                          │
         │ (Many)                   │
         ↓                          │
    ┌────────────────────────┐     │
    │ academic_years         │     │
    ├────────────────────────┤     │
    │ id (PK)                │     │
    │ school_id (FK)         │     │ (1 per school)
    │ start_year, end_year   │     │
    │ is_current             │     │
    └────┬────────────────────┘     │
         │                          │
    (1)  │                          │
         │ (Many)                   │
         ↓                          │
    ┌────────────────────────┐     │
    │ classes                │     │
    ├────────────────────────┤     │
    │ id (PK)                │     │
    │ academic_year_id (FK)  │     │
    │ class_name             │     │
    │ form_teacher           │     │
    └────┬────────────────────┘     │
         │                          │
    (1)  │                          │
         │ (Many)                   │
         ↓                          │
    ┌────────────────────────┐     │
    │ students               │     │
    ├────────────────────────┤     │
    │ id (PK)                │     │
    │ class_id (FK)          │     │
    │ school_id (FK)         │     │
    │ name, DOB, parent info │     │
    └────────────────────────┘     │
                                   │
    ┌────────────────────────┐     │
    │school_preferences      │     │
    ├────────────────────────┤     │
    │ id (PK)                │     │
    │ school_id (FK) ◄───────┘
    │ logo_url, stamp_url    │
    │ theme_color, etc       │
    └────────────────────────┘

    ┌────────────────────────┐
    │subscription_plans      │
    ├────────────────────────┤
    │ id (PK)                │
    │ name, price            │
    │ duration_days          │
    │ features (JSONB)       │
    └────┬────────────────────┘
         │
    (1)  │
         │ (Many)
         ↓
    ┌────────────────────────┐
    │school_subscriptions    │
    ├────────────────────────┤
    │ id (PK)                │
    │ school_id (FK)         │
    │ plan_id (FK)           │
    │ status, dates          │
    └────────────────────────┘
```

---

## Data Flow Examples

### Example 1: School Registration Flow

```
User Input
  ↓
Frontend: POST /api/auth/register
  ↓
authController.register()
  ├─ Check email not exists
  ├─ Hash password
  ├─ INSERT INTO users
  ├─ Generate JWT
  └─ Return token
  ↓
User saves token locally
  ↓
Frontend: POST /api/schools
  (Header: Authorization: Bearer TOKEN)
  ↓
Auth Middleware
  ├─ Extract token
  ├─ Verify signature
  ├─ Extract user ID
  └─ Set req.user
  ↓
schoolController.create()
  ├─ Validate input
  ├─ INSERT INTO schools
  ├─ INSERT INTO school_preferences
  └─ Return school
  ↓
Frontend displays created school
```

### Example 2: Student Creation Flow

```
User Input: name, class, parent info
  ↓
Frontend: POST /api/schools/1/students
  (with Bearer token)
  ↓
Auth Middleware verifies token
  ↓
checkSchoolOwnership middleware
  ├─ SELECT owner_id FROM schools WHERE id=1
  ├─ Verify owner matches user
  └─ Allow if matches
  ↓
studentsController.create()
  ├─ Validate all required fields
  ├─ Check class exists
  ├─ INSERT INTO students
  └─ Return student record
  ↓
Database enforces:
  ├─ Foreign key (class_id must exist)
  ├─ Foreign key (school_id must exist)
  └─ Auto-timestamp created_at
  ↓
Frontend adds student to list
```

---

## API Authentication Flow

```
User Registration
│
├─ POST /api/auth/register
│  {email, password, name}
│  ↓
├─ Hash password: bcrypt.hash(password)
├─ Store in database
├─ Generate JWT: jwt.sign({id, email}, SECRET, {30d})
└─ Return {user, token}
│
└─────────────────────────────────────────┐
                                          │
Subsequent Requests                       │
│                                         │
├─ Every request includes:                │
│  Authorization: Bearer eyJhbGc...       │
│  ↓                                      │
├─ Middleware verifies:                   │
│  ├─ Token format valid?                 │
│  ├─ Signature valid?                    │
│  ├─ Not expired?                        │
│  └─ Extract payload (user ID, email)
│  ↓
├─ If verified: req.user = {id, email}
├─ If failed: Return 401/403
│  ↓
└─ Continue to route handler
   with user context
```

---

## Error Handling Flow

```
User makes request
  ↓
Request reaches handler
  ↓
Does it fail validation?
  ├─ YES → res.status(400).json({error: "..."})
  └─ NO → Continue
  ↓
Missing authentication?
  ├─ YES → res.status(401).json({error: "..."})
  └─ NO → Continue
  ↓
Not authorized (wrong school owner)?
  ├─ YES → res.status(403).json({error: "..."})
  └─ NO → Continue
  ↓
Resource not found?
  ├─ YES → res.status(404).json({error: "..."})
  └─ NO → Continue
  ↓
Database error?
  ├─ YES → res.status(500).json({error: "..."})
  └─ NO → Success response
  ↓
Try-catch wraps everything
  └─ Catches unhandled errors
```

---

## Subscription Workflow

```
School Admin
  ↓
GET /api/subscriptions/plans
  ↓
Display available plans
  ├─ Basic ($5000/month)
  ├─ Professional ($15000/month)
  └─ Enterprise ($50000/year)
  ↓
User selects plan
  ↓
POST /api/subscriptions/1/subscribe
  {planId: 1}
  ↓
subscriptionController.subscribe()
  ├─ Get plan details
  ├─ Calculate end date
  ├─ Deactivate old subscription
  ├─ INSERT new subscription
  └─ Return subscription
  ↓
Database automatically tracks:
  ├─ start_date
  ├─ end_date
  ├─ status (active)
  └─ auto_renew flag
  ↓
App checks subscription status
  ├─ Active → Enable features
  └─ Expired → Show upgrade prompt
```

---

## Class Validation System

```
Input: className: "JSS1"
  ↓
VALID_CLASSES = ['JSS1', 'JSS2', 'JSS3', 'SSS1', 'SSS2', 'SSS3']
  ↓
Is in list?
  ├─ YES → Proceed
  ├─ NO → res.status(400).json({error: "Invalid class"})
  └─ Display valid classes
  ↓
Check duplicate?
  (UNIQUE constraint in DB)
  ├─ Duplicate → Database rejects
  ├─ NO → INSERT succeeds
  ↓
Stored: {className: "JSS1", schoolId: 1, yearId: 1}
```

---

## Year Limitation System

```
School wants to add 11th year
  ↓
POST /api/schools/1/academic-years
  {startYear: 2033, endYear: 2034}
  ↓
academicYearController.create()
  ├─ COUNT existing years for school
  ├─ Is count >= 10?
  │  ├─ YES → res.status(400).json({error: "Max 10 years"})
  │  └─ NO → Proceed
  ├─ INSERT new year
  └─ Success response
  ↓
If school wants 11th year:
  ├─ Delete old year (or oldest)
  ├─ Then add new year
  └─ Always maintain max 10
```

---

## Technology Stack Details

```
┌─────────────────────────────┐
│  Runtime Environment        │
│  - Node.js v14+             │
│  - npm/yarn package manager │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│  Web Framework              │
│  - Express.js v4.22         │
│  - CORS support             │
│  - JSON parsing             │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│  Database                   │
│  - PostgreSQL v12+          │
│  - pg v8.11 driver          │
│  - Connection pooling       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│  Security                   │
│  - jsonwebtoken v9.1        │
│  - bcryptjs v2.4            │
│  - Parameterized queries    │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│  Configuration              │
│  - dotenv v16.3             │
│  - Environment variables    │
└─────────────────────────────┘
```

---

## Deployment Architecture

```
Development
  │
  ├─ Local PostgreSQL
  ├─ npm run dev (nodemon)
  └─ http://localhost:3000
  
Production
  │
  ├─ Cloud PostgreSQL (AWS RDS, etc)
  ├─ npm run start (PM2, systemd)
  ├─ https://api.sabino.com
  ├─ Load balancer (nginx)
  └─ Monitoring (Sentry, datadog)
```

---

## Performance Considerations

```
Indexing:
  ├─ schools(owner_id) → Fast user lookups
  ├─ academic_years(school_id) → Fast year lookups
  ├─ classes(school_id) → Fast class lookups
  └─ students(school_id, class_id) → Fast student lookups

Connection Pooling:
  ├─ Max 20 connections
  ├─ Reuse connections
  └─ Reduce overhead

Query Optimization:
  ├─ SELECT only needed fields
  ├─ Use JOINs efficiently
  └─ Limit result sets
```

---

## Security Layers

```
1. Network
   ├─ HTTPS/TLS encryption
   └─ Firewall rules

2. Authentication
   ├─ JWT tokens
   └─ Signature verification

3. Authorization
   ├─ School ownership checks
   └─ Role verification (future)

4. Input Validation
   ├─ Type checking
   ├─ Length limits
   └─ Enum validation

5. Database
   ├─ Parameterized queries
   ├─ Foreign keys
   └─ Constraints

6. Error Handling
   ├─ Generic messages
   └─ Secure logging
```

This architecture is **scalable**, **secure**, and **maintainable** for production use.
