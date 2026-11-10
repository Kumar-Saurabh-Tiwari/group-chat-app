const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const ChatRealtimeService = require("./services/chat-realtime-service");

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

function requireAuth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token, ...extraParts] = authorization.split(" ");

  if (scheme !== "Bearer" || !token || extraParts.length > 0) {
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

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

function isValidConversationId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

app.get("/api/messages", requireAuth, async (req, res) => {
  const { conversationId } = req.query;
  if (conversationId !== undefined && !isValidConversationId(conversationId)) {
    return res.status(400).json({ error: "A valid conversationId is required." });
  }

  try {
    const [messages] = await database.execute(
      `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.user_id,
              users.name AS sender, chat_messages.message, chat_messages.created_at
       FROM chat_messages
       INNER JOIN users ON users.id = chat_messages.user_id
       ${conversationId === undefined ? "" : "WHERE chat_messages.conversation_id = ?"}
       ORDER BY chat_messages.created_at ASC, chat_messages.id ASC`,
      conversationId === undefined ? [] : [conversationId]
    );

    return res.json({
      messages: messages.map((message) => ({
        id: String(message.id),
        conversationId: message.conversation_id,
        userId: String(message.user_id),
        sender: message.sender,
        text: message.message,
        createdAt: message.created_at
      }))
    });
  } catch (error) {
    console.error("Loading messages failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to load messages."
    });
  }
});

app.post("/api/messages", requireAuth, async (req, res) => {
  const { conversationId, message } = req.body || {};
  if (!isValidConversationId(conversationId)) {
    return res.status(400).json({ error: "A valid conversationId is required." });
  }
  if (typeof message !== "string" || !message.trim() || message.trim().length > 2000) {
    return res.status(400).json({ error: "Message must be between 1 and 2000 characters." });
  }

  try {
    const [result] = await database.execute(
      "INSERT INTO chat_messages (conversation_id, user_id, message) VALUES (?, ?, ?)",
      [conversationId, req.authUser.id, message.trim()]
    );
    const [messages] = await database.execute(
      `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.user_id,
              users.name AS sender, chat_messages.message, chat_messages.created_at
       FROM chat_messages
       INNER JOIN users ON users.id = chat_messages.user_id
       WHERE chat_messages.id = ?`,
      [result.insertId]
    );
    const savedMessage = messages[0];

    const responseMessage = {
      id: String(savedMessage.id),
      conversationId: savedMessage.conversation_id,
      userId: String(savedMessage.user_id),
      sender: savedMessage.sender,
      text: savedMessage.message,
      createdAt: savedMessage.created_at
    };
    chatRealtime.publishMessage(responseMessage);

    return res.status(201).json({ message: responseMessage });
  } catch (error) {
    console.error("Saving message failed:", error);
    return res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      error: isDatabaseUnavailable(error)
        ? "The database is unavailable. Check the backend database settings."
        : "Unable to save the message."
    });
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
const chatRealtime = new ChatRealtimeService({
  server,
  jwtSecret,
  isValidConversationId
});

server.listen(port, () => {
  console.log(`GroupChat is running at http://localhost:${port}`);
});
