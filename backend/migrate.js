// Run explicitly: npm run db:migrate. No destructive schema changes are made.
import { createStore } from "./database.js";
const store = createStore();
if (!store) {
  console.error("Set DATABASE_URL in backend/.env first.");
  process.exitCode = 1;
} else {
  try {
    await store.migrate();
    console.log("PostgreSQL schema is ready.");
  } catch {
    console.error(
      "Migration failed. Check database credentials, connectivity and permissions.",
    );
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}
