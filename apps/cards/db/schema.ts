import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const connections=sqliteTable('studio_connections',{
  userId:text('user_id').primaryKey(),
  encryptedToken:text('encrypted_token').notNull(),
  updatedAt:text('updated_at').notNull(),
});
export const sessions=sqliteTable('studio_sessions',{
  userId:text('user_id').primaryKey(),
  state:text('state_json').notNull(),
  revision:integer('revision').notNull().default(1),
  updatedAt:text('updated_at').notNull(),
});
