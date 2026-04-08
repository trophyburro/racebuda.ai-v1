function cleanText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/Ã‚/g, "")
    .trim();
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(cleanText(current));
      current = "";
      continue;
    }

    current += char;
  }

  values.push(cleanText(current));
  return values;
}

function normalizeHeader(header) {
  return cleanText(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumber(value) {
  if (value === "" || value == null) {
    return null;
  }

  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationToSeconds(value) {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  if (!text.includes(":")) {
    return toNumber(text);
  }

  const parts = text.split(":").map((part) => Number.parseFloat(part));

  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function normalizeUnit(unit) {
  const normalized = normalizeHeader(unit);

  if (normalized === "mph") return "mph";
  if (normalized === "km h" || normalized === "kmh" || normalized === "kph") return "kmh";
  if (normalized === "ft") return "ft";
  if (normalized === "m") return "m";
  if (normalized === "deg") return "deg";
  if (normalized === "rpm") return "rpm";
  if (normalized === "g") return "g";
  if (normalized === "s") return "s";
  if (normalized === "%") return "%";
  if (normalized === "v") return "v";

  return cleanText(unit);
}

function getCanonicalKey(header) {
  const normalized = normalizeHeader(header);

  if (normalized === "time") return "time";
  if (normalized === "gps speed" || normalized === "speed") return "speed";
  if (normalized === "gps latitude" || normalized === "latitude" || normalized === "gps lat") return "latitude";
  if (normalized === "gps longitude" || normalized === "longitude" || normalized === "gps lon") return "longitude";
  if (normalized === "distance on gps speed" || normalized === "distance") return "distance";
  if (normalized === "rpm") return "rpm";
  if (normalized === "throttle" || normalized === "tps") return "throttle";
  if (normalized === "inlineacc" || normalized === "gps inlineacc" || normalized === "gpspo inlineacc") return "inlineAcc";
  if (normalized === "lateralacc" || normalized === "gps lateralacc" || normalized === "gpspo lateralacc") return "lateralAcc";
  if (normalized === "verticalacc" || normalized === "gpspo verticalacc") return "verticalAcc";
  if (normalized === "gps heading") return "heading";
  if (normalized === "gps gyro" || normalized === "gps yaw rate" || normalized === "gpspo yawrate") return "yawRate";
  if (normalized === "predictive time") return "predictiveTime";
  if (normalized === "best today diff") return "bestTodayDiff";

  return null;
}

function latLonToMeters(latitude, longitude, originLatitude, originLongitude) {
  const earthRadius = 6378137;
  const latRad = (latitude * Math.PI) / 180;
  const originLatRad = (originLatitude * Math.PI) / 180;
  const deltaLat = ((latitude - originLatitude) * Math.PI) / 180;
  const deltaLon = ((longitude - originLongitude) * Math.PI) / 180;

  const x = deltaLon * earthRadius * Math.cos((latRad + originLatRad) / 2);
  const y = deltaLat * earthRadius;

  return { x, y };
}

function distanceBetween(pointA, pointB) {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getValue(sample, key) {
  const value = sample[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeChannelAvailability(samples) {
  const keys = [
    "speed",
    "latitude",
    "longitude",
    "distance",
    "rpm",
    "throttle",
    "inlineAcc",
    "lateralAcc",
  ];

  return keys.reduce((acc, key) => {
    acc[key] = samples.some((sample) => getValue(sample, key) != null);
    return acc;
  }, {});
}

function convertDistancePerSecondToDisplaySpeed(distancePerSecond, distanceUnit) {
  if (!Number.isFinite(distancePerSecond)) {
    return null;
  }

  const normalizedUnit = normalizeUnit(distanceUnit);

  if (normalizedUnit === "ft") {
    return distancePerSecond * 0.6818181818;
  }

  if (normalizedUnit === "m") {
    return distancePerSecond * 3.6;
  }

  return null;
}

function computeLapAverageSpeed(lapSamples, lapTime, distanceUnit) {
  const speeds = lapSamples.map((sample) => getValue(sample, "speed")).filter((value) => value != null);
  const sampleAverageSpeed = speeds.length
    ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length
    : null;

  if (Number.isFinite(lapTime) && lapTime > 0) {
    const firstDistance = getValue(lapSamples[0], "distance");
    const lastDistance = getValue(lapSamples[lapSamples.length - 1], "distance");

    if (firstDistance != null && lastDistance != null && lastDistance > firstDistance) {
      const lapDistance = lastDistance - firstDistance;
      const convertedSpeed = convertDistancePerSecondToDisplaySpeed(lapDistance / lapTime, distanceUnit);

      if (
        convertedSpeed != null &&
        (
          sampleAverageSpeed == null ||
          Math.abs(convertedSpeed - sampleAverageSpeed) <= Math.max(12, sampleAverageSpeed * 0.25)
        )
      ) {
        return convertedSpeed;
      }
    }
  }

  return sampleAverageSpeed;
}

function buildLapsFromBeaconMarkers(samples, beaconMarkers, totalDuration, distanceUnit) {
  const markers = beaconMarkers.filter((value) => Number.isFinite(value) && value > 0);
  const segmentEnds = [...markers];

  if (Number.isFinite(totalDuration) && (!segmentEnds.length || segmentEnds[segmentEnds.length - 1] < totalDuration)) {
    segmentEnds.push(totalDuration);
  }

  if (!segmentEnds.length) {
    return [];
  }

  const laps = [];
  let startTime = 0;

  segmentEnds.forEach((endTime, index) => {
    const startIndex = samples.findIndex((sample) => sample.time >= startTime - 1e-6);
    let endIndex = -1;

    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (samples[i].time <= endTime + 1e-6) {
        endIndex = i;
        break;
      }
    }

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      startTime = endTime;
      return;
    }

    const lapSamples = samples.slice(startIndex, endIndex + 1);
    const lapTime = endTime - startTime;
    const avgSpeed = computeLapAverageSpeed(lapSamples, lapTime, distanceUnit);

    const firstPoint = lapSamples.find((sample) => sample.x != null && sample.y != null);
    const lastPoint = [...lapSamples].reverse().find((sample) => sample.x != null && sample.y != null);
    const loopClosureError =
      firstPoint && lastPoint ? distanceBetween(firstPoint, lastPoint) : null;

    laps.push({
      lapNumber: index + 1,
      startTime,
      endTime,
      lapTime,
      startIndex,
      endIndex,
      avgSpeed,
      sampleCount: lapSamples.length,
      loopClosureError,
      flags: [],
      hotCandidate: true,
    });

    startTime = endTime;
  });

  return laps;
}

function buildBeaconMarkersFromSegmentTimes(segmentTimes) {
  const markers = [];
  let cumulative = 0;

  segmentTimes.forEach((segmentTime) => {
    if (!Number.isFinite(segmentTime) || segmentTime <= 0) {
      return;
    }

    cumulative += segmentTime;
    markers.push(Number(cumulative.toFixed(3)));
  });

  return markers;
}

function markLapFlags(laps) {
  if (!laps.length) {
    return laps;
  }

  const fullLapCandidates = laps.filter((lap) => lap.lapTime > 20);
  const lapTimes = fullLapCandidates
    .map((lap) => lap.lapTime)
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  const medianLapTime = lapTimes.length
    ? lapTimes[Math.floor(lapTimes.length / 2)]
    : null;
  const speedValues = fullLapCandidates
    .map((lap) => lap.avgSpeed)
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  const medianSpeed = speedValues.length
    ? speedValues[Math.floor(speedValues.length / 2)]
    : null;

  laps.forEach((lap, index) => {
    if (lap.lapTime < 20) {
      lap.flags.push("partial");
      lap.hotCandidate = false;
    }

    if (index === 0 && lap.lapTime > 0) {
      lap.flags.push("possible_out_lap");

      if (medianLapTime && lap.lapTime > medianLapTime * 1.12) {
        lap.hotCandidate = false;
      }
    }

    if (index === laps.length - 1 && lap.lapTime < 0.75 * Math.max(...laps.map((entry) => entry.lapTime))) {
      lap.flags.push("possible_in_lap");
      lap.hotCandidate = false;
    }

    if (medianSpeed && lap.avgSpeed != null && lap.avgSpeed < medianSpeed * 0.7) {
      lap.flags.push("pit_or_slow");
      lap.hotCandidate = false;
    }

    if (lap.loopClosureError != null && lap.loopClosureError > 80) {
      lap.flags.push("bad_loop_closure");
      lap.hotCandidate = false;
    }
  });

  const validHotLaps = laps.filter((lap) => lap.hotCandidate);
  const fallbackPool = validHotLaps.length ? validHotLaps : laps.filter((lap) => !lap.flags.includes("partial"));
  const fastestHotLap = fallbackPool
    .slice()
    .sort((a, b) => a.lapTime - b.lapTime)[0];

  laps.forEach((lap) => {
    lap.isFastest = Boolean(fastestHotLap && lap.lapNumber === fastestHotLap.lapNumber);
  });

  return laps;
}

function estimateStartFinish(laps) {
  const usableLaps = laps.filter((lap) => lap.hotCandidate);
  const primaryLap = usableLaps[0] || laps[0] || null;

  if (!primaryLap) {
    return {
      confidence: 0,
      source: "unknown",
      needsUserConfirmation: true,
    };
  }

  const lowClosure = primaryLap.loopClosureError != null && primaryLap.loopClosureError < 20;
  return {
    source: "beacon_markers",
    lapNumber: primaryLap.lapNumber,
    confidence: lowClosure ? 0.95 : 0.7,
    needsUserConfirmation: !lowClosure,
  };
}

function parseAimCsv(csvText, options = {}) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, array) => !(line === "" && array[index - 1] === ""));

  if (!lines.length) {
    throw new Error("CSV file is empty.");
  }

  const metadata = {};
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const first = normalizeHeader(values[0]);

    if (
      first === "time" &&
      values.length > 3 &&
      values.some((value) => /gps/i.test(cleanText(value)))
    ) {
      headerIndex = i;
      break;
    }

    if (values.length >= 2) {
      metadata[cleanText(values[0])] = cleanText(values[1]);
    }
  }

  if (headerIndex === -1 || headerIndex + 2 >= lines.length) {
    throw new Error("Could not find AiM channel header and units rows.");
  }

  const rawHeaders = parseCsvLine(lines[headerIndex]);
  const rawUnits = parseCsvLine(lines[headerIndex + 1]);
  const channelMap = rawHeaders.map((header, index) => ({
    rawHeader: cleanText(header),
    normalizedHeader: normalizeHeader(header),
    canonicalKey: getCanonicalKey(header),
    unit: normalizeUnit(rawUnits[index]),
    index,
  }));
  const latitudeChannel = channelMap.find((channel) => channel.canonicalKey === "latitude");
  const longitudeChannel = channelMap.find((channel) => channel.canonicalKey === "longitude");

  const dataRows = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    if (!lines[i].trim()) {
      continue;
    }

    const row = parseCsvLine(lines[i]);
    if (row.every((value) => value === "")) {
      continue;
    }
    dataRows.push(row);
  }

  if (!dataRows.length) {
    throw new Error("No telemetry rows found after the header.");
  }

  const samples = dataRows
    .map((row) => {
      const sample = {};

      channelMap.forEach((channel) => {
        if (!channel.canonicalKey) {
          return;
        }
        sample[channel.canonicalKey] = toNumber(row[channel.index]);
      });

      if (sample.time == null) {
        return null;
      }

      return sample;
    })
    .filter(Boolean);

  if ((!latitudeChannel || !longitudeChannel) && samples.length) {
    const fallbackLatitudeIndex = rawHeaders.findIndex((header) =>
      /gps\s*latitude|^latitude$/i.test(cleanText(header))
    );
    const fallbackLongitudeIndex = rawHeaders.findIndex((header) =>
      /gps\s*longitude|^longitude$/i.test(cleanText(header))
    );

    if (fallbackLatitudeIndex !== -1 || fallbackLongitudeIndex !== -1) {
      samples.forEach((sample, rowIndex) => {
        if (fallbackLatitudeIndex !== -1 && sample.latitude == null) {
          sample.latitude = toNumber(dataRows[rowIndex][fallbackLatitudeIndex]);
        }

        if (fallbackLongitudeIndex !== -1 && sample.longitude == null) {
          sample.longitude = toNumber(dataRows[rowIndex][fallbackLongitudeIndex]);
        }
      });
    }
  }

  if (!samples.length) {
    throw new Error("No valid telemetry samples were parsed.");
  }

  const hasGps = samples.some((sample) => sample.latitude != null && sample.longitude != null);
  if (!hasGps) {
    const visibleHeaders = rawHeaders.slice(0, 20).join(", ");
    throw new Error(`GPS latitude/longitude channels are required for V1. Headers seen: ${visibleHeaders}`);
  }

  const speedChannel = channelMap.find((channel) => channel.canonicalKey === "speed");
  const speedUnit = speedChannel ? speedChannel.unit : "";
  const distanceChannel = channelMap.find((channel) => channel.canonicalKey === "distance");
  const distanceUnit = distanceChannel ? distanceChannel.unit : "";
  const unitSystem = speedUnit === "mph" ? "imperial" : "metric";

  const origin = samples.find((sample) => sample.latitude != null && sample.longitude != null);
  samples.forEach((sample) => {
    if (sample.latitude != null && sample.longitude != null) {
      const point = latLonToMeters(
        sample.latitude,
        sample.longitude,
        origin.latitude,
        origin.longitude
      );
      sample.x = point.x;
      sample.y = point.y;
    } else {
      sample.x = null;
      sample.y = null;
    }
  });

  const beaconLine = metadata["Beacon Markers"];
  const parsedBeaconMarkersFromCsv = beaconLine
    ? parseCsvLine(lines.find((line) => line.startsWith('"Beacon Markers"')) || "")
        .slice(1)
        .map((entry) => toNumber(entry))
        .filter((value) => value != null)
    : [];

  const segmentLine = lines.find((line) => line.startsWith('"Segment Times"'));
  const segmentTimes = segmentLine
    ? parseCsvLine(segmentLine)
        .slice(1)
        .map((entry) => parseDurationToSeconds(entry))
        .filter((value) => value != null)
    : [];
  const parsedBeaconMarkers = parsedBeaconMarkersFromCsv.length
    ? parsedBeaconMarkersFromCsv
    : buildBeaconMarkersFromSegmentTimes(segmentTimes);

  const totalDuration = parseDurationToSeconds(metadata.Duration);
  const laps = markLapFlags(
    buildLapsFromBeaconMarkers(samples, parsedBeaconMarkers, totalDuration, distanceUnit)
  );
  const fastestLap = laps.find((lap) => lap.isFastest) || null;
  const startFinish = estimateStartFinish(laps);

  return {
    source: "aim_csv",
    fileName: options.fileName || "unknown.csv",
    uploadPath: options.uploadPath || null,
    metadata: {
      format: metadata.Format || "AiM CSV File",
      session: metadata.Session || null,
      vehicle: metadata.Vehicle || null,
      racer: metadata.Racer || null,
      championship: metadata.Championship || null,
      comment: metadata.Comment || null,
      date: metadata.Date || null,
      timeOfDay: metadata.Time || null,
      sampleRateHz: toNumber(metadata["Sample Rate"]),
      durationSeconds: totalDuration,
      speedUnit,
      distanceUnit,
      unitSystem,
    },
    channelMap: channelMap.map((channel) => ({
      rawHeader: channel.rawHeader,
      canonicalKey: channel.canonicalKey,
      unit: channel.unit,
    })),
    beaconMarkers: parsedBeaconMarkers,
    segmentTimes,
    startFinish,
    laps,
    fastestLapNumber: fastestLap ? fastestLap.lapNumber : null,
    sampleCount: samples.length,
    channelAvailability: summarizeChannelAvailability(samples),
    representativeLap: fastestLap
      ? {
          lapNumber: fastestLap.lapNumber,
          startIndex: fastestLap.startIndex,
          endIndex: fastestLap.endIndex,
          lapTime: fastestLap.lapTime,
        }
      : null,
    samples,
  };
}

