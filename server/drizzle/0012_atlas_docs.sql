CREATE TABLE `atlas_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`author_device_id` text,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_docs_slug_unique` ON `atlas_docs` (`slug`);