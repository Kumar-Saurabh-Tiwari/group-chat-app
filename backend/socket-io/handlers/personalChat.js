function userRoom(userId) {
  return `user:${userId}`;
}

function acknowledge(callback, result) {
  if (typeof callback === "function") callback(result);
}

function registerPersonalChatHandlers(io, socket) {
  socket.on("join_room", async (payload, callback) => {
    const userId = socket.data.user.id;
    if (!payload || payload.userId !== userId) {
      acknowledge(callback, { ok: false, error: "You can only join your own personal room." });
      return;
    }

    try {
      await socket.join(userRoom(userId));
      acknowledge(callback, { ok: true });
    } catch (error) {
      console.error("Joining personal message room failed:", error);
      acknowledge(callback, { ok: false, error: "Unable to join your personal room." });
    }
  });

  socket.on("new_message", (payload, callback) => {
    const recipientId = payload && payload.recipientId;
    const text = payload && payload.message;
    if (typeof recipientId !== "string" || !/^[0-9]{1,20}$/.test(recipientId)) {
      acknowledge(callback, { ok: false, error: "A valid recipientId is required." });
      return;
    }
    if (typeof text !== "string" || !text.trim() || text.trim().length > 2000) {
      acknowledge(callback, { ok: false, error: "Message must be between 1 and 2000 characters." });
      return;
    }

    const message = {
      sender: socket.data.user,
      recipientId,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };
    io.to(userRoom(recipientId)).emit("new_message", message);
    acknowledge(callback, { ok: true, message });
  });
}

module.exports = { registerPersonalChatHandlers, userRoom };
