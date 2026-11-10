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
  - `services/s3-storage.js` — isolated S3 presigned-upload service (not yet connected to chat routes)

## Run locally

1. Make sure Node.js 18+ and MySQL are installed and running.
2. Initialize the database tables by running `backend/schema.sql` in MySQL. Run it again on an existing database to create the group and group-membership tables.
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

## S3 media uploads (prepared, not connected)

The backend has an isolated service for generating short-lived S3 presigned POST forms. It is not imported by the server, exposed as an API route, or required for startup, so the existing chat continues to work without AWS configuration.

When you are ready to connect uploads:

1. Create a private S3 bucket and set `AWS_REGION` and `S3_BUCKET` in `backend/.env`.
2. Provide AWS credentials using the AWS SDK credential provider chain (prefer an IAM role; for local development, use a configured AWS profile or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the ignored `.env` file).
3. Give the app identity only the required bucket upload permissions, and keep S3 Block Public Access enabled.
4. Import `createS3Storage` from `backend/services/s3-storage.js` in a future authenticated upload route. Call `createUploadForm({ userId, contentType })` with the authenticated user ID; return the form URL, fields, and object key to the client. The policy limits uploads to 25 MiB and the supported content types. The browser uploads the file directly to S3 using the returned URL and fields.

The service validates IDs and file types, generates object keys itself, and does not accept a caller-supplied bucket or key. An API route, database attachment records, download access, and frontend integration still need to be added before media can be shared in chat.

## API

- `POST /api/auth/signup` — `{ "name", "email", "phone", "password" }`
- `POST /api/auth/login` — `{ "identifier", "password" }`, where identifier is an email or phone number
- `GET /api/auth/me` — validates the `Authorization: Bearer <token>` header and returns the signed-in user
- `GET /api/users/lookup?email=<email>` — finds another registered user for an authenticated personal chat and returns the shared room ID
- `GET /api/users/search?q=<name-or-email-fragment>` — finds up to eight other accounts for the authenticated user's debounced chat search
- `GET /api/personal-conversations` — returns the signed-in user's saved personal chats and message history
- `GET /api/personal-messages?recipientId=<user ID>` — refreshes saved messages for a personal chat
- `POST /api/personal-messages` — saves `{ "recipientId", "message" }` for the authenticated user and notifies connected chat participants
- `GET /api/messages` — returns saved messages for non-group conversations with sender IDs (bearer token required); optionally filter with `?conversationId=<id>`
- `POST /api/messages` — saves `{ "conversationId", "message" }` for a non-group conversation (bearer token required)
- `GET /api/groups` — lists groups the signed-in user has joined, including their invite codes and recent-message previews
- `POST /api/groups` — creates a private group from `{ "name" }`; the creator is automatically added and receives a shareable invite code
- `POST /api/groups/join` — joins a private group using `{ "inviteCode" }`
- `GET /api/groups/:groupId/messages` — loads saved messages for a group the user has joined
- `POST /api/groups/:groupId/messages` — saves a group message for a member and broadcasts it to clients in that group room
- Socket.IO — the chat page loads the Socket.IO client from `/socket.io/socket.io.js` and connects to the same server with the session JWT. The backend verifies the JWT during the Socket.IO handshake (HS256, non-empty user ID/name, and required expiration), then makes the verified identity available as `socket.data.user`. Expired or invalid tokens are rejected, and an active socket is disconnected when its token expires. The client joins/leaves conversations with `conversation:join` / `conversation:leave`; saved messages are delivered as `message:new` events. `conversation:presence` reports the number of distinct authenticated users currently connected to a conversation. Total membership is not tracked.
- Group chats — groups are private until a member shares their invite code. Joining adds the authenticated user to the group; group message history, sending, and Socket.IO room entry are restricted to members. The client joins each of its group rooms after connecting so messages arrive in real time even when another conversation is selected. Group-room broadcasts use `io.in(room).emit(...)`; message history remains available after reconnecting.
- Personal Socket.IO messages — search for recipients with `GET /api/users/search` or look them up with `GET /api/users/lookup`. Every authenticated socket joins its own user room, so `POST /api/personal-messages` can notify the recipient immediately even when they have not opened the conversation. `GET /api/personal-conversations` restores saved chats and history after refresh. Sender identity is taken from the authenticated JWT, not the request body.

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
Chat messages require the `chat_messages` table from `backend/schema.sql`; run that schema against the configured database before using chat. Group and personal messages are persisted in that table.
