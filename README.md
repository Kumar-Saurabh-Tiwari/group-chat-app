# GroupChat

Group Chat App

## Project structure

- `frontend/` — home, login, registration, and interactive chat demo pages
- `backend/` — Express API, MySQL schema, and environment settings
  - `socket-io/index.js` — configures Socket.IO, authentication middleware, and event handlers
  - `socket-io/middleware.js` — verifies JWTs and attaches the authenticated user to each socket
  - `socket-io/handlers/chat.js` — conversation room, presence, and disconnect events
  - `socket-io/handlers/personalChat.js` — authenticated personal rooms and direct message events
  - `socket-io/personal-room.js` — deterministic room IDs shared by each pair of users

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
- `GET /api/users/lookup?email=<email>` — finds another registered user for an authenticated personal chat and returns the shared room ID
- `GET /api/users/search?q=<name-or-email-fragment>` — finds up to eight other accounts for the authenticated user's debounced chat search
- `GET /api/personal-conversations` — returns the signed-in user's saved personal chats and message history
- `GET /api/personal-messages?recipientId=<user ID>` — refreshes saved messages for a personal chat
- `POST /api/personal-messages` — saves `{ "recipientId", "message" }` for the authenticated user and notifies connected chat participants
- `GET /api/messages` — returns all messages with sender IDs (bearer token required); optionally filter with `?conversationId=<id>`
- `POST /api/messages` — saves `{ "conversationId", "message" }` for the authenticated user (bearer token required)
- Socket.IO — the chat page loads the Socket.IO client from `/socket.io/socket.io.js` and connects to the same server with the session JWT. The backend verifies the JWT during the Socket.IO handshake (HS256, non-empty user ID/name, and required expiration), then makes the verified identity available as `socket.data.user`. Expired or invalid tokens are rejected, and an active socket is disconnected when its token expires. The client joins/leaves conversations with `conversation:join` / `conversation:leave`; saved messages are delivered as `message:new` events. `conversation:presence` reports the number of distinct authenticated users currently connected to a conversation. Total membership is not tracked.
- Personal Socket.IO messages — search for recipients with `GET /api/users/search` or look them up with `GET /api/users/lookup`. Every authenticated socket joins its own user room, so `POST /api/personal-messages` can notify the recipient immediately even when they have not opened the conversation. `GET /api/personal-conversations` restores saved chats and history after refresh. Sender identity is taken from the authenticated JWT, not the request body.

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
Chat messages require the `chat_messages` table from `backend/schema.sql`; run that schema against the configured database before using chat. Group and personal messages are persisted in that table.
