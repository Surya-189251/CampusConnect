const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");
const connectionString = process.env.DATABASE_URL?.trim();
const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 5,
});
pool.on("error", () => console.error("Unexpected database connection error."));
module.exports = pool;
