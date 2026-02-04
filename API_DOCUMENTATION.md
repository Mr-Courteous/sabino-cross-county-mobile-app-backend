# Sabino Backend API Documentation

A comprehensive backend system for managing schools, classes, students, and subscriptions built with Node.js, Express, and PostgreSQL.

## Features

✅ **User Authentication** - Register and login with JWT tokens
✅ **School Management** - Create and manage multiple schools
✅ **Academic Years** - Support for up to 10 years per school
✅ **Classes** - Manage JSS1-SSS3 classes with form teachers
✅ **Students** - Full student management with parent information
✅ **School Preferences** - Custom logos, stamps, themes per school
✅ **Subscription System** - Flexible subscription plans with expiry
✅ **Authorization** - School ownership verification

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Authentication:** JWT
- **Password Hashing:** bcryptjs

## Installation

### Prerequisites

- Node.js (v14+)
- PostgreSQL (v12+)
- npm or yarn

### Setup Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Update `.env` with your PostgreSQL credentials:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=sabino_schools
   DB_USER=postgres
   DB_PASSWORD=your_password
   JWT_SECRET=your_super_secret_key
   ```

3. **Create PostgreSQL database:**
   ```sql
   CREATE DATABASE sabino_schools;
   ```

4. **Run migrations:**
   ```bash
   npm run migrate
   ```

5. **Start the server:**
   ```bash
   npm start        # Production
   npm run dev      # Development (with nodemon)
   ```

The server will start on `http://localhost:3000`

## API Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "admin@school.com",
  "password": "secure_password",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+234801234567"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 1,
    "email": "admin@school.com",
    "first_name": "John",
    "last_name": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@school.com",
  "password": "secure_password"
}
```

### Schools

All school endpoints require authentication. Include the token in headers:
```http
Authorization: Bearer <your_token>
```

#### Create School
```http
POST /api/schools
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "Government Secondary School",
  "address": "123 Main Street",
  "city": "Lagos",
  "state": "Lagos",
  "country": "Nigeria",
  "phone": "+2341234567890",
  "email": "school@example.com"
}
```

#### Get My Schools
```http
GET /api/schools
Authorization: Bearer <token>
```

#### Get School Details
```http
GET /api/schools/:schoolId
Authorization: Bearer <token>
```

#### Update School
```http
PUT /api/schools/:schoolId
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated School Name",
  "phone": "+2349876543210"
}
```

#### Delete School
```http
DELETE /api/schools/:schoolId
Authorization: Bearer <token>
```

### Academic Years

#### Create Academic Year
```http
POST /api/schools/:schoolId/academic-years
Authorization: Bearer <token>
Content-Type: application/json

{
  "startYear": 2023,
  "endYear": 2024,
  "isCurrent": true
}
```

**Note:** Maximum 10 academic years per school

#### Get Academic Years
```http
GET /api/schools/:schoolId/academic-years
Authorization: Bearer <token>
```

#### Set Current Academic Year
```http
PUT /api/schools/:schoolId/academic-years/:yearId/set-current
Authorization: Bearer <token>
```

#### Delete Academic Year
```http
DELETE /api/schools/:schoolId/academic-years/:yearId
Authorization: Bearer <token>
```

### Classes

Available classes: **JSS1, JSS2, JSS3, SSS1, SSS2, SSS3**

#### Create Class
```http
POST /api/schools/:schoolId/academic-years/:yearId/classes
Authorization: Bearer <token>
Content-Type: application/json

{
  "className": "JSS1",
  "formTeacher": "Mr. Johnson",
  "capacity": 50
}
```

#### Get Classes for Academic Year
```http
GET /api/schools/:schoolId/academic-years/:yearId/classes
Authorization: Bearer <token>
```

#### Get All Classes for School
```http
GET /api/schools/:schoolId/classes
Authorization: Bearer <token>
```

#### Update Class
```http
PUT /api/schools/:schoolId/academic-years/:yearId/classes/:classId
Authorization: Bearer <token>
Content-Type: application/json

