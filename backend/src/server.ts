import cors from "cors";
import express from "express";
import { getDb } from "./db/init.js";
import { songsRouter } from "./routes/songs.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

app.use(cors());
app.use(express.json());

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Feature routes.
app.use("/api", songsRouter);

// Initialize the database (creates schema + data dirs) before serving.
getDb();

app.listen(PORT, () => {
  console.log(`Music server backend listening on http://localhost:${PORT}`);
});
