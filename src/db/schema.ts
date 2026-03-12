import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Users table
export const users = sqliteTable('users', {
  tg_id: text('tg_id').primaryKey(),
  nickname: text('nickname'),
  is_admin: integer('is_admin', { mode: 'boolean' }).default(false).notNull(),
  status: text('status').default('pending').notNull(), // 'active', 'banned', 'pending'
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Images table
export const images = sqliteTable('images', {
  id: text('id').primaryKey(), // NanoID
  tg_file_id: text('tg_file_id').notNull(),
  channel_msg_id: integer('channel_msg_id').notNull(),
  uploader_id: text('uploader_id')
    .notNull()
    .references(() => users.tg_id, { onDelete: 'cascade' }),
  is_public: integer('is_public', { mode: 'boolean' }).default(true).notNull(),
  caption: text('caption'),
  is_broken: integer('is_broken', { mode: 'boolean' }).default(false).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// AdminSessions table
export const adminSessions = sqliteTable('admin_sessions', {
  token: text('token').primaryKey(), // UUID
  user_id: text('user_id')
    .notNull()
    .references(() => users.tg_id, { onDelete: 'cascade' }),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
});
