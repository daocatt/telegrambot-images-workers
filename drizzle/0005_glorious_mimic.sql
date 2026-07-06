CREATE INDEX `admin_sessions_user_id_idx` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `images_tg_file_id_idx` ON `images` (`tg_file_id`);--> statement-breakpoint
CREATE INDEX `images_uploader_created_idx` ON `images` (`uploader_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `users_is_admin_idx` ON `users` (`is_admin`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);