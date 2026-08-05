import { getPostgresConnectionOptions } from "@arc/ai-recruitment-copilot-backend/lib/server/db/connection-options";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_NAMESPACE,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
} from "./migration-settings";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const connectionOptions = {
  ...getPostgresConnectionOptions(),
  max: 1,
};
const lockClient = postgres(databaseUrl, connectionOptions);
const migrationClient = postgres(databaseUrl, connectionOptions);
const db = drizzle({ client: migrationClient });

try {
  console.log("Running database migrations...");
  await lockClient.begin(async (sql) => {
    // Serialize migrations when multiple application containers start together.
    await sql`select pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
    await migrate(db, {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
  });
  console.log("Database migrations completed.");
} finally {
  await Promise.all([lockClient.end(), migrationClient.end()]);
}
