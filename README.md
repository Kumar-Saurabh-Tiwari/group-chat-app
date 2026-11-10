# GroupChat

Group Chat App

## Project structure

- `frontend/` — home, login, registration, and interactive chat demo pages
- `backend/` — Express API, MySQL schema, and environment settings
  - `socket-io/index.js` — configures Socket.IO, authentication middleware, and event handlers
  - `socket-io/middleware.js` — verifies JWTs and attaches the authenticated user to each socket
  - `socket-io/handlers/chat.js` — conversation room, presence, and disconnect events

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
- Socket.IO — the chat page loads the Socket.IO client from `/socket.io/socket.io.js` and connects to the same server with the session JWT. The backend verifies the JWT during the Socket.IO handshake (HS256, non-empty user ID/name, and required expiration), then makes the verified identity available as `socket.data.user`. Expired or invalid tokens are rejected, and an active socket is disconnected when its token expires. The client joins/leaves conversations with `conversation:join` / `conversation:leave`; saved messages are delivered as `message:new` events. `conversation:presence` reports the number of distinct authenticated users currently connected to a conversation. Total membership is not tracked.

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
Chat messages require the `chat_messages` table from `backend/schema.sql`; run that schema against the configured database before using chat.
Messages continue to be persisted through the HTTP API; Socket.IO delivers each saved message to clients currently in that conversation.
