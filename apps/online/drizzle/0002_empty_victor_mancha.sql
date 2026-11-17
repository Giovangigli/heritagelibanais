CREATE TABLE `studio_wordpress_publications` (
	`slug` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`post_id` integer NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
