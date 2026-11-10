const { Server } = require("socket.io");
const createSocketAuthenticationMiddleware = require("./middleware");
const { registerChatHandlers, roomName } = require("./handlers/chat");
const { registerPersonalChatHandlers } = require("./handlers/personalChat");

function createSocketServer({ server, jwtSecret, isValidConversationId }) {
  const io = new Server(server);
  io.use(createSocketAuthenticationMiddleware(jwtSecret));
  io.on("connection", (socket) => {
    registerChatHandlers(io, socket, isValidConversationId);
    registerPersonalChatHandlers(io, socket);
  });

  return {
    publishMessage(message) {
      io.to(roomName(message.conversationId)).emit("message:new", message);
    }
  };
}

module.exports = createSocketServer;
