const express = require("express");
const path = require("path");
const fs = require("fs");

const uploadRouter = require("./routes/upload");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const rawBasePath = process.env.BASE_PATH || "/demo";
const basePath =
  rawBasePath === "/"
    ? ""
    : `/${String(rawBasePath).replace(/^\/+|\/+$/g, "")}`;
const uploadsDir = path.join(__dirname, "uploads");
const generatedDir = path.join(__dirname, "..", "generated");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(generatedDir, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(`${basePath}/api/upload`, uploadRouter);
app.use(basePath || "/", express.static(path.join(__dirname, "..", "public")));

app.get(`${basePath}/health`, (_req, res) => {
  res.json({
    ok: true,
    service: "racebud.ai",
    version: "v1-upload-parser",
    basePath: basePath || "/",
    timestamp: new Date().toISOString(),
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "Uploaded file is too large for the current server limit.",
    });
  }

  return res.status(500).json({
    error: err.message || "Unexpected server error.",
  });
});

app.listen(PORT, () => {
  console.log(`RaceBud.ai listening on http://localhost:${PORT}`);
});
