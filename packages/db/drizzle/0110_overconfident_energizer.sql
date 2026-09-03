CREATE TABLE IF NOT EXISTS `native_session_archive_confirmations` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`provider_thread_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
