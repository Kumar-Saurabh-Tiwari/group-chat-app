const { URL } = require("node:url");
const jwt = require("jsonwebtoken");
const { WebSocket, WebSocketServer } = require("ws");

const AUTH_TIMEOUT_MS = 5000;

class ChatRealtimeService {
  constructor({ server, jwtSecret, isValidConversationId }) {
    this.jwtSecret = jwtSecret;
    this.isValidConversationId = isValidConversationId;
    this.subscribers = new Map();
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: 16 * 1024
    });

    server.on("upgrade", (request, socket, head) => {
      const { pathname } = new URL(request.url, "http://localhost");
      if (pathname !== "/ws") {
        socket.destroy();
        return;
      }

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.webSocketServer.emit("connection", webSocket, request);
      });
    });

    this.webSocketServer.on("connection", (webSocket) => this.handleConnection(webSocket));
  }

  handleConnection(webSocket) {
    webSocket.user = null;
    webSocket.conversationIds = new Set();
    webSocket.authTimeout = setTimeout(() => {
      this.sendError(webSocket, "Authentication timed out.");
      webSocket.close(4401, "Authentication required");
    }, AUTH_TIMEOUT_MS);
    webSocket.authTimeout.unref();
    webSocket.sessionExpiryTimeout = null;

    webSocket.on("message", (data) => {
      this.handleClientMessage(webSocket, data);
    });

    webSocket.on("close", () => {
      clearTimeout(webSocket.authTimeout);
      clearTimeout(webSocket.sessionExpiryTimeout);
      this.removeSubscriptions(webSocket);
    });

    webSocket.on("error", (error) => {
      console.error("Chat WebSocket connection failed:", error);
    });
  }

  handleClientMessage(webSocket, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      this.sendError(webSocket, "WebSocket messages must be valid JSON.");
      return;
    }

    if (!webSocket.user) {
      this.authenticate(webSocket, message);
      return;
    }

    if (message.type === "subscribe") {
      this.subscribe(webSocket, message.conversationId);
      return;
    }

    if (message.type === "unsubscribe") {
      this.unsubscribe(webSocket, message.conversationId);
      return;
    }

    this.sendError(webSocket, "Unsupported WebSocket message type.");
  }

  authenticate(webSocket, message) {
    if (message.type !== "authenticate" || typeof message.token !== "string") {
      this.sendError(webSocket, "Authenticate with a valid bearer token first.");
      webSocket.close(4401, "Authentication required");
      return;
    }

    try {
      const payload = jwt.verify(message.token, this.jwtSecret, { algorithms: ["HS256"] });
      if (typeof payload === "string" || !payload.sub || typeof payload.name !== "string") {
        throw new jwt.JsonWebTokenError("Invalid user claims");
      }

      clearTimeout(webSocket.authTimeout);
      webSocket.user = { id: String(payload.sub), name: payload.name };
      if (payload.exp) {
        webSocket.sessionExpiryTimeout = setTimeout(() => {
          webSocket.close(4401, "Session expired");
        }, Math.max(0, payload.exp * 1000 - Date.now()));
        webSocket.sessionExpiryTimeout.unref();
      }
      this.send(webSocket, { type: "authenticated", user: webSocket.user });
    } catch (error) {
      if (!(error instanceof jwt.JsonWebTokenError)) {
        console.error("WebSocket authentication failed:", error);
      }
      this.sendError(webSocket, "Your session is invalid or has expired.");
      webSocket.close(4401, "Invalid authentication");
    }
  }

  subscribe(webSocket, conversationId) {
    if (!this.isValidConversationId(conversationId)) {
      this.sendError(webSocket, "A valid conversationId is required.");
      return;
    }

    let subscribers = this.subscribers.get(conversationId);
    if (!subscribers) {
      subscribers = new Set();
      this.subscribers.set(conversationId, subscribers);
    }
    subscribers.add(webSocket);
    webSocket.conversationIds.add(conversationId);
    this.send(webSocket, { type: "subscribed", conversationId });
  }

  unsubscribe(webSocket, conversationId) {
    if (!this.isValidConversationId(conversationId)) {
      this.sendError(webSocket, "A valid conversationId is required.");
      return;
    }

    this.removeSubscription(webSocket, conversationId);
    this.send(webSocket, { type: "unsubscribed", conversationId });
  }

  removeSubscription(webSocket, conversationId) {
    const subscribers = this.subscribers.get(conversationId);
    if (!subscribers) return;

    subscribers.delete(webSocket);
    webSocket.conversationIds.delete(conversationId);
    if (subscribers.size === 0) this.subscribers.delete(conversationId);
  }

  removeSubscriptions(webSocket) {
    for (const conversationId of webSocket.conversationIds) {
      this.removeSubscription(webSocket, conversationId);
    }
  }

  publishMessage(message) {
    const subscribers = this.subscribers.get(message.conversationId);
    if (!subscribers) return;

    const event = JSON.stringify({ type: "message", message });
    for (const webSocket of subscribers) {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.send(event);
    }
  }

  send(webSocket, message) {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify(message));
    }
  }

  sendError(webSocket, message) {
    this.send(webSocket, { type: "error", error: message });
  }
}

module.exports = ChatRealtimeService;
