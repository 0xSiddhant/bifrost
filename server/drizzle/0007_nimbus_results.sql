CREATE TABLE `nimbus_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text,
	`down_mbps` real NOT NULL,
	`up_mbps` real NOT NULL,
	`latency_ms` real NOT NULL,
	`test_mb` integer NOT NULL,
	`created_at` integer NOT NULL
);
