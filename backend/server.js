const path = require("path");
const http = require("http");
const { randomBytes } = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const { CronJob } = require("cron");
const createSocketServer = require("./socket-io");
const personalRoomId = require("./socket-io/personal-room");
const { archiveOldMessages } = require("./services/archive-chat");
const { generateSuggestions } = require("./services/gemini-suggestions");
const {
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  createS3Storage
} = require("./services/s3-storage");

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const frontendPath = path.join(__dirname, "..", "frontend");

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 characters in backend/.env");
}

const database = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "group_chat",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
const s3Storage = createS3Storage();
const CHAT_MESSAGE_SOURCE = `(
  SELECT id, conversation_id, user_id, message, created_at FROM chat_messages
  UNION ALL
  SELECT id, conversation_id, user_id, message, created_at FROM archived_chat_messages
)`;
const aiSuggestionRequests = new Map();
const AI_SUGGESTION_LIMIT = 30;
const AI_SUGGESTION_WINDOW_MS = 60 * 1000;

app.use(express.json({ limit: "10kb" }));

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, "");
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const digits = normalizePhone(phone);
  return /^\+?[0-9\s().-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15;
}

function isValidPassword(password) {
  return Buffer.byteLength(password, "utf8") >= 8 && Buffer.byteLength(password, "utf8") <= 72;
}

function isDatabaseUnavailable(error) {
  return ["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "PROTOCOL_CONNECTION_LOST"].includes(error.code);
}

function getChatDatabaseError(error, fallback) {
  if (isDatabaseUnavailable(error)) {
    return {
      status: 503,
      message: "The database is unavailable. Check the backend database settings."
    };
  }
  if (
    error.code === "ER_NO_SUCH_TABLE" &&
    /chat_message_attachments|archived_chat_messages|archived_chat_message_attachments/i.test(error.message)
  ) {
    return {
      status: 503,
      message: "A chat message or archive table is missing. Run backend/schema.sql against the configured database."
    };
  }
  return { status: 500, message: fallback };
}

function parseMessagePayload(body, userId) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (body.message !== undefined && typeof body.message !== "string") {
    return { error: "Message must be text." };
  }
  if (message.length > 2000) {
    return { error: "Message must be 2000 characters or fewer." };
  }

  const rawAttachments = body.attachments === undefined ? [] : body.attachments;
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { error: `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.` };
  }
  if (!message && rawAttachments.length === 0) {
    return { error: "Write a message or attach at least one file." };
  }

  const attachments = [];
  for (const attachment of rawAttachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      return { error: "One of the attachments is invalid." };
    }

    const name = typeof attachment.name === "string" ? attachment.name.trim().split(/[\\/]/).pop() : "";
    const contentType = attachment.contentType;
    const size = attachment.size;
    const key = attachment.key;
    const keyPattern = new RegExp(`^chat-uploads/${userId}/[0-9a-f-]{36}$`);
    if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
      return { error: "Attachment names must be between 1 and 255 printable characters." };
    }
    if (typeof key !== "string" || !keyPattern.test(key)) {
      return { error: "One of the uploaded files is invalid." };
    }
    if (typeof contentType !== "string" || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return { error: "One of the selected file types is not supported." };
    }
    if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
      return { error: "Files must be 25 MB or smaller." };
    }
    attachments.push({ key, name, contentType, size });
  }

  return { message, attachments };
}

