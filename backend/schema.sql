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
  CONSTRAINT chat_messages_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id)
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
