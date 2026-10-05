import * as Location from 'expo-location';

// ─── Configurable Constants ──────────────────────────────────────────────────
const ACCURACY_THRESHOLD_M = 3;      // Keep fixes at ±3 m or better
const RELAXED_ACCURACY_M = 5;        // Last-resort band, still tighter than before
const COLLECTION_WINDOW_MS = 5000;   // Never block the user longer than 5 s
const MIN_SATELLITES = 4;
const MIN_VALID_READINGS = 3;        // A tight cluster of 3 is enough
const EARLY_COMPLETE_READINGS = 5;   // Finish as soon as 5 good fixes land
const EXCELLENT_ACCURACY_M = 2;      // Sub-2 m fixes can end the wait immediately
const EXCELLENT_EARLY_READINGS = 3;
const SATELLITE_POLL_INTERVAL_MS = 400;
const SATELLITE_TIMEOUT_MS = 2500;   // Do not hold GPS behind an 8 s satellite wait
const OUTLIER_SIGMA = 2.0;           // Tighter jump rejection for a cleaner lock
const SAMPLE_INTERVAL_MS = 200;      // Ask the chip for a fix 5 times a second

let GnssStatusChecker = null;
try {
  GnssStatusChecker = require('react-native-gnss-status-checker').default;
} catch {
  // Library not available — satellite check will be skipped gracefully
}

// ─── Statistical helpers ──────────────────────────────────────────────────────
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(arr) {
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
  const squareDiffs = arr.map((v) => (v - avg) ** 2);
  return Math.sqrt(squareDiffs.reduce((s, v) => s + v, 0) / arr.length);
}

/**
 * Filter out statistical outliers. Keeps readings whose lat/lng are within
 * OUTLIER_SIGMA standard deviations of the median for each axis.
 */
function rejectOutliers(readings) {
  if (readings.length < 4) return readings;

  const lats = readings.map((r) => r.latitude);
  const lngs = readings.map((r) => r.longitude);
  const medLat = median(lats);
  const medLng = median(lngs);
  const sdLat = standardDeviation(lats) || 0.0001;
  const sdLng = standardDeviation(lngs) || 0.0001;

  return readings.filter((r) => {
    const dLat = Math.abs(r.latitude - medLat);
    const dLng = Math.abs(r.longitude - medLng);
    return dLat <= OUTLIER_SIGMA * sdLat && dLng <= OUTLIER_SIGMA * sdLng;
  });
}

/**
 * Accuracy-weighted average: readings with better (lower) accuracy values
 * get proportionally more weight in the final average.
 */
function weightedAverage(readings) {
  // GPS error is a standard deviation, so weight by inverse variance.
  const weights = readings.map((r) => 1 / (r.accuracy * r.accuracy));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  let wLat = 0;
  let wLng = 0;
  let wAcc = 0;

  for (let i = 0; i < readings.length; i++) {
    wLat += readings[i].latitude * weights[i];
    wLng += readings[i].longitude * weights[i];
    wAcc += readings[i].accuracy * weights[i];
  }

  return {
    latitude: wLat / totalWeight,
    longitude: wLng / totalWeight,
    accuracy: wAcc / totalWeight,
  };
}

// ─── Satellite lock ──────────────────────────────────────────────────────────

async function waitForSatellites(onProgress) {
  if (!GnssStatusChecker) {
    onProgress?.('Satellite checker not available — using GPS only');
    return { ok: true, skipped: true };
  }

  try {
    await GnssStatusChecker.startListening();
  } catch {
    onProgress?.('Could not start GNSS listener — using GPS only');
    return { ok: true, skipped: true };
  }

  const start = Date.now();

  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const status = await GnssStatusChecker.getGNSSStatus();
        const used = status.satellitesUsedInFix ?? 0;
        const visible = status.satellitesVisible ?? 0;

        onProgress?.(`Satellites: ${used}/${MIN_SATELLITES} locked (${visible} visible)`);

        if (used >= MIN_SATELLITES) {
          try { await GnssStatusChecker.stopListening(); } catch {}
          resolve({ ok: true, skipped: false, satellitesUsed: used });
          return;
        }
      } catch {
        // Ignore poll errors — keep trying until timeout
      }

      if (Date.now() - start >= SATELLITE_TIMEOUT_MS) {
        try { await GnssStatusChecker.stopListening(); } catch {}
        onProgress?.('Satellite timeout — proceeding with GPS');
        resolve({ ok: false, skipped: false, satellitesUsed: 0 });
        return;
      }

      setTimeout(poll, SATELLITE_POLL_INTERVAL_MS);
    };

    poll();
  });
}

// ─── Core GNSS capture pipeline ──────────────────────────────────────────────

