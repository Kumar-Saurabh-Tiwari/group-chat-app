function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

async function updatePresence(io, conversationId) {
  const room = roomName(conversationId);
  const sockets = await io.in(room).fetchSockets();
  const onlineCount = new Set(sockets.map((socket) => socket.data.user.id)).size;
  io.to(room).emit("conversation:presence", { conversationId, onlineCount });
  return onlineCount;
}

function acknowledge(callback, result) {
  if (typeof callback === "function") callback(result);
}

function registerChatHandlers(io, socket, isValidConversationId, isAuthorizedConversation) {
  const expiresAt = socket.data.tokenExpiresAt;
  if (expiresAt) {
    socket.data.sessionExpiryTimeout = setTimeout(() => {
      socket.disconnect(true);
    }, Math.max(0, expiresAt - Date.now()));
    socket.data.sessionExpiryTimeout.unref();
  }

  socket.on("conversation:join", async (payload, callback) => {
    const conversationId = payload && payload.conversationId;
    if (!isValidConversationId(conversationId)) {
      acknowledge(callback, { ok: false, error: "A valid conversationId is required." });
      return;
    }

    try {
      if (!(await isAuthorizedConversation(socket.data.user.id, conversationId))) {
        acknowledge(callback, { ok: false, error: "Join this group before entering its room." });
        return;
      }
      await socket.join(roomName(conversationId));
      const onlineCount = await updatePresence(io, conversationId);
      acknowledge(callback, { ok: true, conversationId, onlineCount });
    } catch (error) {
      console.error("Joining conversation failed:", error);
      acknowledge(callback, { ok: false, error: "Unable to join the conversation." });
    }
  });

  socket.on("conversation:leave", async (payload, callback) => {
    const conversationId = payload && payload.conversationId;
    if (!isValidConversationId(conversationId)) {
      acknowledge(callback, { ok: false, error: "A valid conversationId is required." });
      return;
    }

    try {
      await socket.leave(roomName(conversationId));
      const onlineCount = await updatePresence(io, conversationId);
      acknowledge(callback, { ok: true, conversationId, onlineCount });
    } catch (error) {
      console.error("Leaving conversation failed:", error);
      acknowledge(callback, { ok: false, error: "Unable to leave the conversation." });
    }
  });

  let conversationsToUpdate = [];
  socket.on("disconnecting", () => {
    conversationsToUpdate = [...socket.rooms]
      .filter((room) => room.startsWith("conversation:"))
      .map((room) => room.slice("conversation:".length));
  });

  socket.on("disconnect", () => {
    clearTimeout(socket.data.sessionExpiryTimeout);
    conversationsToUpdate.forEach((conversationId) => {
      updatePresence(io, conversationId).catch((error) => {
        console.error("Updating conversation presence failed:", error);
      });
    });
  });
}

module.exports = { registerChatHandlers, roomName };
