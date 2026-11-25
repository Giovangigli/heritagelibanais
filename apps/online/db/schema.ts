import {sqliteTable,text,integer,uniqueIndex,primaryKey} from 'drizzle-orm/sqlite-core';
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
export const brevoEventLists=sqliteTable('studio_brevo_event_lists',{
  workspaceId:text('workspace_id').notNull(),
  eventPostId:integer('event_post_id').notNull(),
  listId:integer('list_id'),
  importProcessId:integer('import_process_id'),
  importAudienceHash:text('import_audience_hash'),
  lockedUntil:integer('locked_until').notNull().default(0),
},table=>[primaryKey({columns:[table.workspaceId,table.eventPostId]})]);
export const wordpressPublications=sqliteTable('studio_wordpress_publications',{
  slug:text('slug').primaryKey(),
  userId:text('user_id').notNull(),
  postId:integer('post_id').notNull(),
  title:text('title').notNull(),
  type:text('type').notNull(),
  url:text('url').notNull(),
  status:text('status').notNull(),
  createdAt:text('created_at').notNull(),
  stateJson:text('state_json'),
  versionHash:text('version_hash'),
});


export const wordpressPublicationLocks = sqliteTable('studio_wordpress_publication_locks', {
  userId:text('user_id').primaryKey(),
  token:text('token').notNull(),
  expiresAt:integer('expires_at').notNull(),
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

export const instagramAssets = sqliteTable('studio_instagram_assets', {
  id:text('id').primaryKey(),
  userId:text('user_id').notNull(),
  postId:integer('post_id').notNull(),
  mediaId:integer('media_id').notNull(),
  url:text('url').notNull(),
  createdAt:text('created_at').notNull(),
});
export const instagramJobs = sqliteTable('studio_instagram_jobs', {
  id:text('id').primaryKey(),
  userId:text('user_id').notNull(),
  requestId:text('request_id').notNull().unique(),
  postId:integer('post_id').notNull(),
  status:text('status').notNull(),
  stateJson:text('state_json').notNull(),
  createdAt:text('created_at').notNull(),
  updatedAt:text('updated_at').notNull(),
},table=>[uniqueIndex('studio_instagram_jobs_user_post').on(table.userId,table.postId)]);
