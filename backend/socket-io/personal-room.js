function personalRoomId(firstUserId, secondUserId) {
  return `personal:${[String(firstUserId), String(secondUserId)].sort().join(":")}`;
}

module.exports = personalRoomId;
