# GroupChat

Group Chat App

## Project structure

- `frontend/` — home, login, and registration pages
- `backend/` — Express API, MySQL schema, and environment settings

## Run locally

1. Make sure Node.js 18+ and MySQL are installed and running.
2. Create the database and users table by running `backend/schema.sql` in MySQL.
3. In `backend/`, copy `.env.example` to `.env` and set your MySQL password.
4. Set `JWT_SECRET` in `backend/.env` to a random secret of at least 32 characters. Generate one with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. In a terminal, run:
   ```powershell
   cd backend
   npm install
   cd ..\frontend
   npm start
   ```
6. Open `http://localhost:3000`. This start command serves the frontend and auth API together; do not use a separate static/Live Server server.

## API

- `POST /api/auth/signup` — `{ "name", "email", "phone", "password" }`
- `POST /api/auth/login` — `{ "identifier", "password" }`, where identifier is an email or phone number

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
