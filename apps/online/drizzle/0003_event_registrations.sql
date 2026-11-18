CREATE TABLE `studio_event_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`event_post_id` integer NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_event_registration_email` ON `studio_event_registrations` (`workspace_id`,`event_post_id`,`email`);