async function saveMessage({ conversationId, userId, message, attachments }) {
  await Promise.all(attachments.map((attachment) => s3Storage.verifyUploadedObject({
    userId: String(userId),
    key: attachment.key,
    contentType: attachment.contentType,
    size: attachment.size
  })));

  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO chat_messages (conversation_id, user_id, message) VALUES (?, ?, ?)",
      [conversationId, userId, message]
    );
    for (const attachment of attachments) {
      await connection.execute(
        `INSERT INTO chat_message_attachments
           (message_id, object_key, file_name, content_type, file_size)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, attachment.key, attachment.name, attachment.contentType, attachment.size]
      );
    }
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function addAttachmentsToMessages(messages) {
  if (messages.length === 0) return messages;
  const messageIds = messages.map(({ id }) => id);
  const placeholders = messageIds.map(() => "?").join(", ");
  const [rows] = await database.execute(
    `SELECT id, message_id, object_key, file_name, content_type, file_size
     FROM (
       SELECT id, message_id, object_key, file_name, content_type, file_size FROM chat_message_attachments
       UNION ALL
       SELECT id, message_id, object_key, file_name, content_type, file_size FROM archived_chat_message_attachments
     ) AS attachments
     WHERE message_id IN (${placeholders})
     ORDER BY id`,
    messageIds
  );
  const attachmentsByMessage = new Map(messageIds.map((id) => [String(id), []]));
  await Promise.all(rows.map(async (row) => {
    attachmentsByMessage.get(String(row.message_id)).push({
      id: String(row.id),
      name: row.file_name,
      contentType: row.content_type,
      size: row.file_size,
      url: await s3Storage.createDownloadUrl({
        key: row.object_key,
        contentType: row.content_type,
        fileName: row.file_name
      })
    });
  }));
  return messages.map((message) => ({
    ...message,
    attachments: attachmentsByMessage.get(String(message.id))
  }));
}

function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token, ...extraParts] = authorization.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== "bearer" || !token || extraParts.length > 0) {
    return res.status(401).json({ error: "A valid bearer token is required." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) {
      return res.status(401).json({ error: "A valid bearer token is required." });
    }

    req.authUser = { id: payload.sub, name: payload.name };
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: "Your session is invalid or has expired. Please log in again." });
    }

    console.error("Token verification failed:", error);
    return res.status(500).json({ error: "Unable to verify your session." });
  }
}

app.post("/api/uploads/presign", requireAuth, async (req, res) => {
  const { contentType } = req.body || {};
  if (typeof contentType !== "string" || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    return res.status(400).json({ error: "This file type is not supported." });
  }

  try {
    return res.json(await s3Storage.createUploadForm({
      userId: String(req.authUser.id),
      contentType
    }));
  } catch (error) {
    console.error("Creating file upload form failed:", error);
    const configurationError = /S3_BUCKET|AWS_REGION|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(error.message);
    return res.status(configurationError ? 503 : 500).json({
      error: configurationError
        ? "File uploads are not configured. Set AWS_REGION, S3_BUCKET, and both AWS credentials in backend/.env."
        : "Unable to prepare the file upload."
    });
  }
});

app.post("/api/ai/suggestions", requireAuth, async (req, res) => {
  const { conversationId, type, draft = "" } = req.body || {};
  if (
    typeof conversationId !== "string" ||
    typeof type !== "string" ||
    (type !== "predictive" && type !== "replies") ||
    typeof draft !== "string" ||
    draft.length > 500
  ) {
    return res.status(400).json({ error: "A valid conversation, suggestion type, and draft are required." });
  }

  const userId = String(req.authUser.id);
  const personalMatch = /^personal:([0-9]{1,20}):([0-9]{1,20})$/.exec(conversationId);
  const isPersonalConversation = Boolean(
    personalMatch &&
    personalMatch[1] !== personalMatch[2] &&
    (personalMatch[1] === userId || personalMatch[2] === userId)
  );
  try {
    const isSharedConversation = await isAuthorizedConversation(userId, conversationId);
    if (!isPersonalConversation && !isSharedConversation) {
      return res.status(403).json({ error: "You cannot request suggestions for this conversation." });
    }
    if (isPersonalConversation) {
      const recipientId = personalMatch[1] === userId ? personalMatch[2] : personalMatch[1];
      if (!(await isValidRecipientId(recipientId))) {
        return res.status(404).json({ error: "The other participant was not found." });
      }
    }

    const now = Date.now();
    const requestWindow = aiSuggestionRequests.get(userId);
    if (!requestWindow || now - requestWindow.startedAt >= AI_SUGGESTION_WINDOW_MS) {
      if (aiSuggestionRequests.size >= 10000) {
        for (const [trackedUserId, window] of aiSuggestionRequests) {
          if (now - window.startedAt >= AI_SUGGESTION_WINDOW_MS) {
            aiSuggestionRequests.delete(trackedUserId);
          }
        }
      }
      aiSuggestionRequests.set(userId, { startedAt: now, count: 1 });
    } else if (requestWindow.count >= AI_SUGGESTION_LIMIT) {
      return res.status(429).json({ error: "AI suggestions are temporarily rate-limited. Please try again shortly." });
    } else {
      requestWindow.count += 1;
    }

    const [rows] = await database.execute(
      `SELECT user_id, message
       FROM ${CHAT_MESSAGE_SOURCE} AS messages
       WHERE conversation_id = ? AND message <> ''
       ORDER BY created_at DESC, id DESC
       LIMIT 12`,
      [conversationId]
    );
    const recentMessages = rows.reverse().map((row) => ({
      isUser: String(row.user_id) === userId,
      text: row.message
    }));
    if (type === "replies" && recentMessages.at(-1)?.isUser !== false) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await generateSuggestions({
      type,
      draft,
      messages: recentMessages,
      ownMessages: recentMessages.filter(({ isUser }) => isUser).slice(-4).map(({ text }) => text)
    });
    return res.json({ suggestions });
  } catch (error) {
    if (error.code === "GEMINI_NOT_CONFIGURED") {
      return res.status(503).json({ error: "AI suggestions are not configured. Set GEMINI_API_KEY in backend/.env." });
    }
    console.error("Generating AI suggestions failed:", error.code || error.message);
    if (error.code === "GEMINI_TIMEOUT") {
      return res.status(504).json({ error: "AI suggestions took too long. Please try again." });
    }
    if (error.code === "GEMINI_API_ERROR") {
      return res.status(error.status >= 400 && error.status < 500 ? 502 : 503).json({
        error: error.publicMessage || "Gemini is temporarily unavailable. Please try again."
      });
    }
    if (
      isDatabaseUnavailable(error) ||
      (error.code === "ER_NO_SUCH_TABLE" && /archived_chat_messages/i.test(error.message))
    ) {
      const databaseError = getChatDatabaseError(error, "Unable to load suggestion context.");
      return res.status(databaseError.status).json({ error: databaseError.message });
    }
    return res.status(502).json({ error: "AI suggestions are temporarily unavailable." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

app.get("/api/users/lookup", requireAuth, async (req, res) => {
  const email = typeof req.query.email === "string" ? normalizeEmail(req.query.email) : "";
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    const [users] = await database.execute(
      "SELECT id, name, email FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    const user = users[0];
    if (!user || String(user.id) === String(req.authUser.id)) {
      return res.status(404).json({ error: "No other account was found with that email." });
    }

    const id = String(user.id);
    return res.json({
      user: { id, name: user.name, email: user.email },
      roomId: personalRoomId(req.authUser.id, id)
    });
  } catch (error) {
    console.error("Looking up chat user failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to look up that user."
    });
  }
});

app.get("/api/users/search", requireAuth, async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length > 100) {
    return res.status(400).json({ error: "Search text must be 100 characters or fewer." });
  }
  if (query.length < 2) return res.json({ users: [] });

  try {
    const searchTerm = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const [users] = await database.execute(
      `SELECT id, name, email FROM users
       WHERE id <> ? AND (name LIKE ? OR email LIKE ?)
       ORDER BY name ASC
       LIMIT 8`,
      [req.authUser.id, searchTerm, searchTerm]
    );

    return res.json({
      users: users.map((user) => ({
        id: String(user.id),
        name: user.name,
        email: user.email
      }))
    });
  } catch (error) {
    console.error("Searching chat users failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to search for users."
    });
  }
});

app.get("/api/personal-conversations", requireAuth, async (req, res) => {
  const userId = String(req.authUser.id);

  try {
    const [conversationRows] = await database.execute(
      `SELECT DISTINCT conversation_id
       FROM ${CHAT_MESSAGE_SOURCE} AS messages
       WHERE conversation_id LIKE ? OR conversation_id LIKE ?
       ORDER BY conversation_id`,
      [`personal:${userId}:%`, `personal:%:${userId}`]
    );
    const conversations = conversationRows
      .map(({ conversation_id: conversationId }) => {
        const match = /^personal:(\d{1,20}):(\d{1,20})$/.exec(conversationId);
        if (!match || (match[1] !== userId && match[2] !== userId)) return null;
        return {
          id: conversationId,
          recipientId: match[1] === userId ? match[2] : match[1]
        };
      })
      .filter(Boolean);

    if (conversations.length === 0) return res.json({ conversations: [] });

    const recipientIds = [...new Set(conversations.map(({ recipientId }) => recipientId))];
    const placeholders = recipientIds.map(() => "?").join(", ");
    const [users] = await database.execute(
      `SELECT id, name, email FROM users WHERE id IN (${placeholders})`,
      recipientIds
    );
    const usersById = new Map(users.map((user) => [String(user.id), user]));
    const availableConversations = conversations.filter(({ recipientId }) => usersById.has(recipientId));
    const roomIds = availableConversations.map(({ id }) => id);
    if (roomIds.length === 0) return res.json({ conversations: [] });

    const roomPlaceholders = roomIds.map(() => "?").join(", ");
    const [messages] = await database.execute(
      `SELECT messages.id, messages.conversation_id, messages.user_id,
              users.name AS sender, users.email AS sender_email,
             messages.message, messages.created_at
      FROM ${CHAT_MESSAGE_SOURCE} AS messages
      INNER JOIN users ON users.id = messages.user_id
      WHERE messages.conversation_id IN (${roomPlaceholders})
      ORDER BY messages.created_at ASC, messages.id ASC`,
      roomIds
    );
    const savedMessages = await addAttachmentsToMessages(messages.map((message) => ({
      id: String(message.id),
      conversationId: message.conversation_id,
      userId: String(message.user_id),
      sender: message.sender,
      senderEmail: message.sender_email,
      text: message.message,
      createdAt: message.created_at
    })));
    const messagesByRoom = new Map(roomIds.map((roomId) => [roomId, []]));
    savedMessages.forEach((message) => {
      messagesByRoom.get(message.conversationId).push(message);
    });

    return res.json({
      conversations: availableConversations.map(({ id, recipientId }) => {
        const user = usersById.get(recipientId);
        return {
          id,
          user: { id: recipientId, name: user.name, email: user.email },
          messages: messagesByRoom.get(id)
        };
      })
    });
  } catch (error) {
    console.error("Loading personal conversations failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to load personal conversations.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

function isValidConversationId(value) {
  return value === "weekend" ||
    value === "design" ||
    value === "family" ||
    value === "hikes" ||
    isGroupConversationId(value);
}

function isGroupConversationId(value) {
  return typeof value === "string" && /^group:[1-9][0-9]{0,19}$/.test(value);
}

async function isAuthorizedConversation(userId, conversationId) {
  if (!isValidConversationId(conversationId)) return false;
  if (!isGroupConversationId(conversationId)) return true;
  return isGroupMember(conversationId.slice("group:".length), userId);
}

function groupConversationId(groupId) {
  return `group:${groupId}`;
}

async function isValidRecipientId(userId) {
  const [users] = await database.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
  return users.length > 0;
}

async function isGroupMember(groupId, userId) {
  const [memberships] = await database.execute(
    "SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
    [groupId, userId]
  );
  return memberships.length > 0;
}

app.get("/api/groups", requireAuth, async (req, res) => {
  try {
    const [groups] = await database.execute(
      `SELECT chat_groups.id, chat_groups.name, chat_groups.invite_code, chat_groups.created_at,
              (SELECT COUNT(*) FROM chat_group_members AS members
               WHERE members.group_id = chat_groups.id) AS member_count,
              (SELECT messages.message FROM ${CHAT_MESSAGE_SOURCE} AS messages
               WHERE messages.conversation_id = CONCAT('group:', chat_groups.id)
               ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1) AS last_message,
              (SELECT messages.created_at FROM ${CHAT_MESSAGE_SOURCE} AS messages
               WHERE messages.conversation_id = CONCAT('group:', chat_groups.id)
               ORDER BY messages.created_at DESC, messages.id DESC LIMIT 1) AS last_message_at
       FROM chat_groups
       INNER JOIN chat_group_members
         ON chat_group_members.group_id = chat_groups.id
       WHERE chat_group_members.user_id = ?
       ORDER BY chat_groups.created_at DESC, chat_groups.id DESC`,
      [req.authUser.id]
    );

    return res.json({
      groups: groups.map((group) => ({
        id: String(group.id),
        conversationId: groupConversationId(String(group.id)),
        name: group.name,
        inviteCode: group.invite_code,
        memberCount: Number(group.member_count),
        lastMessage: group.last_message,
        lastMessageAt: group.last_message_at || group.created_at
      }))
    });
  } catch (error) {
    console.error("Loading groups failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to load groups."
    });
  }
});

app.post("/api/groups", requireAuth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Group name must be between 1 and 100 characters." });
  }

  const inviteCode = randomBytes(8).toString("hex").toUpperCase();
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO chat_groups (name, invite_code, created_by) VALUES (?, ?, ?)",
      [name, inviteCode, req.authUser.id]
    );
    await connection.execute(
      "INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)",
      [result.insertId, req.authUser.id]
    );
    await connection.commit();

    const id = String(result.insertId);
    return res.status(201).json({
      group: {
        id,
        conversationId: groupConversationId(id),
        name,
        inviteCode,
        memberCount: 1,
        lastMessage: null,
        lastMessageAt: new Date().toISOString()
      }
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Creating group failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to create the group."
    });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/groups/join", requireAuth, async (req, res) => {
  const inviteCode = typeof req.body?.inviteCode === "string"
    ? req.body.inviteCode.trim().toUpperCase()
    : "";
  if (!/^[A-F0-9]{16}$/.test(inviteCode)) {
    return res.status(400).json({ error: "Enter a valid 16-character invite code." });
  }

  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [groups] = await connection.execute(
      `SELECT chat_groups.id, chat_groups.name, chat_groups.invite_code, chat_groups.created_at,
              (SELECT COUNT(*) FROM chat_group_members AS members
               WHERE members.group_id = chat_groups.id) AS member_count
       FROM chat_groups WHERE chat_groups.invite_code = ? LIMIT 1`,
      [inviteCode]
    );
    const group = groups[0];
    if (!group) {
      await connection.rollback();
      return res.status(404).json({ error: "No group was found with that invite code." });
    }

    await connection.execute(
      "INSERT IGNORE INTO chat_group_members (group_id, user_id) VALUES (?, ?)",
      [group.id, req.authUser.id]
    );
    const [memberCounts] = await connection.execute(
      "SELECT COUNT(*) AS member_count FROM chat_group_members WHERE group_id = ?",
      [group.id]
    );
    await connection.commit();

    const id = String(group.id);
    return res.json({
      group: {
        id,
        conversationId: groupConversationId(id),
        name: group.name,
        inviteCode: group.invite_code,
        memberCount: Number(memberCounts[0].member_count),
        lastMessage: null,
        lastMessageAt: group.created_at
      }
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Joining group failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to join the group."
    });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/groups/:groupId/messages", requireAuth, async (req, res) => {
  const { groupId } = req.params;
  if (!/^[1-9][0-9]{0,19}$/.test(groupId)) {
    return res.status(400).json({ error: "A valid group ID is required." });
  }

  try {
    if (!(await isGroupMember(groupId, req.authUser.id))) {
      return res.status(403).json({ error: "Join this group before viewing its messages." });
    }

    const [messages] = await database.execute(
      `SELECT messages.id, messages.conversation_id, messages.user_id,
              users.name AS sender, messages.message, messages.created_at
       FROM ${CHAT_MESSAGE_SOURCE} AS messages
       INNER JOIN users ON users.id = messages.user_id
       WHERE messages.conversation_id = ?
       ORDER BY messages.created_at ASC, messages.id ASC`,
      [groupConversationId(groupId)]
    );
    const mappedMessages = await addAttachmentsToMessages(messages.map((message) => ({
      id: String(message.id),
      conversationId: message.conversation_id,
      userId: String(message.user_id),
      sender: message.sender,
      text: message.message,
      createdAt: message.created_at
    })));
    return res.json({ messages: mappedMessages });
  } catch (error) {
    console.error("Loading group messages failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to load group messages.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.post("/api/groups/:groupId/messages", requireAuth, async (req, res) => {
  const { groupId } = req.params;
  const parsedMessage = parseMessagePayload(req.body || {}, req.authUser.id);
  if (!/^[1-9][0-9]{0,19}$/.test(groupId)) {
    return res.status(400).json({ error: "A valid group ID is required." });
  }
  if (parsedMessage.error) {
    return res.status(400).json({ error: parsedMessage.error });
  }

  try {
    if (!(await isGroupMember(groupId, req.authUser.id))) {
      return res.status(403).json({ error: "Join this group before sending messages." });
    }

    const conversationId = groupConversationId(groupId);
    const messageId = await saveMessage({
      conversationId,
      userId: req.authUser.id,
      ...parsedMessage
    });
    const [savedMessages] = await database.execute(
      `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.user_id,
              users.name AS sender, chat_messages.message, chat_messages.created_at
       FROM chat_messages
       INNER JOIN users ON users.id = chat_messages.user_id
       WHERE chat_messages.id = ?`,
      [messageId]
    );
    const savedMessage = savedMessages[0];
    const [responseMessage] = await addAttachmentsToMessages([{
      id: String(savedMessage.id),
      conversationId: savedMessage.conversation_id,
      userId: String(savedMessage.user_id),
      sender: savedMessage.sender,
      text: savedMessage.message,
      createdAt: savedMessage.created_at
    }]);

    chatRealtime.publishMessage(responseMessage);
    return res.status(201).json({ message: responseMessage });
  } catch (error) {
    console.error("Saving group message failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to save the group message.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.get("/api/messages", requireAuth, async (req, res) => {
  const { conversationId } = req.query;
  if (
    conversationId !== undefined &&
    (!isValidConversationId(conversationId) || isGroupConversationId(conversationId))
  ) {
    return res.status(400).json({ error: "A valid non-group conversationId is required." });
  }

  try {
    const [messages] = await database.execute(
      `SELECT messages.id, messages.conversation_id, messages.user_id,
              users.name AS sender, messages.message, messages.created_at
       FROM ${CHAT_MESSAGE_SOURCE} AS messages
       INNER JOIN users ON users.id = messages.user_id
       WHERE messages.conversation_id NOT LIKE 'personal:%'
         AND messages.conversation_id NOT LIKE 'group:%'
       ${conversationId === undefined ? "" : "AND messages.conversation_id = ?"}
       ORDER BY messages.created_at ASC, messages.id ASC`,
      conversationId === undefined ? [] : [conversationId]
    );

    const mappedMessages = await addAttachmentsToMessages(messages.map((message) => ({
        id: String(message.id),
        conversationId: message.conversation_id,
        userId: String(message.user_id),
        sender: message.sender,
        text: message.message,
        createdAt: message.created_at
    })));
    return res.json({ messages: mappedMessages });
  } catch (error) {
    console.error("Loading messages failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to load messages.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.post("/api/messages", requireAuth, async (req, res) => {
  const { conversationId } = req.body || {};
  const parsedMessage = parseMessagePayload(req.body || {}, req.authUser.id);
  if (!isValidConversationId(conversationId) || isGroupConversationId(conversationId)) {
    return res.status(400).json({ error: "A valid non-group conversationId is required." });
  }
  if (parsedMessage.error) {
    return res.status(400).json({ error: parsedMessage.error });
  }

  try {
    const messageId = await saveMessage({
      conversationId,
      userId: req.authUser.id,
      ...parsedMessage
    });
    const [messages] = await database.execute(
      `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.user_id,
              users.name AS sender, chat_messages.message, chat_messages.created_at
       FROM chat_messages
       INNER JOIN users ON users.id = chat_messages.user_id
       WHERE chat_messages.id = ?`,
      [messageId]
    );
    const savedMessage = messages[0];

    const [responseMessage] = await addAttachmentsToMessages([{
      id: String(savedMessage.id),
      conversationId: savedMessage.conversation_id,
      userId: String(savedMessage.user_id),
      sender: savedMessage.sender,
      text: savedMessage.message,
      createdAt: savedMessage.created_at
    }]);
    chatRealtime.publishMessage(responseMessage);

    return res.status(201).json({ message: responseMessage });
  } catch (error) {
    console.error("Saving message failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to save the message.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.get("/api/personal-messages", requireAuth, async (req, res) => {
  const recipientId = typeof req.query.recipientId === "string" ? req.query.recipientId : "";
  if (
    !/^[0-9]{1,20}$/.test(recipientId) ||
    recipientId === String(req.authUser.id)
  ) {
    return res.status(400).json({ error: "A valid other recipient ID is required." });
  }

  try {
    if (!(await isValidRecipientId(recipientId))) {
      return res.status(404).json({ error: "The recipient account was not found." });
    }

    const conversationId = personalRoomId(req.authUser.id, recipientId);
    const [messages] = await database.execute(
      `SELECT messages.id, messages.conversation_id, messages.user_id,
              users.name AS sender, users.email AS sender_email,
              messages.message, messages.created_at
       FROM ${CHAT_MESSAGE_SOURCE} AS messages
       INNER JOIN users ON users.id = messages.user_id
       WHERE messages.conversation_id = ?
       ORDER BY messages.created_at ASC, messages.id ASC`,
      [conversationId]
    );

    const mappedMessages = await addAttachmentsToMessages(messages.map((message) => ({
      id: String(message.id),
      conversationId: message.conversation_id,
      userId: String(message.user_id),
      sender: message.sender,
      senderEmail: message.sender_email,
      text: message.message,
      createdAt: message.created_at
    })));
    return res.json({ messages: mappedMessages });
  } catch (error) {
    console.error("Loading personal messages failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to load personal messages.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.post("/api/personal-messages", requireAuth, async (req, res) => {
  const { recipientId } = req.body || {};
  const parsedMessage = parseMessagePayload(req.body || {}, req.authUser.id);
  if (
    typeof recipientId !== "string" ||
    !/^[0-9]{1,20}$/.test(recipientId) ||
    recipientId === String(req.authUser.id)
  ) {
    return res.status(400).json({ error: "A valid other recipient ID is required." });
  }
  if (parsedMessage.error) {
    return res.status(400).json({ error: parsedMessage.error });
  }

  try {
    if (!(await isValidRecipientId(recipientId))) {
      return res.status(404).json({ error: "The recipient account was not found." });
    }

    const conversationId = personalRoomId(req.authUser.id, recipientId);
    const messageId = await saveMessage({
      conversationId,
      userId: req.authUser.id,
      ...parsedMessage
    });
    const [messages] = await database.execute(
      `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.user_id,
              users.name AS sender, users.email AS sender_email,
              chat_messages.message, chat_messages.created_at
       FROM chat_messages
       INNER JOIN users ON users.id = chat_messages.user_id
       WHERE chat_messages.id = ?`,
      [messageId]
    );
    const savedMessage = messages[0];
    const [responseMessage] = await addAttachmentsToMessages([{
      id: String(savedMessage.id),
      conversationId: savedMessage.conversation_id,
      userId: String(savedMessage.user_id),
      sender: savedMessage.sender,
      senderEmail: savedMessage.sender_email,
      text: savedMessage.message,
      createdAt: savedMessage.created_at
    }]);

    chatRealtime.publishPersonalMessage(responseMessage, recipientId);
    return res.status(201).json({ message: responseMessage });
  } catch (error) {
    console.error("Saving personal message failed:", error);
    const databaseError = getChatDatabaseError(error, "Unable to save the personal message.");
    return res.status(databaseError.status).json({ error: databaseError.message });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, phone, password } = req.body || {};

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof phone !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({ error: "Name, email, phone, and password are required." });
  }

  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPhone = normalizePhone(phone);

  if (!cleanName || cleanName.length > 100) {
    return res.status(400).json({ error: "Name must be between 1 and 100 characters." });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Enter a valid phone number." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be 8 to 72 bytes long." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await database.execute(
      "INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)",
      [cleanName, cleanEmail, cleanPhone, passwordHash]
    );

    return res.status(201).json({
      message: "Account created successfully. You can now log in.",
      user: {
        id: result.insertId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone
      }
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email or phone number already exists." });
    }

    console.error("Sign-up failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to create the account."
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body || {};

  if (typeof identifier !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email or phone number and password are required." });
  }
  if (!isValidEmail(identifier.trim()) && !isValidPhone(identifier.trim())) {
    return res.status(400).json({ error: "Enter a valid email address or phone number." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be 8 to 72 bytes long." });
  }

  const cleanIdentifier = identifier.trim();
  const lookupValue = cleanIdentifier.includes("@")
    ? normalizeEmail(cleanIdentifier)
    : normalizePhone(cleanIdentifier);
  const lookupColumn = cleanIdentifier.includes("@") ? "email" : "phone";

  try {
    const [users] = await database.execute(
      `SELECT id, name, email, phone, password_hash FROM users WHERE ${lookupColumn} = ? LIMIT 1`,
      [lookupValue]
    );
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email/phone or password." });
    }

    const token = jwt.sign(
      { name: user.name },
      jwtSecret,
      { subject: String(user.id), expiresIn: "1d" }
    );

    return res.json({
      message: "Logged in successfully.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to log in."
    });
  }
});

app.use(express.static(frontendPath));

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Request failed:", error);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

const server = http.createServer(app);
const chatRealtime = createSocketServer({
  server,
  jwtSecret,
  isValidConversationId,
  isAuthorizedConversation,
  isValidRecipientId
});

CronJob.from({
  cronTime: "0 0 * * *",
  onTick: async () => {
    try {
      const result = await archiveOldMessages(database);
      if (result.archivedMessages > 0) {
        console.log(
          `Archived ${result.archivedMessages} messages and ${result.archivedAttachments} attachments.`
        );
      }
    } catch (error) {
      console.error("Nightly chat archiving failed:", error);
    }
  },
  start: true,
  timeZone: process.env.ARCHIVE_TIMEZONE || "UTC",
  waitForCompletion: true
});

server.listen(port, () => {
  console.log(`GroupChat is running at http://localhost:${port}`);
});
