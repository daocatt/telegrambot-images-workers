PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tg_login_tickets` (
	`ticket` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`tg_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tg_login_tickets`("ticket", "user_id", "code", "expires_at") SELECT "ticket", "user_id", "code", "expires_at" FROM `tg_login_tickets`;--> statement-breakpoint
DROP TABLE `tg_login_tickets`;--> statement-breakpoint
ALTER TABLE `__new_tg_login_tickets` RENAME TO `tg_login_tickets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tg_login_tickets_user_id_idx` ON `tg_login_tickets` (`user_id`);