ALTER TABLE `threads` ADD `native_session_host_id` text;--> statement-breakpoint
UPDATE `threads`
SET `native_session_host_id` = (
	SELECT `host_id`
	FROM `environments`
	WHERE `environments`.`id` = `threads`.`environment_id`
)
WHERE `environment_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_native_session_host_provider_idx` ON `threads` (`native_session_host_id`,`provider_id`);
