CREATE TABLE `studio_mailing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_mailing_jobs_request_id_unique` ON `studio_mailing_jobs` (`request_id`);