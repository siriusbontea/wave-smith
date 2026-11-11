CREATE TABLE `phone_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE TABLE `phone_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL
);
