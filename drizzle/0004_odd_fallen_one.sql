CREATE TABLE `email_verifications` (
	`email` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `groups_user_idx` ON `groups` (`user_id`);--> statement-breakpoint
CREATE INDEX `images_uploader_idx` ON `images` (`uploader_id`);--> statement-breakpoint
CREATE INDEX `images_group_idx` ON `images` (`group_id`);--> statement-breakpoint
CREATE INDEX `images_created_at_idx` ON `images` (`created_at`);