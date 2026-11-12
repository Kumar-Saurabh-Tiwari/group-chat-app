CREATE DATABASE IF NOT EXISTS group_chat
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE group_chat;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  password_hash VARCHAR(60) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_phone_unique (phone)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY chat_messages_conversation_created (conversation_id, created_at, id),
  KEY chat_messages_user_created (user_id, created_at),
  KEY chat_messages_created (created_at, id),
  CONSTRAINT chat_messages_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
);

SET @chat_messages_created_index_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE chat_messages ADD INDEX chat_messages_created (created_at, id)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'chat_messages'
    AND index_name = 'chat_messages_created'
);
PREPARE chat_messages_created_index_statement FROM @chat_messages_created_index_sql;
EXECUTE chat_messages_created_index_statement;
DEALLOCATE PREPARE chat_messages_created_index_statement;

CREATE TABLE IF NOT EXISTS chat_message_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY chat_message_attachments_object_key_unique (object_key),
  KEY chat_message_attachments_message (message_id),
  CONSTRAINT chat_message_attachments_message_fk
    FOREIGN KEY (message_id) REFERENCES chat_messages (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archived_chat_messages (
  id BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  KEY archived_chat_messages_conversation_created (conversation_id, created_at, id),
  KEY archived_chat_messages_user_created (user_id, created_at),
  KEY archived_chat_messages_created (created_at, id),
  CONSTRAINT archived_chat_messages_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS archived_chat_message_attachments (
  id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY archived_chat_message_attachments_object_key_unique (object_key),
  KEY archived_chat_message_attachments_message (message_id),
  CONSTRAINT archived_chat_message_attachments_message_fk
    FOREIGN KEY (message_id) REFERENCES archived_chat_messages (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  invite_code CHAR(16) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY chat_groups_invite_code_unique (invite_code),
  CONSTRAINT chat_groups_creator_fk
    FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  KEY chat_group_members_user_joined (user_id, joined_at),
  CONSTRAINT chat_group_members_group_fk
    FOREIGN KEY (group_id) REFERENCES chat_groups (id)
    ON DELETE CASCADE,
  CONSTRAINT chat_group_members_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
);
