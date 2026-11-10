const personalRoomId = require("../personal-room");

function acknowledge(callback, result) {
  if (typeof callback === "function") callback(result);
}

function registerPersonalChatHandlers(io, socket, isValidRecipientId) {
  socket.on("join_room", async (payload, callback) => {
    const recipientId = payload && payload.recipientId;
    if (
      typeof recipientId !== "string" ||
      !/^[0-9]{1,20}$/.test(recipientId) ||
      recipientId === socket.data.user.id
    ) {
      acknowledge(callback, { ok: false, error: "A valid other user ID is required." });
      return;
    }

    const roomId = personalRoomId(socket.data.user.id, recipientId);
    if (payload.roomId !== roomId) {
      acknowledge(callback, { ok: false, error: "The personal room ID is invalid." });
      return;
    }

    try {
      if (!(await isValidRecipientId(recipientId))) {
        acknowledge(callback, { ok: false, error: "The recipient account was not found." });
        return;
      }
      await socket.join(roomId);
      acknowledge(callback, { ok: true, roomId });
    } catch (error) {
      console.error("Joining personal message room failed:", error);
      acknowledge(callback, { ok: false, error: "Unable to join the personal chat." });
    }
  });

  socket.on("leave_room", async (payload, callback) => {
    const recipientId = payload && payload.recipientId;
    if (
      typeof recipientId !== "string" ||
      !/^[0-9]{1,20}$/.test(recipientId) ||
      recipientId === socket.data.user.id
    ) {
      acknowledge(callback, { ok: false, error: "A valid other user ID is required." });
      return;
    }

    const roomId = personalRoomId(socket.data.user.id, recipientId);
    if (payload.roomId !== roomId) {
      acknowledge(callback, { ok: false, error: "The personal room ID is invalid." });
      return;
    }

    try {
      await socket.leave(roomId);
      acknowledge(callback, { ok: true, roomId });
    } catch (error) {
      console.error("Leaving personal message room failed:", error);
      acknowledge(callback, { ok: false, error: "Unable to leave the personal chat." });
    }
  });
}

module.exports = { registerPersonalChatHandlers };
