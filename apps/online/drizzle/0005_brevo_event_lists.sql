CREATE TABLE `studio_brevo_event_lists` (
	`workspace_id` text NOT NULL,
	`event_post_id` integer NOT NULL,
	`list_id` integer,
	`locked_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `event_post_id`)
);
