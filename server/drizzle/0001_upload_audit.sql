CREATE TABLE `upload_audit` (
	`stored_name` text PRIMARY KEY NOT NULL,
	`original_name` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_at` integer NOT NULL,
	`uploader_hint` text
);