{
  "formTeacher": "Mrs. Smith",
  "capacity": 45
}
```

#### Delete Class
```http
DELETE /api/schools/:schoolId/academic-years/:yearId/classes/:classId
Authorization: Bearer <token>
```

### Students

#### Create Student
```http
POST /api/schools/:schoolId/students
Authorization: Bearer <token>
Content-Type: application/json

{
  "classId": 1,
  "firstName": "Chioma",
  "lastName": "Okafor",
  "admissionNumber": "GSS/2023/001",
  "dateOfBirth": "2008-05-15",
  "gender": "Female",
  "address": "45 Student Lane",
  "phone": "+2348012345678",
  "parentName": "Mrs. Okafor",
  "parentPhone": "+2349876543210"
}
```

#### Get All Students
```http
GET /api/schools/:schoolId/students
Authorization: Bearer <token>
```

#### Get Students by Class
```http
GET /api/schools/:schoolId/academic-years/:yearId/classes/:classId/students
Authorization: Bearer <token>
```

#### Get Student Details
```http
GET /api/schools/:schoolId/students/:studentId
Authorization: Bearer <token>
```

#### Update Student
```http
PUT /api/schools/:schoolId/students/:studentId
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "Chioma",
  "lastName": "Okafor",
  "address": "Updated Address"
}
```

#### Delete Student
```http
DELETE /api/schools/:schoolId/students/:studentId
Authorization: Bearer <token>
```

### School Preferences

#### Get Preferences
```http
GET /api/schools/:schoolId/preferences
Authorization: Bearer <token>
```

#### Update Preferences
```http
PUT /api/schools/:schoolId/preferences
Authorization: Bearer <token>
Content-Type: application/json

{
  "themeColor": "#007AFF",
  "logoUrl": "https://example.com/logo.png",
  "stampUrl": "https://example.com/stamp.png",
  "headerText": "Government Secondary School",
  "footerText": "© 2024 All Rights Reserved",
  "customSettings": {
    "language": "en",
    "dateFormat": "DD/MM/YYYY"
  }
}
```

### Subscriptions

#### Get Available Plans
```http
GET /api/subscriptions/plans
```

**Response:**
```json
{
  "plans": [
    {
      "id": 1,
      "name": "Basic",
      "description": "Perfect for small schools",
      "price": "5000.00",
      "duration_days": 30,
      "features": ["100 students", "Basic reports"]
    }
  ]
}
```

#### Subscribe to Plan
```http
POST /api/subscriptions/:schoolId/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "planId": 1
}
```

#### Get Current Subscription
```http
GET /api/subscriptions/:schoolId/current
Authorization: Bearer <token>
```

#### Cancel Subscription
```http
PUT /api/subscriptions/:schoolId/:subscriptionId/cancel
Authorization: Bearer <token>
```

## Database Schema

### Tables

- **users** - Admin accounts
- **schools** - School information
- **academic_years** - School years (max 10 per school)
- **classes** - Classes in each academic year
- **students** - Student records
- **school_preferences** - Custom school branding
- **subscription_plans** - Available subscription plans
- **school_subscriptions** - Active subscriptions

## Error Handling

All errors return appropriate HTTP status codes:

- **400** - Bad Request (missing/invalid fields)
- **401** - Unauthorized (missing token)
- **403** - Forbidden (no permission)
- **404** - Not Found
- **409** - Conflict (duplicate email)
- **500** - Server Error

**Error Response Format:**
```json
{
  "error": "Descriptive error message"
}
```

## Authentication Flow

1. User registers with email and password
2. System returns JWT token (valid for 30 days)
3. Include token in `Authorization: Bearer <token>` header for protected routes
4. Token validates user identity and school ownership

## Best Practices

- Store JWT tokens securely in the mobile app
- Refresh tokens when they expire
- Validate all user inputs on the backend
- Use HTTPS in production
- Change `JWT_SECRET` in production
- Use strong passwords for database

## Future Enhancements

- [ ] File upload for logos and stamps
- [ ] Payment gateway integration
- [ ] Backup and restore functionality
- [ ] Advanced reporting and analytics
- [ ] Bulk student import (CSV)
- [ ] Role-based access control (Admin, Teacher, Parent)
- [ ] Result management and grading
- [ ] Attendance tracking

## Support

For issues or questions, please contact the development team.
