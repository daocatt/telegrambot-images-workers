import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Users table
export const users = sqliteTable('users', {
  tg_id: text('tg_id').primaryKey(),
  nickname: text('nickname'),
  is_admin: integer('is_admin', { mode: 'boolean' }).default(false).notNull(),
  status: text('status').default('pending').notNull(), // 'active', 'banned', 'pending'
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  email: text('email'),
  password_hash: text('password_hash'),
  email_verified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

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
  group_id: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  uploaderIdx: index('images_uploader_idx').on(table.uploader_id),
  groupIdx: index('images_group_idx').on(table.group_id),
  createdAtIdx: index('images_created_at_idx').on(table.created_at),
}));

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.tg_id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  passcode: text('passcode'), // Optional passcode protection
  layout: text('layout').default('grid').notNull(), // 'grid', 'waterfall', 'carousel'
  is_public: integer('is_public', { mode: 'boolean' }).default(true).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdx: index('groups_user_idx').on(table.user_id),
}));

// AdminSessions table
export const adminSessions = sqliteTable('admin_sessions', {
  token: text('token').primaryKey(), // UUID
  user_id: text('user_id')
    .notNull()
    .references(() => users.tg_id, { onDelete: 'cascade' }),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// EmailVerifications table
export const emailVerifications = sqliteTable('email_verifications', {
  email: text('email').primaryKey(),
  code: text('code').notNull(),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

