function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function rotateArray(items, startIndex) {
  if (!items.length || startIndex <= 0) {
    return items.slice();
  }

  return items.slice(startIndex).concat(items.slice(0, startIndex));
}

function normalize(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const padding = 36;
  const viewport = 640;
  const scale = Math.min(
    (viewport - padding * 2) / width,
    (viewport - padding * 2) / height
  );

  const normalizedPoints = points.map((point) => ({
    ...point,
    svgX: Number(((point.x - minX) * scale + padding).toFixed(2)),
    svgY: Number((viewport - ((point.y - minY) * scale + padding)).toFixed(2)),
  }));

  return {
    points: normalizedPoints,
    bounds: { minX, maxX, minY, maxY, width, height },
    viewport,
  };
}

function sampleLapPoints(samples) {
  const raw = samples
    .map((sample, index) => ({
      index,
      x: sample.x,
      y: sample.y,
      speed: sample.speed,
      time: sample.time,
      distance: sample.distance,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (raw.length < 12) {
    return raw;
  }

  const sampled = [];
  let carryDistance = 0;

  for (let i = 0; i < raw.length; i += 1) {
    if (!sampled.length) {
      sampled.push(raw[i]);
      continue;
    }

    carryDistance += distance(raw[i - 1], raw[i]);
    if (carryDistance >= 2.5 || i === raw.length - 1) {
      sampled.push(raw[i]);
      carryDistance = 0;
    }
  }

  return sampled;
}

function computePathMetrics(points) {
  let totalLength = 0;
  const withMetrics = points.map((point, index) => {
    if (index > 0) {
      totalLength += distance(points[index - 1], point);
    }

    return {
      ...point,
      progress: totalLength,
    };
  });

  return {
    totalLength,
    points: withMetrics.map((point) => ({
      ...point,
      progressRatio: totalLength > 0 ? point.progress / totalLength : 0,
    })),
  };
}

function computeCurvature(points, index, spacing = 4) {
  if (index - spacing < 0 || index + spacing >= points.length) {
    return 0;
  }

  const prev = points[index - spacing];
  const current = points[index];
  const next = points[index + spacing];

  const v1x = current.x - prev.x;
  const v1y = current.y - prev.y;
  const v2x = next.x - current.x;
  const v2y = next.y - current.y;

  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

  if (!mag1 || !mag2) {
    return 0;
  }

  const dot = v1x * v2x + v1y * v2y;
  const ratio = clamp(dot / (mag1 * mag2), -1, 1);
  const angle = Math.acos(ratio);

  return angle;
}

function detectTurns(points) {
  const candidates = [];

  for (let i = 6; i < points.length - 6; i += 1) {
    const curvature = computeCurvature(points, i, 4);
    const speed = Number.isFinite(points[i].speed) ? points[i].speed : null;

    if (curvature < 0.22) {
      continue;
    }

    candidates.push({
      pointIndex: i,
      curvature,
      speed,
      progressRatio: points[i].progressRatio,
    });
  }

  candidates.sort((a, b) => b.curvature - a.curvature);
  const selected = [];

  for (const candidate of candidates) {
    const tooClose = selected.some(
      (chosen) => Math.abs(chosen.progressRatio - candidate.progressRatio) < 0.06
    );

    if (tooClose) {
      continue;
    }

    selected.push(candidate);

    if (selected.length >= 12) {
      break;
    }
  }

  return selected
    .sort((a, b) => a.progressRatio - b.progressRatio)
    .map((turn, index) => ({
      id: `T${index + 1}`,
      index: turn.pointIndex,
      curvature: Number(turn.curvature.toFixed(3)),
      x: points[turn.pointIndex].x,
      y: points[turn.pointIndex].y,
      svgX: points[turn.pointIndex].svgX,
      svgY: points[turn.pointIndex].svgY,
      progressRatio: Number(turn.progressRatio.toFixed(4)),
      speed: turn.speed,
    }));
}

function buildSectors(points, lapTime) {
  const sectorCount = clamp(Math.round(lapTime / 15), 3, 5);

  return Array.from({ length: sectorCount }, (_, index) => {
    const ratio = index / sectorCount;
    const endRatio = (index + 1) / sectorCount;
    const pointIndex = clamp(
      Math.round(ratio * (points.length - 1)),
      0,
      points.length - 1
    );

    return {
      id: `S${index + 1}`,
      startRatio: Number(ratio.toFixed(4)),
      endRatio: Number(endRatio.toFixed(4)),
      pointIndex,
      x: points[pointIndex].x,
      y: points[pointIndex].y,
      svgX: points[pointIndex].svgX,
      svgY: points[pointIndex].svgY,
    };
  });
}

function buildSvg(points, sectors, turns) {
  const pathData = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.svgX} ${point.svgY}`)
    .join(" ");

  const sectorMarkup = sectors
    .map(
      (sector) => `
        <g>
          <circle cx="${sector.svgX}" cy="${sector.svgY}" r="5" fill="#f59e0b" />
          <text x="${sector.svgX + 10}" y="${sector.svgY - 10}" font-size="16" font-weight="700" fill="#7c4a03">${sector.id}</text>
        </g>
      `
    )
    .join("");

  const turnMarkup = turns
    .map(
      (turn) => `
        <g>
          <circle cx="${turn.svgX}" cy="${turn.svgY}" r="6" fill="#5d2eb3" />
          <text x="${turn.svgX + 10}" y="${turn.svgY + 4}" font-size="16" font-weight="700" fill="#5d2eb3">${turn.id}</text>
        </g>
      `
    )
    .join("");

  const start = points[0];

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-label="RaceBud track map">
      <rect width="640" height="640" rx="32" fill="#fffaf2" />
      <path d="${pathData} Z" fill="none" stroke="#1f2328" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="${start.svgX - 14}" y1="${start.svgY - 14}" x2="${start.svgX + 14}" y2="${start.svgY + 14}" stroke="#1d7f56" stroke-width="4" />
      <line x1="${start.svgX + 14}" y1="${start.svgY - 14}" x2="${start.svgX - 14}" y2="${start.svgY + 14}" stroke="#1d7f56" stroke-width="4" />
      <text x="${start.svgX + 18}" y="${start.svgY + 4}" font-size="16" font-weight="700" fill="#1d7f56">START</text>
      ${sectorMarkup}
      ${turnMarkup}
    </svg>
  `.trim();
}

function findNearestPointIndex(points, manualStartSvg) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const dx = point.svgX - manualStartSvg.x;
    const dy = point.svgY - manualStartSvg.y;
    const candidateDistance = Math.sqrt(dx * dx + dy * dy);

    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function generateTrackMap(parsedSessions, options = {}) {
  const lapCandidates = [];

  parsedSessions.forEach((session) => {
    session.laps
      .filter((lap) => lap.hotCandidate)
      .forEach((lap) => {
        lapCandidates.push({
          session,
          lap,
        });
      });
  });

  if (!lapCandidates.length) {
    return {
      ready: false,
      reason: "No hot laps were available for map generation.",
    };
  }

  const representative = lapCandidates
    .slice()
    .sort((a, b) => a.lap.lapTime - b.lap.lapTime)[0];

  const lapSamples = representative.session.samples.slice(
    representative.lap.startIndex,
    representative.lap.endIndex + 1
  );
  const sampled = sampleLapPoints(lapSamples);

  if (sampled.length < 12) {
    return {
      ready: false,
      reason: "Representative lap did not have enough GPS points.",
    };
  }

  const metricPath = computePathMetrics(sampled);
  let normalized = normalize(metricPath.points);
  let manualStartPoint = null;

  if (options.manualStartSvg && Number.isFinite(options.manualStartSvg.x) && Number.isFinite(options.manualStartSvg.y)) {
    const chosenIndex = findNearestPointIndex(normalized.points, options.manualStartSvg);
    const rotatedMetricPoints = rotateArray(metricPath.points, chosenIndex);
    normalized = normalize(computePathMetrics(rotatedMetricPoints).points);
    manualStartPoint = {
      requestedSvgX: options.manualStartSvg.x,
      requestedSvgY: options.manualStartSvg.y,
      chosenIndex,
    };
  }

  const sectors = buildSectors(normalized.points, representative.lap.lapTime);
  const turns = detectTurns(normalized.points);
  const svg = buildSvg(normalized.points, sectors, turns);
  const loopClosureError = distance(normalized.points[0], normalized.points[normalized.points.length - 1]);

  return {
    ready: true,
    sourceFile: representative.session.fileName,
    lapNumber: representative.lap.lapNumber,
    lapTime: representative.lap.lapTime,
    startPoint: {
      x: normalized.points[0].x,
      y: normalized.points[0].y,
      svgX: normalized.points[0].svgX,
      svgY: normalized.points[0].svgY,
    },
    sectorCount: sectors.length,
    turnCount: turns.length,
    loopClosureError: Number(loopClosureError.toFixed(2)),
    needsUserConfirmation: loopClosureError > 20,
    startSource: manualStartPoint ? "manual_selection" : "auto_fastest_lap",
    manualStartPoint,
    sectors,
    turns,
    svg,
  };
}

module.exports = {
  generateTrackMap,
};
