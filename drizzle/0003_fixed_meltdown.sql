CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`passcode` text,
	`layout` text DEFAULT 'grid' NOT NULL,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`tg_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD `group_id` text REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `images` ADD `sort_order` integer DEFAULT 0 NOT NULL;