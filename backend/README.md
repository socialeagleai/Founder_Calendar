# Founder Calendar — Backend

FastAPI + PostgreSQL backend for the Founder Calendar frontend. It mirrors every
operation in the frontend's Zustand store (`frontend/src/lib/store.ts`) as a REST API
backed by a real database, including email/password auth, **Sign in with Google**,
organizations, team management, and calendar notes.

## Stack
- **FastAPI** (Python 3.11) + Uvicorn
- **PostgreSQL 16** in Docker
- **SQLAlchemy 2.0** ORM (tables auto-created on startup)
- **JWT** bearer auth (`python-jose`) + **bcrypt** password hashing
- **google-auth** for verifying Google ID tokens

## Quick start

```powershell
cd backend
copy .env.example .env        # already provided; edit secrets as needed
.\start.ps1                   # starts Postgres in Docker, venv, and the API
```

Or manually:

```powershell
docker compose up -d db
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

- API:           http://127.0.0.1:8000
- Interactive docs (Swagger): http://127.0.0.1:8000/docs
- Optional DB admin UI: `docker compose --profile tools up -d pgadmin` → http://localhost:5050

> **Port note:** the host already runs a local Postgres on `5432`, so this stack maps
> the container to host port **5433**. The Docker project name is pinned to
> `founder_calendar` to avoid volume collisions with other `backend/` directories.

## Verify it works

```powershell
.\.venv\Scripts\python.exe smoke_test.py   # 32 end-to-end assertions across every endpoint
```

## API surface

All responses use **camelCase** to match the frontend TypeScript types. Protected
routes require `Authorization: Bearer <token>`.

| Frontend store action            | Method & path                       |
|----------------------------------|-------------------------------------|
| `signup(name,email,password)`    | `POST /api/auth/signup`             |
| `login(email,password)`          | `POST /api/auth/login`              |
| `loginWithGoogle()`              | `POST /api/auth/google`             |
| `logout()`                       | `POST /api/auth/logout`             |
| (current user)                   | `GET  /api/auth/me`                 |
| `updateProfile(name,email,pwd?)` | `PATCH /api/auth/profile`           |
| `createOrg(name,desc)`           | `POST /api/organization`            |
| (load org)                       | `GET  /api/organization`            |
| `updateOrg(name,desc)`           | `PATCH /api/organization`           |
| `deleteOrg()`                    | `DELETE /api/organization`          |
| (load team)                      | `GET  /api/team`                    |
| `inviteMember(name,email,role)`  | `POST /api/team`                    |
| `updateMemberRole(id,role)`      | `PATCH /api/team/{id}`              |
| `removeMember(id)`               | `DELETE /api/team/{id}`             |
| (load notes)                     | `GET  /api/notes`                   |
| `saveNote(date,content)`         | `POST /api/notes`                   |
| `saveNote(date,content,id)`      | `PUT  /api/notes/{id}`              |
| `deleteNote(id)`                 | `DELETE /api/notes/{id}`            |

Creating an organization automatically adds the current user as an **Owner**
team member (Active). Deleting an organization cascades to its team and notes.

## Sign in with Google

`POST /api/auth/google` accepts an optional `{ "credential": "<google-id-token>" }`:

- **With a credential + `GOOGLE_CLIENT_ID` set** in `.env`: the token is verified
  with Google and the matching account is created/used.
- **Without a credential** (or no client ID configured): a demo Google user
  (`founder@google.demo`) is created/used — this mirrors the current frontend stub
  and works with zero OAuth setup. Set `GOOGLE_CLIENT_ID` to enable real verification.

To enable real Google sign-in: create an OAuth 2.0 Web Client in Google Cloud Console,
put its client ID in `GOOGLE_CLIENT_ID`, and have the frontend send the ID token from
Google Identity Services as `credential`.

## Connecting the frontend

A typed API client is provided at `frontend/src/lib/api.ts`, and `frontend/.env`
sets `VITE_API_URL=http://127.0.0.1:8000`. See the comment block at the top of
`api.ts` for swapping the localStorage Zustand store over to the live backend.

## Environment variables (`.env`)

| Var                           | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `DATABASE_URL`                | SQLAlchemy DSN (defaults to the Docker Postgres)     |
| `JWT_SECRET`                  | Signing secret for access tokens — change it         |
| `JWT_ALGORITHM`               | Default `HS256`                                      |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime (default 7 days)                      |
| `GOOGLE_CLIENT_ID`            | Google OAuth web client ID (blank = demo mode)       |
| `CORS_ORIGINS`                | Comma-separated allowed frontend origins             |
