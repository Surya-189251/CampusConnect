const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.disable("x-powered-by");

if (process.env.RENDER === "true") {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);

app.post("/api/payments/razorpay/webhook", express.raw({type:"application/json",limit:"256kb"}), require("./fees").webhook);
app.use(express.json({ limit: "256kb" }));

app.use("/api/colleges", require("./colleges"));
app.use("/api/auth", require("./auth").router);
app.use("/api/faculty-requests", require("./faculty-requests"));
app.use("/api/admin/faculty-requests", require("./admin-faculty"));
app.use("/api/admin/faculty-permissions", require("./admin-permissions"));

app.use("/api/students", require("./students"));
app.use("/api/academics", require("./academics"));
app.use("/api/fees", require("./fees").router);
app.use("/api/notices", require("./notices"));
app.use("/api/timetable", require("./timetable").router);
app.use("/api/college-management", require("./college-management"));
app.use("/api/dashboard", require("./dashboard"));
app.use("/api/support", require("./support"));
app.use("/api/ai", require("./ai-help").router);

app.get("/", (req, res) => {
  res.json({
    message: "CampusConnect backend is running!",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      service: "CampusConnect API",
      database: "Connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      status: "error",
      service: "CampusConnect API",
      database: "Connection failed",
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    message: "This API route does not exist.",
  });
});

app.use((error, req, res, next) => {
  console.error(error.message);

  const status =
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;

  res.status(status).json({
    message:
      status === 400
        ? "Invalid request. Check the JSON data."
        : status === 413
          ? "The request is too large."
          : "The server could not process this request.",
  });
});

async function startServer() {
  try {
    await pool.query("SELECT 1");

    console.log("PostgreSQL connected successfully.");

    const server = app.listen(PORT, process.env.HOST || "127.0.0.1", () => {
      console.log(`CampusConnect backend: http://localhost:${PORT}`);
    });

    server.on("error", (error) => {
      console.error("Could not start the backend:", error.message);
      pool.end().finally(() => process.exit(1));
    });
  } catch (error) {
    console.error("Could not connect to PostgreSQL:", error.message);
    await pool.end();
    process.exit(1);
  }
}

startServer();