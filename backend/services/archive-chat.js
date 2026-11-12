const DEFAULT_BATCH_SIZE = 1000;

async function archiveOldMessages(database, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError("The archive batch size must be a positive integer.");
  }

  let archivedMessages = 0;
  let archivedAttachments = 0;

  while (true) {
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [messages] = await connection.execute(
        `SELECT id
         FROM chat_messages
         WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)
         ORDER BY created_at ASC, id ASC
         LIMIT ?
         FOR UPDATE`,
        [batchSize]
      );

      if (messages.length === 0) {
        await connection.commit();
        return { archivedMessages, archivedAttachments };
      }

      const messageIds = messages.map(({ id }) => id);
      const placeholders = messageIds.map(() => "?").join(", ");
      await connection.execute(
        `INSERT INTO archived_chat_messages
           (id, conversation_id, user_id, message, created_at)
         SELECT id, conversation_id, user_id, message, created_at
         FROM chat_messages
         WHERE id IN (${placeholders})`,
        messageIds
      );
      const [attachmentResult] = await connection.execute(
        `INSERT INTO archived_chat_message_attachments
           (id, message_id, object_key, file_name, content_type, file_size, created_at)
         SELECT id, message_id, object_key, file_name, content_type, file_size, created_at
         FROM chat_message_attachments
         WHERE message_id IN (${placeholders})`,
        messageIds
      );
      await connection.execute(
        `DELETE FROM chat_message_attachments WHERE message_id IN (${placeholders})`,
        messageIds
      );
      await connection.execute(
        `DELETE FROM chat_messages WHERE id IN (${placeholders})`,
        messageIds
      );
      await connection.commit();
      archivedMessages += messages.length;
      archivedAttachments += attachmentResult.affectedRows;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = { DEFAULT_BATCH_SIZE, archiveOldMessages };
