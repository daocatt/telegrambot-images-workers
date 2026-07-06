ALTER TABLE `email_verifications` ADD `send_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_verifications` ADD `last_sent_at` integer;--> statement-breakpoint
ALTER TABLE `email_verifications` ADD `day_reset_at` integer;
