CREATE TABLE `eddas` (
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
CREATE UNIQUE INDEX `eddas_slug_unique` ON `eddas` (`slug`);