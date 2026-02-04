# Quick Start Guide

## Getting Started in 5 Minutes

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database
Make sure PostgreSQL is running, then:
```bash
# Create database (if not exists)
# psql -U postgres -c "CREATE DATABASE sabino_schools;"

# Run migrations
npm run migrate
```

### 3. Configure Environment
Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Edit `.env` with your database credentials.

### 4. Start Development Server
```bash
npm run dev
```

Server runs on `http://localhost:3000`

## Testing API Endpoints

### Using cURL

**1. Register User:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@school.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**2. Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@school.com",
    "password": "password123"
  }'
```

Save the returned `token` for next requests.

**3. Create School:**
```bash
curl -X POST http://localhost:3000/api/schools \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "name": "Government Secondary School",
    "address": "123 Main Street",
    "city": "Lagos"
  }'
```

**4. Create Academic Year:**
```bash
curl -X POST http://localhost:3000/api/schools/1/academic-years \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "startYear": 2024,
    "endYear": 2025,
    "isCurrent": true
  }'
```

**5. Create Class:**
```bash
curl -X POST http://localhost:3000/api/schools/1/academic-years/1/classes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "className": "JSS1",
    "formTeacher": "Mr. Johnson",
    "capacity": 50
  }'
```

**6. Create Student:**
```bash
curl -X POST http://localhost:3000/api/schools/1/students \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "classId": 1,
    "firstName": "Chioma",
    "lastName": "Okafor",
    "admissionNumber": "GSS/2024/001",
    "gender": "Female",
    "parentName": "Mrs. Okafor",
    "parentPhone": "+2348012345678"
  }'
```

### Using Postman

1. Import the collection from `postman_collection.json` (if available)
2. Set environment variable `token` after login
3. Run requests from the collection

### Using REST Client (VS Code)

Create `test.http` file:
```http
### Health Check
GET http://localhost:3000/health

### Register
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "email": "test@school.com",
  "password": "password123",
  "firstName": "Test",
  "lastName": "User"
}

### Login (use token from response in next requests)
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "test@school.com",
  "password": "password123"
}

### Create School
POST http://localhost:3000/api/schools
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN

{
  "name": "Test School",
  "city": "Lagos"
}
```

## Project Structure

```
Server/
├── index.js                    # Main app file
├── package.json               
├── .env.example               # Environment template
├── database/
│   ├── db.js                 # Database connection
│   └── migrate.js            # Migration script
├── controllers/
│   ├── authController.js
│   ├── schoolController.js
│   ├── academicYearController.js
│   ├── classController.js
│   ├── studentsController.js
│   ├── preferencesController.js
│   └── subscriptionController.js
├── routes/
│   ├── auth.js
│   ├── schools.js
│   ├── academicYears.js
│   ├── classes.js
│   ├── students.js
│   ├── preferences.js
│   └── subscriptions.js
└── middleware/
    └── auth.js               # Authentication & authorization
```

## Common Issues

### Database Connection Error
- Ensure PostgreSQL is running
- Check DB credentials in `.env`
- Verify database `sabino_schools` exists

### Token Expired
- Tokens expire after 30 days
- Login again to get a new token

### Port Already in Use
Change `PORT` in `.env` file

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_NAME | Database name | sabino_schools |
| DB_USER | Database user | postgres |
| DB_PASSWORD | Database password | (required) |
| PORT | Server port | 3000 |
| JWT_SECRET | Token signing key | (required) |
| NODE_ENV | Environment | development |

## Next Steps

1. Read [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for detailed endpoint docs
2. Integrate with your mobile app
3. Set up subscription payment processing
4. Add file upload functionality for logos/stamps
5. Implement role-based access control

Happy coding! 🚀
