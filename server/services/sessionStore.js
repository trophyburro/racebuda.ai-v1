const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sessionsDir = path.join(__dirname, "..", "..", "generated", "sessions");

fs.mkdirSync(sessionsDir, { recursive: true });

function createSessionId() {
  return crypto.randomUUID();
}

function getSessionPath(sessionId) {
  return path.join(sessionsDir, `${sessionId}.json`);
}

function saveSessionArtifact(sessionId, payload) {
  fs.writeFileSync(getSessionPath(sessionId), JSON.stringify(payload, null, 2), "utf8");
}

function loadSessionArtifact(sessionId) {
  const filePath = getSessionPath(sessionId);

  if (!fs.existsSync(filePath)) {
    throw new Error("Saved session artifact was not found.");
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  createSessionId,
  saveSessionArtifact,
  loadSessionArtifact,
};
