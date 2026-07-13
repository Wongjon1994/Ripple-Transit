CREATE TABLE `trip_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`mode` text DEFAULT 'transit' NOT NULL,
	`co2_grams` integer NOT NULL,
	`saved_grams` integer DEFAULT 0 NOT NULL,
	`distance_m` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_log_user_idx` ON `trip_log` (`user_id`);