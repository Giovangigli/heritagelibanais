CREATE TABLE `studio_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_token` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
