const form = document.getElementById("upload-form");
const results = document.getElementById("results");
const trackMap = document.getElementById("track-map");
const coaching = document.getElementById("coaching");
const statusPill = document.getElementById("status-pill");
const submitButton = document.getElementById("submit-button");
let currentSessionId = null;
let mapSelectionMode = false;
const uploadApiUrl = new URL("./api/upload", window.location.href);

function formatLapTime(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "n/a";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(3).padStart(6, "0")}`;
}

function setStatus(label, type) {
  statusPill.textContent = label;
  statusPill.dataset.state = type;
}

function renderWarnings(warnings) {
  if (!warnings || !warnings.length) {
    return "";
  }

  return `
    <div class="warning-box">
      <h3>Parser Warnings</h3>
      <ul>
        ${warnings.map((warning) => `<li>${warning}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderLapList(file) {
  if (!file.laps.length) {
    return `<p class="muted">No laps were recovered from beacon markers yet.</p>`;
  }

  return `
    <div class="lap-list">
      ${file.laps
        .map((lap) => {
          const classes = ["lap-card"];
          if (lap.isFastest) classes.push("is-fastest");
          if (!lap.hotCandidate) classes.push("is-flagged");

          return `
            <article class="${classes.join(" ")}">
              <div class="lap-card-top">
                <strong>Lap ${lap.lapNumber}</strong>
                <span>${formatLapTime(lap.lapTime)}</span>
              </div>
              <p>Average speed: ${lap.avgSpeed ? lap.avgSpeed.toFixed(1) : "n/a"} ${file.metadata.speedUnit || ""}</p>
              <p>Loop closure error: ${lap.loopClosureError != null ? lap.loopClosureError.toFixed(1) : "n/a"} m</p>
              <p>Flags: ${lap.flags.length ? lap.flags.join(", ") : "clean hot candidate"}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTrackMap(trackMapPayload) {
  trackMap.classList.remove("selecting");

  if (!trackMapPayload || !trackMapPayload.ready) {
    trackMap.classList.add("empty");
    trackMap.innerHTML = `
      <div class="warning-box">
        <h3>Track map not ready</h3>
        <p>${trackMapPayload?.reason || "No hot lap available yet."}</p>
      </div>
    `;
    return;
  }

  trackMap.classList.remove("empty");
  trackMap.innerHTML = `
    <div class="map-meta">
      <div>
        <h3>Representative lap</h3>
        <p>${trackMapPayload.sourceFile} - Lap ${trackMapPayload.lapNumber} in ${formatLapTime(trackMapPayload.lapTime)}</p>
      </div>
      <div class="map-badges">
        <span class="map-badge">Sectors: ${trackMapPayload.sectorCount}</span>
        <span class="map-badge">Turns: ${trackMapPayload.turnCount}</span>
        <span class="map-badge">Loop error: ${trackMapPayload.loopClosureError} m</span>
      </div>
    </div>

    <div class="map-frame">${trackMapPayload.svg}</div>

    <div class="map-confirm">
      <p>Is this map correct?</p>
      <div class="confirm-actions">
        <button type="button" class="secondary-button" data-map-confirm="yes">Yes</button>
        <button type="button" class="secondary-button ghost-button" data-map-confirm="no">No</button>
      </div>
      <p id="map-confirmation-message" class="muted"></p>
      <p class="muted">
        ${
          trackMapPayload.needsUserConfirmation
            ? "Start/finish confidence is low, so please confirm the map."
            : "Confirm the map before trusting the analysis."
        }
      </p>
      <p class="muted">If it is wrong, click No and pick the correct start/finish point.</p>
    </div>
  `;
}

function formatRpm(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${Math.round(value).toLocaleString()} rpm`;
}

function formatThrottle(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  const normalized = value <= 1.5 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function getTurnAreaLabel(trackMapPayload, startRatio, endRatio, sectorId) {
  if (!trackMapPayload?.turns?.length || !trackMapPayload?.sectors?.length) {
    return "Turn area not mapped yet";
  }

  const safeStart = typeof startRatio === "number" ? startRatio : 0;
  const safeEnd = typeof endRatio === "number" ? endRatio : 1;
  const turnsInRange = trackMapPayload.turns
    .filter((turn) => turn.progressRatio >= safeStart && turn.progressRatio < safeEnd)
    .map((turn) => turn.id);

  if (!turnsInRange.length) {
    return `${sectorId} track area`;
  }

  if (turnsInRange.length === 1) {
    return `${turnsInRange[0]} area`;
  }

  return turnsInRange.join(", ");
}

function renderCoaching(coachingPayload) {
  if (!coachingPayload || !coachingPayload.ready) {
    coaching.classList.add("empty");
    coaching.innerHTML = `
      <div class="warning-box">
        <h3>Coaching not ready</h3>
        <p>${coachingPayload?.reason || "No usable hot laps available yet."}</p>
      </div>
    `;
    return;
  }

  coaching.classList.remove("empty");
  coaching.innerHTML = `
    <section class="coaching-section">
      <div class="section-kicker">Working Now</div>
      <h3 class="section-title">Trusted Coaching</h3>
      <p class="muted section-note">Use this section first. This is the clearest working output in V1.</p>

      <div class="highlight-box">
        <h3>${coachingPayload.profile.label}</h3>
        <p>Best lap: ${coachingPayload.bestLap.sourceFile}, Lap ${coachingPayload.bestLap.lapNumber}, ${formatLapTime(coachingPayload.bestLap.lapTime)}</p>
        <p>Use the map and lap list to check where the speed is gained or lost.</p>
      </div>

      ${
        coachingPayload.profile.needsConfirmation
          ? `
            <div class="warning-box">
              <h3>Confirm vehicle class</h3>
              <p>Pick the right class so the coaching uses the right logic.</p>
              <div class="confirm-actions">
                ${coachingPayload.availableProfiles
                  .map(
                    (profile) => `
                      <button type="button" class="secondary-button" data-profile-id="${profile.id}">
                        ${profile.label}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }

      <div class="coaching-grid">
        <article class="file-card">
          <h3>Executive Summary</h3>
          <ol class="coaching-list">
            ${coachingPayload.executiveSummary.map((line) => `<li>${line}</li>`).join("")}
          </ol>
        </article>

        <article class="file-card">
          <h3>Consistency Drill</h3>
          <p>${coachingPayload.consistencyDrill}</p>
        </article>
      </div>

      <article class="file-card">
        <h3>Top 3 Biggest Mistakes To Fix</h3>
        <div class="improvement-list">
          ${coachingPayload.improvements
            .map(
              (item, index) => `
                <div class="improvement-card ${index === 0 ? "is-priority" : ""}">
                  <div class="lap-card-top">
                    <strong>${index + 1}. ${item.title}</strong>
                    <span>${item.sector} +${item.timeGainMs}ms</span>
                  </div>
                  <p>${item.detail}</p>
                  ${
                    coachingPayload.projectedBestSectorLap.sectorGains.find((sector) => sector.id === item.sector)
                      ? (() => {
                          const sector = coachingPayload.projectedBestSectorLap.sectorGains.find(
                            (entry) => entry.id === item.sector
                          );
                          return `
                            <details class="coach-detail">
                            <summary>Exit RPM notes</summary>
                            <p>Likely area: ${getTurnAreaLabel(window.__lastTrackMapPayload, sector.startRatio, sector.endRatio, sector.id)}</p>
                            ${
                              coachingPayload.profile.id === "trophy_kart_mod_5_speed"
                                ? `
                                    <p>Fastest-lap exit RPM: ${formatRpm(sector.bestLapExitRpm ?? sector.bestLapAvgRpm)}</p>
                                    <p>Best source exit RPM: ${formatRpm(sector.sourceExitRpm ?? sector.sourceAvgRpm)}</p>
                                    <p>Fastest-lap exit throttle: ${formatThrottle(sector.bestLapExitThrottle ?? sector.bestLapAvgThrottle)}</p>
                                    <p>Best source exit throttle: ${formatThrottle(sector.sourceExitThrottle ?? sector.sourceAvgThrottle)}</p>
                                  `
                                  : ""
                              }
                              <p>Fastest-lap RPM here: ${formatRpm(sector.bestLapAvgRpm)} (${formatRpm(sector.bestLapMinRpm)} to ${formatRpm(sector.bestLapMaxRpm)})</p>
                              <p>Best source RPM here: ${formatRpm(sector.sourceAvgRpm)} (${formatRpm(sector.sourceMinRpm)} to ${formatRpm(sector.sourceMaxRpm)})</p>
                              <p>Fastest-lap throttle here: ${formatThrottle(sector.bestLapAvgThrottle)}</p>
                              <p>Best source throttle here: ${formatThrottle(sector.sourceAvgThrottle)}</p>
                              <p>Best source: ${sector.sourceFile}, Lap ${sector.lapNumber}</p>
                            </details>
                          `;
                        })()
                      : ""
                  }
                </div>
              `
            )
            .join("")}
        </div>
      </article>

      ${
        coachingPayload.dataQualityWarnings.length
          ? `
            <div class="warning-box">
              <h3>Data Quality</h3>
              <ul>
                ${coachingPayload.dataQualityWarnings.map((warning) => `<li>${warning}</li>`).join("")}
              </ul>
            </div>
          `
          : `<div class="ok-box">No major data quality warnings on the current fastest lap.</div>`
      }
    </section>

    <section class="coaching-section dev-section">
      <div class="section-kicker">In Development</div>
      <h3 class="section-title">Beta Analysis</h3>
      <p class="muted section-note">These tools are still being checked and should not be treated as final yet.</p>

      <article class="file-card">
        <h3>Fastest Distance Sector Sources</h3>
        <p class="muted">Best source lap for each RaceBud distance sector. Beta only.</p>
        <div class="sector-source-list">
          ${coachingPayload.projectedBestSectorLap.sectorGains
            .map(
              (sector) => `
                <div class="sector-source-card">
                  <div class="lap-card-top">
                    <strong>${sector.id}</strong>
                    <span>${formatLapTime(sector.optimalTime)}</span>
                  </div>
                  <p>Likely area: ${getTurnAreaLabel(window.__lastTrackMapPayload, sector.startRatio, sector.endRatio, sector.id)}</p>
                  <p>Fastest source: ${sector.sourceFile}</p>
                  <p>Lap ${sector.lapNumber}</p>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
    </section>
  `;
}

function renderResults(payload) {
  const {
    result,
    parsedCount,
    uploadedCount,
    parseErrors,
    trackMap: trackMapPayload,
    coaching: coachingPayload,
  } = payload;
  currentSessionId = payload.sessionId || currentSessionId;
  mapSelectionMode = false;
  window.__lastTrackMapPayload = trackMapPayload;

  results.classList.remove("empty");
  renderTrackMap(trackMapPayload);
  renderCoaching(coachingPayload);
  results.innerHTML = `
    <div class="summary-grid">
      <article class="summary-card">
        <span class="summary-label">Uploaded files</span>
        <strong>${uploadedCount}</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Parsed files</span>
        <strong>${parsedCount}</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Recovered laps</span>
        <strong>${result.summary.totalLaps}</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Hot laps</span>
        <strong>${result.summary.hotLaps}</strong>
      </article>
    </div>

    ${
      result.summary.fastestLap
        ? `
          <div class="highlight-box">
            <h3>Fastest lap so far</h3>
            <p>
              ${result.summary.fastestLap.sourceFile} - Lap ${result.summary.fastestLap.lapNumber}
              in ${formatLapTime(result.summary.fastestLap.lapTime)}
            </p>
          </div>
        `
        : `
          <div class="warning-box">
            <h3>No confirmed hot lap yet</h3>
            <p>Clean hot laps are needed before map generation.</p>
          </div>
        `
    }

    ${renderWarnings(result.parseWarnings)}

    ${
      parseErrors && parseErrors.length
        ? `
          <div class="warning-box">
            <h3>File parse errors</h3>
            <ul>
              ${parseErrors.map((item) => `<li>${item.fileName}: ${item.error}</li>`).join("")}
            </ul>
          </div>
        `
        : ""
    }

    <div class="turn-map-box">
      <h3>Map Status</h3>
      <p>Ready: ${result.turnMapStatus.readyForGeneration ? "yes" : "not yet"}</p>
      <p>Next: ${result.turnMapStatus.nextStep}</p>
    </div>

    <section class="file-results">
      ${result.files
        .map(
          (file) => `
            <article class="file-card">
              <h3>${file.fileName}</h3>
              <p>Session: ${file.metadata.session || "Unknown session"}</p>
              <p>Driver: ${file.metadata.racer || "Unknown driver"}</p>
              <p>Vehicle: ${file.metadata.vehicle || "Unknown vehicle"}</p>
              <p>Start/finish confidence: ${(file.startFinish.confidence * 100).toFixed(0)}%</p>
              ${renderLapList(file)}
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

async function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(form);
  setStatus("Parsing...", "working");
  submitButton.disabled = true;
  mapSelectionMode = false;
  trackMap.classList.remove("selecting");
  trackMap.classList.add("empty");
  trackMap.textContent = "Building track map from filtered hot laps...";
  coaching.classList.add("empty");
  coaching.textContent = "Building first-pass coaching advice...";
  results.classList.add("empty");
  results.textContent = "Uploading and parsing AiM files...";

  try {
    const response = await fetch(uploadApiUrl, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();

    if (!response.ok) {
      const parseDetails = payload.parseErrors?.length
        ? ` ${payload.parseErrors.map((item) => `${item.fileName}: ${item.error}`).join(" | ")}`
        : "";
      throw new Error((payload.error || "Upload failed.") + parseDetails);
    }

    renderResults(payload);
    setStatus("Parsed", "success");
  } catch (error) {
    results.classList.remove("empty");
    results.innerHTML = `<div class="warning-box"><h3>Upload failed</h3><p>${error.message}</p></div>`;
    setStatus("Failed", "error");
  } finally {
    submitButton.disabled = false;
  }
}

form.addEventListener("submit", handleSubmit);

async function submitManualStartSelection(svgX, svgY) {
  if (!currentSessionId) {
    return;
  }

  setStatus("Rebuilding map...", "working");
  trackMap.classList.add("selecting");

  const startFinishUrl = new URL(`./api/upload/${currentSessionId}/start-finish`, window.location.href);
  const response = await fetch(startFinishUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ svgX, svgY }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Could not rebuild the map from the selected start point.");
  }

  mapSelectionMode = false;
  renderTrackMap(payload.trackMap);
  setStatus("Map corrected", "success");
}

async function submitProfileSelection(profileId) {
  if (!currentSessionId) {
    return;
  }

  setStatus("Updating coaching...", "working");

  const profileUrl = new URL(`./api/upload/${currentSessionId}/profile`, window.location.href);
  const response = await fetch(profileUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profileId }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Could not update the coaching profile.");
  }

  renderCoaching(payload.coaching);
  setStatus("Profile updated", "success");
}

trackMap.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-map-confirm]");
  const message = document.getElementById("map-confirmation-message");

  if (button) {
    if (!message) {
      return;
    }

    if (button.dataset.mapConfirm === "yes") {
      mapSelectionMode = false;
      trackMap.classList.remove("selecting");
      message.textContent = "Map confirmed. Use the coaching below.";
    } else {
      mapSelectionMode = true;
      trackMap.classList.add("selecting");
      message.textContent = "Click the correct start/finish point on the map to rebuild it.";
    }
    return;
  }

  const svg = event.target.closest("svg");
  if (!svg || !mapSelectionMode || !currentSessionId) {
    return;
  }

  const bounds = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const svgX = ((event.clientX - bounds.left) / bounds.width) * viewBox.width;
  const svgY = ((event.clientY - bounds.top) / bounds.height) * viewBox.height;

  try {
    await submitManualStartSelection(svgX, svgY);
    const updatedMessage = document.getElementById("map-confirmation-message");
    if (updatedMessage) {
      updatedMessage.textContent = "Manual start/finish applied. Confirm the corrected map.";
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
    setStatus("Correction failed", "error");
  }
});

coaching.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-profile-id]");

  if (!button) {
    return;
  }

  try {
    await submitProfileSelection(button.dataset.profileId);
  } catch (error) {
    setStatus("Profile update failed", "error");
  }
});
