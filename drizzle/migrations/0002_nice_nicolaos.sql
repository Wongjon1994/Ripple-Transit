CREATE TABLE `user_prefs` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
