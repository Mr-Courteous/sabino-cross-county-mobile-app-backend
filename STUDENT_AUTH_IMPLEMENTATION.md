# Student Authentication System - Implementation Summary

## Overview
Successfully implemented a complete student authentication system with the following features:
1. Student self-registration with password
2. Student login with JWT authentication
3. Student profile update (including password change)
4. Bulk student import with auto-generated password "1234567890"

## Database Changes

### Modified: `database/migrate.js`
- Added `password_hash VARCHAR(255)` field to the `students` table
- This allows students to have secure password authentication

## API Routes

### Public Routes (No Authentication Required)

#### 1. Student Registration
- **Endpoint**: `POST /api/students/register`
- **Purpose**: Allows students to create their own accounts
- **Required Fields**:
  - `firstName` (String)
  - `lastName` (String)
  - `email` (String)
  - `password` (String)
  - `schoolId` (Number)
- **Optional Fields**:
  - `registrationNumber` (String) - auto-generated if not provided
  - `phone` (String)
  - `dateOfBirth` (String, YYYY-MM-DD)
  - `gender` (String)
- **Response**: Returns student data and JWT token
- **Features**:
  - Email uniqueness validation
  - School existence validation
  - Auto-generates registration number with school prefix
  - Hashes password using bcrypt (10 salt rounds)
  - Returns JWT token valid for 24 hours

#### 2. Student Login
- **Endpoint**: `POST /api/students/login`
- **Purpose**: Authenticates students and provides access token
- **Required Fields**:
  - `identifier` (String) - student email or registration number (`email` is accepted for older clients)
  - `password` (String)
- **Response**: Returns student data (without password_hash) and JWT token
- **Features**:
  - Validates email or registration number and password
  - Initializes older staff-created accounts without a password hash when the default password is used
  - Returns school name along with student data
  - JWT token includes: `studentId`, `schoolId`, and `type: 'student'`

### Authenticated Routes (Require JWT Token)

#### 3. Student Profile Update
- **Endpoint**: `PUT /api/students/profile`
- **Purpose**: Allows students to update their own profile information
- **Authentication**: Requires JWT token with `type: 'student'`
- **Optional Fields**:
  - `firstName` (String)
  - `lastName` (String)
  - `email` (String)
  - `phone` (String)
  - `dateOfBirth` (String)
  - `gender` (String)
  - `photo` (String)
  - `currentPassword` (String) - required if changing password
  - `newPassword` (String)
- **Response**: Returns updated student data
- **Features**:
  - Validates student token type
  - Requires current password to change password
  - Hashes new password before storing
  - Email uniqueness validation
  - Transaction-based updates for data integrity

## Admin Routes (Modified)

### Bulk Student Import
- **Endpoint**: `POST /api/students/bulk`
- **Authentication**: Requires admin JWT token
- **Changes**:
  - Sets the default password "1234567890" for all imported students
  - Password is hashed using bcrypt before storage
  - Students can login immediately using their email and "1234567890"
  - Students can then change their password via the profile update endpoint

### Single Student Creation
- School staff-created students also receive the default password `1234567890`.
- Students can sign in with their registration number (or email, when provided).
- Student Portal → Preferences includes a change-password form.
- Older staff-created accounts without a password hash initialize on first login with the default password.

### Single Student Creation
- School staff-created students also receive the default password `1234567890`.
- Students can sign in with their registration number (or email, when provided).
- The Student Portal Preferences screen lets them change the default after signing in.
- Older staff-created accounts without a password hash are initialized with the default on their first login.

### All Other Admin Routes
Added authentication middleware to all admin-only routes:
- `POST /` - Create single student
- `GET /` - Get all students
- `GET /:studentId` - Get single student
- `PUT /:studentId` - Update student (admin)
- `DELETE /:studentId` - Delete student
- All enrollment management routes

## Security Features

1. **Password Hashing**: All passwords are hashed using bcrypt with 10 salt rounds
2. **JWT Authentication**: Tokens expire after 24 hours
3. **Token Type Validation**: Student profile endpoint validates token type
4. **Email Uniqueness**: Prevents duplicate student accounts
5. **School Validation**: Ensures students can only register for existing schools
6. **Password Change Security**: Requires current password to set new password

## JWT Token Structure

### Student Token
```json
{
  "studentId": 123,
  "schoolId": 456,
  "type": "student",
  "iat": 1234567890,
  "exp": 1234654290
}
```

## Usage Examples

### 1. Student Registration
```javascript
POST /api/students/register
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "password": "securePassword123",
  "schoolId": 1,
  "phone": "+1234567890",
  "dateOfBirth": "2005-01-15",
  "gender": "Male"
}
```

### 2. Student Login
```javascript
POST /api/students/login
Content-Type: application/json

{
  "identifier": "SCH-ABC123",
  "password": "securePassword123"
}
```

### 3. Student Profile Update
```javascript
PUT /api/students/profile
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "phone": "+9876543210",
  "currentPassword": "securePassword123",
  "newPassword": "newSecurePassword456"
}
```

### 4. Bulk Import (Admin)
```javascript
POST /api/students/bulk
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "students": [
    {
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane.smith@example.com",
      "classId": 1
    }
  ],
  "academicSession": "2024/2025"
}
```
**Note**: All staff-created students will have password "1234567890" by default. Share it together with the student's registration number and encourage them to change it after signing in.

## Migration Required

To apply the database changes, run:
```bash
npm run migrate
```

This will add the `password_hash` field to the existing `students` table.

## Next Steps

1. **Run Migration**: Execute the migration to add the password_hash field
2. **Update Frontend**: Connect the "Students' Login" button to the new `/api/students/login` endpoint
3. **Create Student Dashboard**: Build a student-specific dashboard/portal
4. **Password Reset**: Consider adding a "Forgot Password" flow for students
5. **Email Verification**: Optional - add email verification for new student registrations

## Important Notes

- Students imported via bulk will have the default password "1234567890"
- Students should be encouraged to change their password after first login
- The JWT secret should be properly configured in environment variables
- All student routes use the same authentication middleware as admin routes
- Student tokens are distinguished by the `type: 'student'` field in the JWT payload
