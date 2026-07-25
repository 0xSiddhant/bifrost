CREATE TABLE `accio_links` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`author_device_id` text,
	`created_at` integer NOT NULL
);
