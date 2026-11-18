import {sqliteTable,text,integer,uniqueIndex} from 'drizzle-orm/sqlite-core';
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
export const mailingJobs=sqliteTable('studio_mailing_jobs',{
  id:text('id').primaryKey(),
  userId:text('user_id').notNull(),
  requestId:text('request_id').notNull().unique(),
  contentHash:text('content_hash').notNull(),
  stateJson:text('state_json').notNull(),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
});
export const wordpressPublications=sqliteTable('studio_wordpress_publications',{
  slug:text('slug').primaryKey(),
  userId:text('user_id').notNull(),
  postId:integer('post_id').notNull(),
  title:text('title').notNull(),
  type:text('type').notNull(),
  url:text('url').notNull(),
  status:text('status').notNull(),
  createdAt:text('created_at').notNull(),
});


export const eventRegistrations = sqliteTable('studio_event_registrations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  eventPostId: integer('event_post_id').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('studio_event_registration_email').on(table.workspaceId, table.eventPostId, table.email),
]);