function combineParsedSessions(parsedSessions, options = {}) {
  const allLaps = [];
  const parseWarnings = [];
  const sessions = parsedSessions.map((session, index) => {
    session.laps.forEach((lap) => {
      allLaps.push({
        sourceFile: session.fileName,
        sessionIndex: index,
        ...lap,
      });
    });

    if (!session.channelAvailability.speed) {
      parseWarnings.push(`${session.fileName}: speed channel missing or unreadable.`);
    }

    if (session.startFinish.needsUserConfirmation) {
      parseWarnings.push(`${session.fileName}: start/finish confidence is low and should be confirmed in the UI.`);
    }

    return {
      fileName: session.fileName,
      metadata: session.metadata,
      sampleCount: session.sampleCount,
      laps: session.laps,
      fastestLapNumber: session.fastestLapNumber,
      startFinish: session.startFinish,
      channelAvailability: session.channelAvailability,
      representativeLap: session.representativeLap,
    };
  });

  const fastestLap = allLaps
    .filter((lap) => lap.hotCandidate)
    .sort((a, b) => a.lapTime - b.lapTime)[0] || null;

  const hotLapCount = allLaps.filter((lap) => lap.hotCandidate).length;
  const turnMapStatus = {
    readyForGeneration: hotLapCount > 0,
    nextStep: hotLapCount > 0 ? "build_track_map" : "review_lap_filtering",
  };

  return {
    sessionName: options.requestedSessionName || "Session 1",
    parser: "aim_csv",
    files: sessions,
    summary: {
      uploadedSessions: parsedSessions.length,
      totalLaps: allLaps.length,
      hotLaps: hotLapCount,
      fastestLap: fastestLap
        ? {
            sourceFile: fastestLap.sourceFile,
            lapNumber: fastestLap.lapNumber,
            lapTime: fastestLap.lapTime,
          }
        : null,
    },
    parseWarnings,
    turnMapStatus,
  };
}

module.exports = {
  parseAimCsv,
  combineParsedSessions,
};
