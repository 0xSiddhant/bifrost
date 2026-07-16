CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`event` text NOT NULL,
	`device_id` text,
	`ip` text,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `clipboard_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`lang` text,
	`device_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`device_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`label` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
