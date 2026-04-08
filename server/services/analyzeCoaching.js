function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function peak(values) {
  if (!values.length) {
    return null;
  }

  return Math.max(...values);
}

function trailingAverage(values, count = 5) {
  if (!values.length) {
    return null;
  }

  const slice = values.slice(-count);
  return average(slice);
}

function clampMs(value) {
  return Math.max(10, Math.round(value));
}

function roundLapProjection(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function formatLapTime(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "n/a";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(3).padStart(6, "0")}`;
}

const VEHICLE_PROFILES = {
  trophy_kart_junior2_cvt: {
    id: "trophy_kart_junior2_cvt",
    label: "Junior 2 Trophy Kart (CVT)",
    family: "trophy_kart",
    drivetrain: "cvt",
    coachingFocus: "momentum_and_belt_engagement",
    needsConfirmation: false,
  },
  trophy_kart_mod_5_speed: {
    id: "trophy_kart_mod_5_speed",
    label: "Mod Kart Trophy Kart (450cc 5-speed)",
    family: "trophy_kart",
    drivetrain: "geared",
    powerBandRpm: {
      min: 9500,
      max: 11000,
    },
    coachingFocus: "rpm_power_band_and_drive_off",
    needsConfirmation: false,
  },
  trophy_kart_unknown: {
    id: "trophy_kart_unknown",
    label: "Trophy Kart (profile not confirmed)",
    family: "trophy_kart",
    drivetrain: "unknown",
    coachingFocus: "general_dirt_kart",
    needsConfirmation: true,
  },
};

function detectVehicleProfile(parsedSessions) {
  const haystack = parsedSessions
    .map((session) => `${session.metadata.session || ""} ${session.metadata.vehicle || ""} ${session.metadata.comment || ""}`)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("jr2") || haystack.includes("j2") || haystack.includes("junior 2")) {
    return VEHICLE_PROFILES.trophy_kart_junior2_cvt;
  }

  if (haystack.includes("mod")) {
    return VEHICLE_PROFILES.trophy_kart_mod_5_speed;
  }

  return VEHICLE_PROFILES.trophy_kart_unknown;
}

function getHotLapCandidates(parsedSessions) {
  const laps = [];

  parsedSessions.forEach((session) => {
    session.laps
      .filter((lap) => lap.hotCandidate)
      .forEach((lap) => {
        const samples = session.samples.slice(lap.startIndex, lap.endIndex + 1);
        const speeds = samples.map((sample) => sample.speed).filter((value) => Number.isFinite(value));
        const rpms = samples.map((sample) => sample.rpm).filter((value) => Number.isFinite(value));
        const throttles = samples.map((sample) => sample.throttle).filter((value) => Number.isFinite(value));

        laps.push({
          sourceFile: session.fileName,
          lapNumber: lap.lapNumber,
          lapTime: lap.lapTime,
          avgSpeed: lap.avgSpeed,
          loopClosureError: lap.loopClosureError,
          avgThrottle: average(throttles),
          maxThrottle: peak(throttles),
          avgRpm: average(rpms),
          minRpm: rpms.length ? Math.min(...rpms) : null,
          maxRpm: peak(rpms),
          avgSampleSpeed: average(speeds),
          samples,
        });
      });
  });

  return laps.sort((a, b) => a.lapTime - b.lapTime);
}

function getSectorFractions(sectorCount = 5) {
  return Array.from({ length: sectorCount + 1 }, (_, index) => index / sectorCount);
}

function distanceBetweenPoints(a, b) {
  if (
    !a ||
    !b ||
    !Number.isFinite(a.x) ||
    !Number.isFinite(a.y) ||
    !Number.isFinite(b.x) ||
    !Number.isFinite(b.y)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeSectorDefinitions(trackMap, fallbackSectorCount = 5) {
  if (Array.isArray(trackMap?.sectors) && trackMap.sectors.length) {
    return trackMap.sectors.map((sector, index) => ({
      id: sector.id || `S${index + 1}`,
      startRatio:
        typeof sector.startRatio === "number"
          ? sector.startRatio
          : index / trackMap.sectors.length,
      endRatio:
        typeof sector.endRatio === "number"
          ? sector.endRatio
          : (index + 1) / trackMap.sectors.length,
      x: typeof sector.x === "number" ? sector.x : null,
      y: typeof sector.y === "number" ? sector.y : null,
    }));
  }

  const fractions = getSectorFractions(fallbackSectorCount);
  return Array.from({ length: fallbackSectorCount }, (_, index) => ({
    id: `S${index + 1}`,
    startRatio: fractions[index],
    endRatio: fractions[index + 1],
    x: null,
    y: null,
  }));
}

function getSampleProgress(sample, index, sampleCount, firstDistance, totalDistance) {
  if (Number.isFinite(sample.distance) && Number.isFinite(firstDistance) && totalDistance > 0) {
    return Math.max(0, Math.min(1, (sample.distance - firstDistance) / totalDistance));
  }

  if (sampleCount <= 1) {
    return 0;
  }

  return index / (sampleCount - 1);
}

function buildProgressSeries(samples) {
  if (!samples.length) {
    return [];
  }

  const firstTime = samples[0].time;
  const firstDistance = Number.isFinite(samples[0].distance) ? samples[0].distance : null;
  const lastDistance = Number.isFinite(samples[samples.length - 1].distance)
    ? samples[samples.length - 1].distance
    : null;
  const totalDistance =
    firstDistance != null && lastDistance != null ? lastDistance - firstDistance : null;

  return samples.map((sample, index) => ({
    progress: getSampleProgress(sample, index, samples.length, firstDistance, totalDistance),
    elapsed: Math.max(0, sample.time - firstTime),
    speed: Number.isFinite(sample.speed) ? sample.speed : null,
    rpm: Number.isFinite(sample.rpm) ? sample.rpm : null,
    throttle: Number.isFinite(sample.throttle) ? sample.throttle : null,
  }));
}

function interpolateSeriesValue(series, targetProgress, key) {
  if (!series.length) {
    return null;
  }

  if (targetProgress <= series[0].progress) {
    return series[0][key];
  }

  for (let index = 1; index < series.length; index += 1) {
    const prev = series[index - 1];
    const current = series[index];

    if (targetProgress > current.progress) {
      continue;
    }

    const span = current.progress - prev.progress;
    if (span <= 0) {
      return current[key];
    }

    const ratio = (targetProgress - prev.progress) / span;
    const prevValue = prev[key];
    const currentValue = current[key];

    if (!Number.isFinite(prevValue) || !Number.isFinite(currentValue)) {
      return Number.isFinite(currentValue) ? currentValue : prevValue;
    }

    return prevValue + (currentValue - prevValue) * ratio;
  }

  return series[series.length - 1][key];
}

function buildLapComparison(bestLap, comparisonLap, bucketCount = 80) {
  if (!bestLap || !comparisonLap) {
    return null;
  }

  const bestSeries = buildProgressSeries(bestLap.samples);
  const comparisonSeries = buildProgressSeries(comparisonLap.samples);

  if (bestSeries.length < 2 || comparisonSeries.length < 2) {
    return null;
  }

  const points = Array.from({ length: bucketCount + 1 }, (_, index) => {
    const progress = index / bucketCount;
    const bestElapsed = interpolateSeriesValue(bestSeries, progress, "elapsed");
    const comparisonElapsed = interpolateSeriesValue(comparisonSeries, progress, "elapsed");
    const deltaMs =
      Number.isFinite(bestElapsed) && Number.isFinite(comparisonElapsed)
        ? Math.round((comparisonElapsed - bestElapsed) * 1000)
        : null;

    return {
      progress,
      distancePercent: Math.round(progress * 100),
      bestElapsed: Number.isFinite(bestElapsed) ? roundLapProjection(bestElapsed) : null,
      comparisonElapsed: Number.isFinite(comparisonElapsed) ? roundLapProjection(comparisonElapsed) : null,
      deltaMs,
      bestRpm: interpolateSeriesValue(bestSeries, progress, "rpm"),
      comparisonRpm: interpolateSeriesValue(comparisonSeries, progress, "rpm"),
      bestThrottle: interpolateSeriesValue(bestSeries, progress, "throttle"),
      comparisonThrottle: interpolateSeriesValue(comparisonSeries, progress, "throttle"),
    };
  }).filter((point) => point.deltaMs != null);

  if (!points.length) {
    return null;
  }

  const fastestGainPoint = points.slice().sort((a, b) => b.deltaMs - a.deltaMs)[0];
  const biggestLossPoint = points.slice().sort((a, b) => a.deltaMs - b.deltaMs)[0];

  return {
    bestLap: {
      sourceFile: bestLap.sourceFile,
      lapNumber: bestLap.lapNumber,
      lapTime: bestLap.lapTime,
    },
    comparisonLap: {
      sourceFile: comparisonLap.sourceFile,
      lapNumber: comparisonLap.lapNumber,
      lapTime: comparisonLap.lapTime,
    },
    points,
    summary: {
      peakGainMs: fastestGainPoint?.deltaMs ?? 0,
      peakGainPercent: fastestGainPoint?.distancePercent ?? 0,
      peakLossMs: biggestLossPoint?.deltaMs ?? 0,
      peakLossPercent: biggestLossPoint?.distancePercent ?? 0,
    },
  };
}

function findNearestProgressIndex(progressValues, targetRatio, minIndex, maxIndex) {
  let bestIndex = minIndex;
  let bestGap = Number.POSITIVE_INFINITY;

  for (let index = minIndex; index <= maxIndex; index += 1) {
    const gap = Math.abs(progressValues[index] - targetRatio);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function findNearestGateIndex(samples, gatePoint, minIndex, maxIndex) {
  let bestIndex = minIndex;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = minIndex; index <= maxIndex; index += 1) {
    const candidateDistance = distanceBetweenPoints(samples[index], gatePoint);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function computeSectorTimes(samples, trackMap) {
  if (!samples.length) {
    return [];
  }

  const normalizedSectorDefinitions = normalizeSectorDefinitions(trackMap);
  const firstTime = samples[0].time;
  const firstDistance = Number.isFinite(samples[0].distance) ? samples[0].distance : null;
  const lastDistance = Number.isFinite(samples[samples.length - 1].distance)
    ? samples[samples.length - 1].distance
    : null;
  const totalDistance =
    firstDistance != null && lastDistance != null ? lastDistance - firstDistance : null;
  const progressValues = samples.map((sample, index) =>
    getSampleProgress(sample, index, samples.length, firstDistance, totalDistance)
  );
  const lastIndex = samples.length - 1;
  const boundaryIndices = [0];
  const hasGateCoordinates = normalizedSectorDefinitions.every(
    (sector) => Number.isFinite(sector.x) && Number.isFinite(sector.y)
  );

  normalizedSectorDefinitions.slice(0, -1).forEach((sector, sectorIndex) => {
    const minIndex = Math.min(lastIndex, Math.max(boundaryIndices[sectorIndex] + 1, 1));
    const maxIndex = Math.max(minIndex, lastIndex - 1);
    const nextSector = normalizedSectorDefinitions[sectorIndex + 1];
    const boundaryIndex = hasGateCoordinates
      ? findNearestGateIndex(
          samples,
          { x: nextSector.x, y: nextSector.y },
          minIndex,
          maxIndex
        )
      : findNearestProgressIndex(progressValues, sector.endRatio, minIndex, maxIndex);
    boundaryIndices.push(boundaryIndex);
  });

  boundaryIndices.push(lastIndex);

  return normalizedSectorDefinitions.map((sector, index) => {
    const startIndex = boundaryIndices[index];
    const endIndex = boundaryIndices[index + 1];
    const start = Math.max(0, samples[startIndex].time - firstTime);
    const end = Math.max(0, samples[endIndex].time - firstTime);
    const sectorSamples = samples.slice(startIndex, endIndex + 1);
    const sectorRpms = sectorSamples.map((sample) => sample.rpm).filter((value) => Number.isFinite(value));
    const sectorThrottles = sectorSamples
      .map((sample) => sample.throttle)
      .filter((value) => Number.isFinite(value));

    return {
      id: sector.id,
      time: Math.max(0, end - start),
      startRatio: sector.startRatio,
      endRatio: sector.endRatio,
      avgRpm: average(sectorRpms),
      minRpm: sectorRpms.length ? Math.min(...sectorRpms) : null,
      maxRpm: peak(sectorRpms),
      exitRpm: trailingAverage(sectorRpms, 5),
      avgThrottle: average(sectorThrottles),
      exitThrottle: trailingAverage(sectorThrottles, 5),
    };
  });
}

function buildSectorAnalysis(laps, trackMap) {
  const normalizedSectorDefinitions = normalizeSectorDefinitions(trackMap);
  const lapsWithSectors = laps.map((lap) => ({
    ...lap,
    sectorTimes: computeSectorTimes(lap.samples, trackMap),
  }));

  const bestLap = lapsWithSectors[0];
  const optimalSectors = normalizedSectorDefinitions.map((sectorDefinition, index) => {
    const sectorId = sectorDefinition.id;
    const candidates = lapsWithSectors
      .map((lap) => ({
        sectorId,
        sourceFile: lap.sourceFile,
        lapNumber: lap.lapNumber,
        time: lap.sectorTimes[index]?.time ?? Number.POSITIVE_INFINITY,
        startRatio: lap.sectorTimes[index]?.startRatio ?? sectorDefinition.startRatio,
        endRatio: lap.sectorTimes[index]?.endRatio ?? sectorDefinition.endRatio,
        avgRpm: lap.sectorTimes[index]?.avgRpm ?? null,
        minRpm: lap.sectorTimes[index]?.minRpm ?? null,
        maxRpm: lap.sectorTimes[index]?.maxRpm ?? null,
        exitRpm: lap.sectorTimes[index]?.exitRpm ?? null,
        avgThrottle: lap.sectorTimes[index]?.avgThrottle ?? null,
        exitThrottle: lap.sectorTimes[index]?.exitThrottle ?? null,
      }))
      .filter((candidate) => Number.isFinite(candidate.time))
      .sort((a, b) => a.time - b.time);

    return candidates[0];
  });

  const projectedBestSectorLapTime = optimalSectors.reduce((sum, sector) => sum + (sector?.time || 0), 0);
  const sectorGains = optimalSectors.map((optimalSector, index) => {
    const bestLapSector = bestLap.sectorTimes[index];
    const gapMs = Math.round(
      Math.max(0, ((bestLapSector?.time || 0) - (optimalSector?.time || 0)) * 1000)
    );

    return {
      id: normalizedSectorDefinitions[index]?.id || `S${index + 1}`,
      bestLapTime: Math.round((bestLapSector?.time || 0) * 1000) / 1000,
      optimalTime: Math.round((optimalSector?.time || 0) * 1000) / 1000,
      gapMs,
      sourceFile: optimalSector?.sourceFile || bestLap.sourceFile,
      lapNumber: optimalSector?.lapNumber || bestLap.lapNumber,
      startRatio:
        optimalSector?.startRatio ??
        bestLapSector?.startRatio ??
        normalizedSectorDefinitions[index]?.startRatio ??
        0,
      endRatio:
        optimalSector?.endRatio ??
        bestLapSector?.endRatio ??
        normalizedSectorDefinitions[index]?.endRatio ??
        1,
      bestLapAvgRpm: bestLapSector?.avgRpm ?? null,
      bestLapMinRpm: bestLapSector?.minRpm ?? null,
      bestLapMaxRpm: bestLapSector?.maxRpm ?? null,
      bestLapExitRpm: bestLapSector?.exitRpm ?? null,
      sourceAvgRpm: optimalSector?.avgRpm ?? null,
      sourceMinRpm: optimalSector?.minRpm ?? null,
      sourceMaxRpm: optimalSector?.maxRpm ?? null,
      sourceExitRpm: optimalSector?.exitRpm ?? null,
      bestLapAvgThrottle: bestLapSector?.avgThrottle ?? null,
      bestLapExitThrottle: bestLapSector?.exitThrottle ?? null,
      sourceAvgThrottle: optimalSector?.avgThrottle ?? null,
      sourceExitThrottle: optimalSector?.exitThrottle ?? null,
    };
  });

  return {
    laps: lapsWithSectors,
    bestLap,
    projectedBestSectorLapTime,
    sectorGains,
  };
}

function buildExecutiveSummary(profile, bestLap, benchmarkLap, metrics) {
  const summary = [];

  if (profile.id === "trophy_kart_junior2_cvt") {
    summary.push("Stay committed longer on entry so the kart keeps load in the clutch and belt.");
    summary.push("Your fastest pace comes from less unnecessary lift and smoother throttle continuity.");
    summary.push("Protect minimum speed through the center instead of over-slowing the kart.");
    summary.push("Focus on a cleaner release at the apex so the kart rolls free without a big slide.");
    summary.push(`The biggest current gap to the next-best lap is about ${(metrics.timeGapMs / 1000).toFixed(2)}s.`);
    return summary;
  }

  if (profile.id === "trophy_kart_mod_5_speed") {
    summary.push("Keep the Mod Kart in the 9500-11000 RPM power band through the key drive zones.");
    summary.push("The biggest gains come from getting it slowed enough to rotate, then back to power cleanly.");
    summary.push("Avoid bogging the engine on the slowest parts of the lap by protecting exit RPM.");
    summary.push("Use the fastest lap as the model for where to release steering and drive off sooner.");
    summary.push(`The biggest current gap to the next-best lap is about ${(metrics.timeGapMs / 1000).toFixed(2)}s.`);
    return summary;
  }

  summary.push("The fastest lap shows cleaner momentum preservation than the rest of the session.");
  summary.push("Most of the time loss is coming from slowing the kart too much before exit.");
  summary.push("Focus on repeatable corner entry, cleaner apex timing, and earlier drive.");
  summary.push("Use the map and sectors to isolate the worst time losses first.");
  summary.push(`The biggest current gap to the next-best lap is about ${(metrics.timeGapMs / 1000).toFixed(2)}s.`);
  return summary;
}

function buildRankedImprovements(profile, bestLap, benchmarkLap, metrics) {
  const improvements = [];

  if (profile.id === "trophy_kart_junior2_cvt") {
    improvements.push({
      title: "Stay in the gas longer on entry",
      sector: metrics.primarySector,
      timeGainMs: clampMs(metrics.candidateEntryMs),
      detail: "Junior 2 wants load in the belt and clutch. Too much lift is costing momentum before apex.",
    });
    improvements.push({
      title: "Protect center speed",
      sector: metrics.secondarySector,
      timeGainMs: clampMs(metrics.candidateMidMs),
      detail: "The slower laps are giving away roll speed in the middle of the corner instead of keeping the kart free.",
    });
    improvements.push({
      title: "Clean up throttle trace on exit",
      sector: metrics.thirdSector,
      timeGainMs: clampMs(metrics.candidateExitMs),
      detail: "Aim for smoother throttle pickup so the kart stays loaded and keeps driving instead of surging.",
    });
    improvements.push({
      title: "Reduce unnecessary off-throttle time",
      sector: "S4",
      timeGainMs: clampMs(metrics.candidateThrottleMs),
      detail: "Your best lap carries the throttle with fewer interruptions. That is a repeatable gain.",
    });
  } else if (profile.id === "trophy_kart_mod_5_speed") {
    improvements.push({
      title: "Exit in the power band",
      sector: metrics.primarySector,
      timeGainMs: clampMs(metrics.candidateRpmMs),
      detail: "The Mod Kart makes power from 9500 to 11000 RPM. The slower laps are dropping below that too early or too long.",
    });
    improvements.push({
      title: "Rotate it, then drive earlier",
      sector: metrics.secondarySector,
      timeGainMs: clampMs(metrics.candidateExitMs),
      detail: "Get the kart pointed sooner so you can release steering and go back to power without waiting.",
    });
    improvements.push({
      title: "Stop bogging the slowest corner zones",
      sector: metrics.thirdSector,
      timeGainMs: clampMs(metrics.candidateMidMs),
      detail: "Corner style that drags the engine down is costing drive off and making the next straight weak.",
    });
    improvements.push({
      title: "Match the fastest lap throttle timing",
      sector: "S4",
      timeGainMs: clampMs(metrics.candidateThrottleMs),
      detail: "The best lap gets back to power more cleanly and does not waste time hesitating after rotation.",
    });
  } else {
    improvements.push({
      title: "Carry more center speed",
      sector: metrics.primarySector,
      timeGainMs: clampMs(metrics.candidateMidMs),
      detail: "The pace loss is mostly from over-slowing the kart before the center and exit.",
    });
    improvements.push({
      title: "Get to power sooner",
      sector: metrics.secondarySector,
      timeGainMs: clampMs(metrics.candidateExitMs),
      detail: "The best lap has a cleaner transition from rotation to drive.",
    });
  }

  return improvements
    .sort((a, b) => b.timeGainMs - a.timeGainMs)
    .slice(0, 3);
}

function buildConsistencyDrill(profile) {
  if (profile.id === "trophy_kart_junior2_cvt") {
    return "Run 5 laps at 95% and focus on one thing only: keep the throttle trace cleaner with less unnecessary lift on entry.";
  }

  if (profile.id === "trophy_kart_mod_5_speed") {
    return "Run 5 laps focusing on the slowest corner only and track whether exit RPM stays inside the 9500-11000 range sooner each lap.";
  }

  return "Run 5 laps at repeatable pace and focus on one corner where you can release steering sooner and drive off cleaner.";
}

function buildDataQualityWarnings(parsedSessions, bestLap) {
  const warnings = [];

  parsedSessions.forEach((session) => {
    if (session.startFinish.needsUserConfirmation) {
      warnings.push(`${session.fileName}: start/finish confidence is low.`);
    }

    if (!session.channelAvailability.speed) {
      warnings.push(`${session.fileName}: speed channel is missing or weak.`);
    }
  });

  if (bestLap && bestLap.loopClosureError != null && bestLap.loopClosureError > 20) {
    warnings.push("Track loop closure is weak on the representative lap, so map-based coaching should be reviewed carefully.");
  }

  return warnings;
}

function resolveVehicleProfile(parsedSessions, overrideProfileId) {
  if (overrideProfileId && VEHICLE_PROFILES[overrideProfileId]) {
    return {
      ...VEHICLE_PROFILES[overrideProfileId],
      selectedByUser: true,
    };
  }

  return detectVehicleProfile(parsedSessions);
}

function analyzeCoaching(parsedSessions, options = {}) {
  const profile = resolveVehicleProfile(parsedSessions, options.profileId);
  const laps = getHotLapCandidates(parsedSessions);

  if (!laps.length) {
    return {
      ready: false,
      profile,
      reason: "No hot laps were available for coaching.",
    };
  }

  const sectorAnalysis = buildSectorAnalysis(laps, options.trackMap);
  const bestLap = sectorAnalysis.bestLap;
  const benchmarkLap = sectorAnalysis.laps[Math.min(1, sectorAnalysis.laps.length - 1)] || bestLap;
  const lapComparison = benchmarkLap && benchmarkLap !== bestLap
    ? buildLapComparison(bestLap, benchmarkLap)
    : null;
  const sortedSectorGains = sectorAnalysis.sectorGains
    .slice()
    .sort((a, b) => b.gapMs - a.gapMs);
  const timeGapMs = benchmarkLap && benchmarkLap !== bestLap
    ? Math.max(0, (benchmarkLap.lapTime - bestLap.lapTime) * 1000)
    : 250;
  const totalOpportunityMs = Math.max(
    80,
    Math.round(
      Math.min(
        Math.max(bestLap.lapTime - sectorAnalysis.projectedBestSectorLapTime, 0) * 1000,
        Math.max(150, timeGapMs * 1.5)
      )
    )
  );

  const rpmBandMiss =
    profile.powerBandRpm && bestLap.avgRpm != null
      ? Math.max(0, profile.powerBandRpm.min - bestLap.avgRpm)
      : 0;
  const avgThrottleDelta =
    benchmarkLap && bestLap.avgThrottle != null && benchmarkLap.avgThrottle != null
      ? Math.max(0, bestLap.avgThrottle - benchmarkLap.avgThrottle)
      : 0;

  const metrics = {
    timeGapMs,
    projectedBestSectorLapTime: roundLapProjection(sectorAnalysis.projectedBestSectorLapTime),
    totalOpportunityMs,
    primarySector: sortedSectorGains[0]?.id || "S1",
    secondarySector: sortedSectorGains[1]?.id || "S2",
    thirdSector: sortedSectorGains[2]?.id || "S3",
    candidateEntryMs: Math.max(40, Math.round(sortedSectorGains[0]?.gapMs || timeGapMs * 0.34)),
    candidateMidMs: Math.max(35, Math.round(sortedSectorGains[1]?.gapMs || timeGapMs * 0.28)),
    candidateExitMs: Math.max(30, Math.round(sortedSectorGains[2]?.gapMs || timeGapMs * 0.26)),
    candidateThrottleMs: Math.max(25, Math.round(Math.min(sortedSectorGains[1]?.gapMs || 30, (avgThrottleDelta || 6) * 6))),
    candidateRpmMs: Math.max(30, Math.round(Math.min(sortedSectorGains[0]?.gapMs || 40, (rpmBandMiss || 80) * 0.12))),
  };

  const executiveSummary = buildExecutiveSummary(profile, bestLap, benchmarkLap, metrics);
  const improvements = buildRankedImprovements(profile, bestLap, benchmarkLap, metrics);
  const consistencyDrill = buildConsistencyDrill(profile);
  const dataQualityWarnings = buildDataQualityWarnings(parsedSessions, bestLap);

  return {
    ready: true,
    profile,
    availableProfiles: [
      {
        id: VEHICLE_PROFILES.trophy_kart_mod_5_speed.id,
        label: VEHICLE_PROFILES.trophy_kart_mod_5_speed.label,
      },
      {
        id: VEHICLE_PROFILES.trophy_kart_junior2_cvt.id,
        label: VEHICLE_PROFILES.trophy_kart_junior2_cvt.label,
      },
    ],
    bestLap: {
      sourceFile: bestLap.sourceFile,
      lapNumber: bestLap.lapNumber,
      lapTime: bestLap.lapTime,
      avgRpm: bestLap.avgRpm,
      avgThrottle: bestLap.avgThrottle,
    },
    projectedBestSectorLap: {
      lapTime: roundLapProjection(sectorAnalysis.projectedBestSectorLapTime),
      sectorGains: sectorAnalysis.sectorGains,
      confidence: "medium",
      note: "Built from RaceBud distance-based sectors on the map. Useful for direction, not a guaranteed achievable lap.",
    },
    lapComparison,
    executiveSummary,
    improvements,
    consistencyDrill,
    dataQualityWarnings,
  };
}

module.exports = {
  analyzeCoaching,
  detectVehicleProfile,
  VEHICLE_PROFILES,
};
