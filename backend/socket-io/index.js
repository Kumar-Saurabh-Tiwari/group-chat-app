const { Server } = require("socket.io");
const createSocketAuthenticationMiddleware = require("./middleware");
const { registerChatHandlers, roomName } = require("./handlers/chat");
const { registerPersonalChatHandlers } = require("./handlers/personalChat");

function createSocketServer({ server, jwtSecret, isValidConversationId, isValidRecipientId }) {
  const io = new Server(server);
  io.use(createSocketAuthenticationMiddleware(jwtSecret));
  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    registerChatHandlers(io, socket, isValidConversationId);
    registerPersonalChatHandlers(io, socket, isValidRecipientId);
  });

  return {
    publishMessage(message) {
      io.to(roomName(message.conversationId)).emit("message:new", message);
    },
    publishPersonalMessage(message, recipientId) {
      io.to(`user:${recipientId}`).emit("new_message", message);
    }
  };
}

module.exports = createSocketServer;
