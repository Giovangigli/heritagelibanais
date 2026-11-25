CREATE TABLE `studio_wordpress_publication_locks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `studio_wordpress_publications` ADD `state_json` text;--> statement-breakpoint
ALTER TABLE `studio_wordpress_publications` ADD `version_hash` text;