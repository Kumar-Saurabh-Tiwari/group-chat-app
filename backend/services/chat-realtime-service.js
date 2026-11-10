const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

class ChatRealtimeService {
  constructor({ server, jwtSecret, isValidConversationId }) {
    this.isValidConversationId = isValidConversationId;
    this.io = new Server(server);

    this.io.use((socket, next) => {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (typeof token !== "string") {
        return next(this.authenticationError());
      }

      try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
        if (typeof payload === "string" || !payload.sub || typeof payload.name !== "string") {
          return next(this.authenticationError());
        }

        socket.data.user = { id: String(payload.sub), name: payload.name };
        socket.data.tokenExpiresAt = payload.exp ? payload.exp * 1000 : null;
        return next();
      } catch (error) {
        if (!(error instanceof jwt.JsonWebTokenError)) {
          console.error("Socket.IO authentication failed:", error);
        }
        return next(this.authenticationError());
      }
    });

    this.io.on("connection", (socket) => this.handleConnection(socket));
  }

  authenticationError() {
    const error = new Error("Your session is invalid or has expired.");
    error.data = { code: "AUTHENTICATION_ERROR" };
    return error;
  }

  handleConnection(socket) {
    const expiresAt = socket.data.tokenExpiresAt;
    if (expiresAt) {
      socket.data.sessionExpiryTimeout = setTimeout(() => {
        socket.disconnect(true);
      }, Math.max(0, expiresAt - Date.now()));
      socket.data.sessionExpiryTimeout.unref();
    }

    socket.on("conversation:join", (payload, acknowledge) => {
      const conversationId = payload && payload.conversationId;
      if (!this.isValidConversationId(conversationId)) {
        this.acknowledge(acknowledge, { ok: false, error: "A valid conversationId is required." });
        return;
      }

      socket.join(this.roomName(conversationId));
      this.acknowledge(acknowledge, { ok: true, conversationId });
    });

    socket.on("conversation:leave", (payload, acknowledge) => {
      const conversationId = payload && payload.conversationId;
      if (!this.isValidConversationId(conversationId)) {
        this.acknowledge(acknowledge, { ok: false, error: "A valid conversationId is required." });
        return;
      }

      socket.leave(this.roomName(conversationId));
      this.acknowledge(acknowledge, { ok: true, conversationId });
    });

    socket.on("disconnect", () => {
      clearTimeout(socket.data.sessionExpiryTimeout);
    });
  }

  acknowledge(callback, result) {
    if (typeof callback === "function") callback(result);
  }

  roomName(conversationId) {
    return `conversation:${conversationId}`;
  }

  publishMessage(message) {
    this.io.to(this.roomName(message.conversationId)).emit("message:new", message);
  }
}

module.exports = ChatRealtimeService;
