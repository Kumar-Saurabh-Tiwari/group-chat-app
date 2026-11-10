const jwt = require("jsonwebtoken");

function createAuthenticationError() {
  const error = new Error("Your session is invalid or has expired.");
  error.data = { code: "AUTHENTICATION_ERROR" };
  return error;
}

function createSocketAuthenticationMiddleware(jwtSecret) {
  return (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (typeof token !== "string") {
      return next(createAuthenticationError());
    }

    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
      if (
        typeof payload === "string" ||
        typeof payload.sub !== "string" ||
        !payload.sub.trim() ||
        typeof payload.name !== "string" ||
        !Number.isInteger(payload.exp)
      ) {
        return next(createAuthenticationError());
      }

      socket.data.user = { id: payload.sub, name: payload.name };
      socket.data.tokenExpiresAt = payload.exp * 1000;
      return next();
    } catch (error) {
      if (!(error instanceof jwt.JsonWebTokenError)) {
        console.error("Socket.IO authentication failed:", error);
      }
      return next(createAuthenticationError());
    }
  };
}

module.exports = createSocketAuthenticationMiddleware;