export async function recordTreeLocation(onProgress) {
  // ── Step 1: Permission ────────────────────────────────────────────────────
  onProgress?.('Requesting location permission…');
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied. Please enable it in device Settings.');
  }

  // Turn the radio on immediately. Satellite count must not delay the first fix.
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    // iOS and already-enabled Android providers throw here. GPS still runs.
  }

  const satPromise = waitForSatellites(onProgress);

  // ── Step 2: High-rate navigation stream, no warm-up wait ─────────────────
  onProgress?.(`Locking GPS — target ±${ACCURACY_THRESHOLD_M}m`);

  const allReadings = [];
  let runningCenter = null;

  const mainSub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 0,
      timeInterval: SAMPLE_INTERVAL_MS,
    },
    (location) => {
      const acc = location.coords.accuracy;
      if (acc == null || acc > 15) return;

      if (runningCenter) {
        const dlat = location.coords.latitude - runningCenter.lat;
        const dlng = location.coords.longitude - runningCenter.lng;
        const driftMeters = Math.sqrt(
          (dlat * 111000) ** 2 +
          (dlng * 111000 * Math.cos(runningCenter.lat * Math.PI / 180)) ** 2
        );
        // A jump bigger than 25 m is multipath, not the user walking.
        if (driftMeters > 25) return;
      } else if (acc <= ACCURACY_THRESHOLD_M) {
        runningCenter = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        };
      }

      allReadings.push({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: acc,
      });
    }
  );

  const windowStart = Date.now();
  const windowSeconds = COLLECTION_WINDOW_MS / 1000;
  while (Date.now() - windowStart < COLLECTION_WINDOW_MS) {
    await new Promise((r) => setTimeout(r, 200));
    const elapsed = ((Date.now() - windowStart) / 1000).toFixed(1);
    const good = allReadings.filter((r) => r.accuracy <= ACCURACY_THRESHOLD_M).length;
    const excellent = allReadings.filter((r) => r.accuracy <= EXCELLENT_ACCURACY_M).length;
    onProgress?.(`±${ACCURACY_THRESHOLD_M}m: ${good}  ·  ±${EXCELLENT_ACCURACY_M}m: ${excellent}  ·  ${elapsed}s / ${windowSeconds}s`);
    if (excellent >= EXCELLENT_EARLY_READINGS || good >= EARLY_COMPLETE_READINGS) {
      onProgress?.(`Lock ready (${Math.max(excellent, good)} samples) — finishing`);
      break;
    }
  }

  mainSub.remove();
  // One microtask: if the satellite check already finished, keep its count.
  // If it is still running, do not wait for it.
  let satResult = { ok: true, skipped: true, satellitesUsed: 0 };
  let satReady = null;
  satPromise.then((result) => {
    satReady = result;
  }).catch(() => {});
  await Promise.resolve();
  if (satReady) satResult = satReady;

  // ── Step 5: Process readings ──────────────────────────────────────────────
  // Prefer the tight band. If the chip has not converged yet, use the best
  // readings we actually captured instead of failing the lock.
  let valid = allReadings.filter((r) => r.accuracy <= ACCURACY_THRESHOLD_M);

  if (valid.length < MIN_VALID_READINGS) {
    const relaxed = allReadings.filter((r) => r.accuracy <= RELAXED_ACCURACY_M);
    if (relaxed.length >= MIN_VALID_READINGS) {
      onProgress?.(`Using ±${RELAXED_ACCURACY_M}m band (${relaxed.length} readings)`);
      valid = relaxed;
    } else if (allReadings.length > 0) {
      const best = [...allReadings]
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, Math.max(MIN_VALID_READINGS, 3));
      onProgress?.(`Using best ${best.length} fixes (±${best[best.length - 1].accuracy.toFixed(1)}m)`);
      valid = best;
    }
  }

  if (valid.length === 0) {
    throw new Error(
      `No valid GPS readings collected.\n` +
        `Make sure you are outdoors with clear sky view.\n` +
        `GPS accuracy under tree canopy can be limited.`
    );
  }

  onProgress?.(`Filtering ${valid.length} readings…`);

  // 5b. Reject statistical outliers (jumps, multipath errors)
  valid = rejectOutliers(valid);

  if (valid.length < 3) {
    // Not enough after outlier removal — use what we have
    onProgress?.(`Few readings after outlier removal (${valid.length}) — using all`);
  }

  // 5c. Accuracy-weighted average (better readings count more)
  const avg = weightedAverage(valid);

  // 5d. Compute final accuracy estimate from spread of readings
  const latSpread = standardDeviation(valid.map((r) => r.latitude)) * 111000;
  const lngSpread = standardDeviation(valid.map((r) => r.longitude)) * 111000;
  const spreadMeters = Math.sqrt(latSpread ** 2 + lngSpread ** 2);
  // Final accuracy = max of (weighted average accuracy, spread-based estimate)
  const finalAccuracy = Math.max(avg.accuracy, spreadMeters);

  onProgress?.(
    `Done: ${valid.length} samples, ±${finalAccuracy.toFixed(1)}m`
  );

  // ── Step 6: Return result ─────────────────────────────────────────────────
  return {
    latitude: avg.latitude,
    longitude: avg.longitude,
    accuracy: finalAccuracy,
    sampleCount: valid.length,
    timestamp: new Date().toISOString(),
    satellitesUsed: satResult.satellitesUsed ?? 0,
  };
}

export { ACCURACY_THRESHOLD_M, COLLECTION_WINDOW_MS, MIN_SATELLITES, MIN_VALID_READINGS, EARLY_COMPLETE_READINGS };
