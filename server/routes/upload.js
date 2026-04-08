const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseAimCsv, combineParsedSessions } = require("../services/parseAimCsv");
const { generateTrackMap } = require("../services/generateTrackMap");
const { analyzeCoaching } = require("../services/analyzeCoaching");
const {
  createSessionId,
  saveSessionArtifact,
  loadSessionArtifact,
} = require("../services/sessionStore");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".csv") {
      return cb(new Error("Only CSV uploads are supported in V1."));
    }

    return cb(null, true);
  },
});

router.post("/", upload.array("sessions", 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    const sessionName = (req.body.sessionName || "Session 1").trim() || "Session 1";

    if (!files.length) {
      return res.status(400).json({ error: "Upload at least one AiM CSV file." });
    }

    const parsed = [];
    const errors = [];

    for (const file of files) {
      try {
        const csvText = fs.readFileSync(file.path, "utf8");
        const parsedFile = parseAimCsv(csvText, {
          fileName: file.originalname,
          uploadPath: file.path,
        });

        parsed.push(parsedFile);
      } catch (error) {
        errors.push({
          fileName: file.originalname,
          error: error.message,
        });
      }
    }

    if (!parsed.length) {
      return res.status(400).json({
        error: "None of the uploaded files could be parsed.",
        parseErrors: errors,
      });
    }

    const combined = combineParsedSessions(parsed, {
      requestedSessionName: sessionName,
    });
    const trackMap = generateTrackMap(parsed);
    const coaching = analyzeCoaching(parsed, {
      trackMap: trackMap.ready ? trackMap : undefined,
    });
    const sessionId = createSessionId();

    saveSessionArtifact(sessionId, {
      sessionName,
      parsedSessions: parsed,
      combinedResult: combined,
      latestTrackMap: trackMap,
      latestCoaching: coaching,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      sessionId,
      sessionName,
      uploadedCount: files.length,
      parsedCount: parsed.length,
      parseErrors: errors,
      result: combined,
      trackMap,
      coaching,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:sessionId/start-finish", express.json({ limit: "1mb" }), (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { svgX, svgY } = req.body || {};

    if (!Number.isFinite(svgX) || !Number.isFinite(svgY)) {
      return res.status(400).json({
        error: "svgX and svgY are required numeric values.",
      });
    }

    const artifact = loadSessionArtifact(sessionId);
    const trackMap = generateTrackMap(artifact.parsedSessions, {
      manualStartSvg: { x: svgX, y: svgY },
    });
    const coaching = analyzeCoaching(artifact.parsedSessions, {
      profileId: artifact.selectedProfileId,
      trackMap: trackMap.ready ? trackMap : undefined,
    });

    saveSessionArtifact(sessionId, {
      ...artifact,
      latestTrackMap: trackMap,
      latestCoaching: coaching,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      sessionId,
      trackMap,
      coaching,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:sessionId/profile", express.json({ limit: "1mb" }), (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { profileId } = req.body || {};

    if (!profileId) {
      return res.status(400).json({
        error: "profileId is required.",
      });
    }

    const artifact = loadSessionArtifact(sessionId);
    const coaching = analyzeCoaching(artifact.parsedSessions, {
      profileId,
      trackMap: artifact.latestTrackMap?.ready ? artifact.latestTrackMap : undefined,
    });

    saveSessionArtifact(sessionId, {
      ...artifact,
      latestCoaching: coaching,
      selectedProfileId: profileId,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      sessionId,
      coaching,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
