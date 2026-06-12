/**
 * drizzle.config.ts — drizzle-kit configuration.
 * Migrations are generated into db/migrations and applied either by
 * `pnpm db:migrate` (setup.sh) or automatically by lib/db on first connection.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATA_DIR
      ? `${process.env.DATA_DIR}/wavesmith.db`
      : "./data/wavesmith.db",
  },
});
