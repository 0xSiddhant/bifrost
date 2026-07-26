CREATE TABLE `portkeys` (
	`slug` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`note` text,
	`hits` integer DEFAULT 0 NOT NULL,
	`author_device_id` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
