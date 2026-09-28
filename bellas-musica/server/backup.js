// Consistent copy of the database (safe while the server is running).
//   npm run backup -- /path/to/backup.db     (also copy the uploads/ folder next to it)
import path from "node:path";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const config = loadConfig();
const dest = path.resolve(process.argv[2] || path.join(config.dataDir, `backup-${new Date().toISOString().slice(0, 10)}.db`));
const db = openDb(config);
try { db.raw.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); console.log("Database backed up to", dest, "\nAlso copy:", config.uploadDir); }
finally { db.raw.close(); }
