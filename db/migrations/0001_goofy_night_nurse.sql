CREATE TABLE `midi_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
