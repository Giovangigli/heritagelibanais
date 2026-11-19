CREATE TABLE `studio_instagram_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`post_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`url` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_instagram_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`post_id` integer NOT NULL,
	`status` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_instagram_jobs_request_id_unique` ON `studio_instagram_jobs` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `studio_instagram_jobs_user_post` ON `studio_instagram_jobs` (`user_id`,`post_id`);