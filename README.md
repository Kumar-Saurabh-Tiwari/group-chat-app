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
  - `services/s3-storage.js` — authenticated S3 uploads, upload verification, and private media links
  - `services/archive-chat.js` — transactional, batched archiving of old messages and attachments

## Run locally

1. Make sure Node.js 18+ and MySQL are installed and running.
2. Initialize the database tables by running `backend/schema.sql` in MySQL. Run it again on an existing database to create any missing chat, archive, and group tables and the archive index.
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

## S3 media uploads

Set `AWS_REGION` and either `S3_BUCKET` or `AWS_S3_BUCKET_NAME` in `backend/.env`. For local development, set both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; alternatively, the AWS SDK uses its default credential provider chain (such as an IAM role or configured AWS profile). Do not commit credentials.

The chat uses authenticated presigned POSTs to upload files directly to S3, verifies each upload before saving the message, and generates short-lived signed links for private media. Messages can include up to five files (25 MiB each), with or without text. Supported file types are listed in `backend/services/s3-storage.js`.

Keep S3 Block Public Access enabled and grant the app identity only `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<bucket-name>/chat-uploads/*`. In the S3 bucket's **Permissions → Cross-origin resource sharing (CORS)** settings, add a rule like this, replacing the origins with the exact origins used to open the app (scheme, host, and port must match):

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD", "POST"],
    "AllowedOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

For an existing database, run `backend/schema.sql` again against the database selected by `DB_NAME`. It creates any missing attachment and archive tables and adds the archive-selection index without replacing existing data.

Attachments are shared through the same group, personal, and conversation message permissions as their message.

## Gemini AI suggestions

Set `GEMINI_API_KEY` in `backend/.env`; optionally set `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite`). The authenticated `/api/ai/suggestions` endpoint uses Google's `@google/genai` SDK and Interactions API to suggest short draft continuations and quick replies. Requests set `store: false`. Suggestions are debounced while typing, appear above the composer, and can be selected to fill the draft. The endpoint checks conversation access, limits each user to 30 requests per minute, and uses recent messages plus the user's own recent messages for context and tone. The API key remains on the backend; the relevant recent chat text is sent to Google Gemini to generate suggestions. AI suggestions require internet access and an active Gemini API key/quota.

## Nightly message archiving

The backend runs a cron job every night at midnight UTC by default. It moves messages older than 24 hours from `chat_messages` to `archived_chat_messages` in batches of 1,000, moves their attachment metadata to `archived_chat_message_attachments`, then deletes the originals in the same transaction. Batch transactions keep the live message table smaller without losing media or partially moving a message. Conversation history and group previews continue to include archived messages.

Set `ARCHIVE_TIMEZONE` in `backend/.env` to an IANA timezone (for example, `America/Los_Angeles`) to use a different local midnight. For existing databases, run `backend/schema.sql` again to create the archive tables and add the archive-selection index; the migration is safe to rerun.

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
- `POST /api/ai/suggestions` — generates authenticated, context-aware draft continuations or quick replies with Gemini
- Socket.IO — the chat page loads the Socket.IO client from `/socket.io/socket.io.js` and connects to the same server with the session JWT. The backend verifies the JWT during the Socket.IO handshake (HS256, non-empty user ID/name, and required expiration), then makes the verified identity available as `socket.data.user`. Expired or invalid tokens are rejected, and an active socket is disconnected when its token expires. The client joins/leaves conversations with `conversation:join` / `conversation:leave`; saved messages are delivered as `message:new` events. `conversation:presence` reports the number of distinct authenticated users currently connected to a conversation. Total membership is not tracked.
- Group chats — groups are private until a member shares their invite code. Joining adds the authenticated user to the group; group message history, sending, and Socket.IO room entry are restricted to members. The client joins each of its group rooms after connecting so messages arrive in real time even when another conversation is selected. Group-room broadcasts use `io.in(room).emit(...)`; message history remains available after reconnecting.
- Personal Socket.IO messages — search for recipients with `GET /api/users/search` or look them up with `GET /api/users/lookup`. Every authenticated socket joins its own user room, so `POST /api/personal-messages` can notify the recipient immediately even when they have not opened the conversation. `GET /api/personal-conversations` restores saved chats and history after refresh. Sender identity is taken from the authenticated JWT, not the request body.

Passwords are hashed with bcrypt before storage. Successful login returns a one-day JWT.
Chat messages require the `chat_messages`, `archived_chat_messages`, and attachment tables from `backend/schema.sql`; run that schema against the configured database before using chat. New messages are saved to `chat_messages`, while older messages remain available from the archive.
