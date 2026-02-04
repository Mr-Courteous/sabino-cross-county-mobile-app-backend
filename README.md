# sabino-server

Minimal Express backend scaffold for local development.

Endpoints:
- `GET /health` — basic health check
- `GET /students` — list students (in-memory)
- `POST /students` — create student (JSON body: `{ "name": "...", "age": 12 }`)

Quick start:

```bash
cd server
npm install
npm run start
```
