# Sabino Backend Server

A comprehensive backend API for managing schools, academic years, classes, students, and subscriptions. Built with Node.js, Express, and PostgreSQL.

## 🎯 Features

- ✅ **User Authentication** - Secure registration and login with JWT
- ✅ **School Management** - Create and manage multiple schools
- ✅ **Academic Years** - Support for up to 10 years per school  
- ✅ **Classes** - Manage JSS1-SSS3 classes with form teachers
- ✅ **Student Management** - Complete CRUD operations with parent info
- ✅ **School Preferences** - Custom logos, stamps, themes per school
- ✅ **Subscription System** - Flexible plans with expiry management
- ✅ **Authorization** - School ownership verification and access control

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup database (PostgreSQL must be running)
npm run migrate

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Start server
npm start      # Production
npm run dev    # Development
```

Server runs on `http://localhost:3000`

## 📚 Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - Complete endpoint reference
- **[Quick Start Guide](./QUICKSTART.md)** - Testing and integration examples
- **[Postman Collection](./postman_collection.json)** - Ready-to-import collection

## 🛠 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 14+ | Runtime |
| Express | 4.22+ | Web framework |
| PostgreSQL | 12+ | Database |
| JWT | 9.1+ | Authentication |
| bcryptjs | 2.4+ | Password hashing |

## 📚 Core Functionality

### 1. School Registration
Schools can register with their details (name, address, city, state, country).

### 2. Academic Year Management
- Store up to 10 academic years per school
- Set current academic year
- Update per term or all at once

### 3. Class Management
Support for Nigerian school structure:
- **Junior Secondary**: JSS1, JSS2, JSS3
- **Senior Secondary**: SSS1, SSS2, SSS3

### 4. Student Management
Complete student records with:
- Personal info (name, DOB, gender)
- Admission number
- Parent contact information
- Class assignment

### 5. School Preferences
Customize each school with:
- Logo and stamp uploads (URLs)
- Theme color
- Header/footer text
- Custom settings in JSON

### 6. Subscription System
- Multiple subscription tiers
- Plan-based feature access
- Automatic expiry management
- Auto-renewal support

## 📋 API Endpoints Overview

```
POST   /api/auth/register              Register new user
POST   /api/auth/login                 Login user

POST   /api/schools                    Create school
GET    /api/schools                    Get user's schools
GET    /api/schools/:id                Get school details
PUT    /api/schools/:id                Update school
DELETE /api/schools/:id                Delete school

POST   /api/schools/:id/academic-years              Create academic year
GET    /api/schools/:id/academic-years              Get academic years
PUT    /api/schools/:id/academic-years/:yid/set-current  Set current year
DELETE /api/schools/:id/academic-years/:yid        Delete year

POST   /api/schools/:id/academic-years/:yid/classes        Create class
GET    /api/schools/:id/academic-years/:yid/classes        Get classes
PUT    /api/schools/:id/academic-years/:yid/classes/:cid   Update class
DELETE /api/schools/:id/academic-years/:yid/classes/:cid   Delete class

POST   /api/schools/:id/students       Create student
GET    /api/schools/:id/students       Get all students
GET    /api/schools/:id/students/:sid  Get student
PUT    /api/schools/:id/students/:sid  Update student
DELETE /api/schools/:id/students/:sid  Delete student

GET    /api/schools/:id/preferences    Get preferences
PUT    /api/schools/:id/preferences    Update preferences

GET    /api/subscriptions/plans        Get plans
POST   /api/subscriptions/:id/subscribe        Subscribe to plan
GET    /api/subscriptions/:id/current  Get active subscription
PUT    /api/subscriptions/:id/:subid/cancel    Cancel subscription
```

## 🔒 Security

- JWT token authentication (30-day expiry)
- Password hashing with bcryptjs
- School ownership verification
- SQL injection protection
- Input validation on all endpoints

## 📁 Project Structure

```
Server/
├── index.js
├── package.json
├── .env.example
├── database/
│   ├── db.js               # Connection pool
│   └── migrate.js          # Schema creation
├── controllers/            # Business logic
├── routes/                 # API routes
└── middleware/             # Auth & validation
```

## 🧪 Quick Test

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@school.com","password":"pass123","firstName":"John","lastName":"Doe"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@school.com","password":"pass123"}'

# Create school (use token from login)
curl -X POST http://localhost:3000/api/schools \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test School","city":"Lagos"}'
```

## 🚀 Deployment

Set these for production:
- `NODE_ENV=production`
- Strong `JWT_SECRET`
- Database backups enabled
- HTTPS configured
- Error tracking setup

## 📞 Support

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) and [QUICKSTART.md](./QUICKSTART.md) for detailed guides.

---

**Start here**: [QUICKSTART.md](./QUICKSTART.md)
