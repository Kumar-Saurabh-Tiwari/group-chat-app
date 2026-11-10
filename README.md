# GroupChat

Group Chat App

## Project structure

- `frontend/` — home, login, registration, and interactive chat demo pages
- `backend/` — Express API, MySQL schema, and environment settings

## Run locally

1. Make sure Node.js 18+ and MySQL are installed and running.
2. Initialize the database tables by running `backend/schema.sql` in MySQL (or re-run it to add the chat message table to an existing database).
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
- `GET /api/auth/me` — validates the `Authorization: Bearer <token>` header and returns the signed-in user
- `GET /api/messages` — returns all messages with sender IDs (bearer token required); optionally filter with `?conversationId=<id>`
- `POST /api/messages` — saves `{ "conversationId", "message" }` for the authenticated user (bearer token required)
- `WS /ws` — WebSocket service; first send `{ "type": "authenticate", "token": "<JWT>" }`, then subscribe with `{ "type": "subscribe", "conversationId": "<id>" }`. Persisted messages are delivered as `{ "type": "message", "message": { ... } }` events to subscribers. Use `{ "type": "unsubscribe", "conversationId": "<id>" }` to leave a conversation.

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
Chat messages require the `chat_messages` table from `backend/schema.sql`; run that schema against the configured database before using chat.
The WebSocket service broadcasts messages persisted by the HTTP API; browser connection and live-message rendering are not wired into the frontend yet.
