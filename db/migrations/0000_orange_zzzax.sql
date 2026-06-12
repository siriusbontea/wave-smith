CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error` text,
	`progress` real,
	`song_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`lyrics` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`bpm` integer,
	`key_scale` text,
	`time_signature` text,
	`duration_s` real,
	`seed` text,
	`model` text NOT NULL,
	`variation_group_id` text NOT NULL,
	`audio_path` text NOT NULL,
	`lrc` text,
	`quality_score` real,
	`art_seed` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stems` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`stem_name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
