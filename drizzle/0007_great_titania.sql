CREATE TABLE `tg_login_tickets` (
	`ticket` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`expires_at` integer NOT NULL
);
