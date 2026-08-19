/**
 * bp-feature-extraction.ts
 *
 * Replicates the Python training pipeline to produce the exact 80-feature
 * SBP vector and 136-feature MAP vector expected by sbp_model.onnx and
 * map_model.onnx respectively.
 *
 * Feature order matches epoch_features.csv column order exactly.
 * SBP model: 80 non-`light_` features
 * MAP model: 80 SBP features + 56 `light_` features = 136 total
 *
 * Signal convention:
 * - camera-utils.ts returns avg RED channel (0-255). Higher red = more blood = systole.
 * - Training used IR: higher IR = LESS blood. Training did inv_sig = -1 * raw so peaks point UP.
 * - We also invert the camera red here so that both use the same convention.
 *   After bandpass (mean-subtracted), systolic peaks point UP in both cases.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const APP_FS = 25;
export const PROC_FS = 100;
export const SEGMENT_SECONDS = 12;
export const SEGMENT_SAMPLES_APP = SEGMENT_SECONDS * APP_FS; // 300

export const SBP_FEATURE_NAMES: readonly string[] = [
  'ppg_mean', 'ppg_std', 'ppg_skew', 'ppg_kurtosis',
  'peak_to_peak_interval', 'hr_est',
  'pulse_width', 'crest_time', 'rise_time', 'fall_time',
  'systolic_amplitude', 'diastolic_amplitude',
  'systolic_area', 'diastolic_area', 'total_pulse_area',
  'augmentation_index', 'reflection_index',
  'pulse_amplitude_ratio', 'dicrotic_notch_height', 'notch_to_diastolic_ratio',
  'a_amp', 'b_amp', 'c_amp', 'd_amp', 'e_amp',
  'b_a', 'c_a', 'd_a', 'e_a',
  'aging_index', 'stiffness_index',
  'vpg_max', 'vpg_min', 'vpg_mean', 'vpg_std',
  'apg_max', 'apg_min', 'apg_mean', 'apg_std',
  'vpg_slope_mean', 'apg_slope_mean',
  'vpg_time_to_peak', 'apg_time_to_peak', 'apg_zero_crossings',
  'band_power_0', 'band_power_1', 'band_power_2', 'band_power_3',
  'band_power_4', 'band_power_5', 'band_power_6', 'band_power_7',
  'fundamental_freq', 'total_power', 'spectral_entropy', 'spectral_centroid',
  'pulse_pressure_proxy', 'stiffness_aging_product', 'reflection_timing_index',
  'vascular_load_index', 'hrv_spectral_balance', 'metabolic_stiffness_coupling',
  'quantum_purity', 'quantum_von_neumann_entropy', 'quantum_phase_coherence',
  'quantum_state_fidelity', 'quantum_bloch_z_expval', 'quantum_bloch_x_expval',
  'dpg_max', 'dpg_min', 'dpg_std', 'dpg_mean',
  'jpg_max', 'jpg_min', 'jpg_std', 'jpg_mean',
  'demo_age', 'demo_sex', 'demo_weight', 'demo_height',
] as const;

const LIGHT_BASE_NAMES: readonly string[] = [
  'ppg_mean', 'ppg_std', 'ppg_skew', 'ppg_kurtosis',
  'peak_to_peak_interval', 'hr_est',
  'rise_time', 'pulse_width', 'crest_time', 'systolic_amplitude',
  'fall_time', 'systolic_area', 'diastolic_area', 'total_pulse_area',
  'dicrotic_notch_height', 'diastolic_amplitude',
  'augmentation_index', 'notch_to_diastolic_ratio',
  'reflection_index', 'pulse_amplitude_ratio',
  'a_amp', 'b_amp', 'c_amp', 'd_amp', 'e_amp',
  'b_a', 'c_a', 'd_a', 'e_a',
  'aging_index', 'stiffness_index',
  'vpg_max', 'vpg_min', 'vpg_mean', 'vpg_std',
  'apg_max', 'apg_min', 'apg_mean', 'apg_std',
  'vpg_slope_mean', 'apg_slope_mean',
  'vpg_time_to_peak', 'apg_time_to_peak', 'apg_zero_crossings',
  'band_power_0', 'band_power_1', 'band_power_2', 'band_power_3',
  'band_power_4', 'band_power_5', 'band_power_6', 'band_power_7',
  'fundamental_freq', 'total_power', 'spectral_entropy', 'spectral_centroid',
] as const;

export const MAP_FEATURE_NAMES: readonly string[] = [
  ...SBP_FEATURE_NAMES,
  ...LIGHT_BASE_NAMES.map(n => `light_${n}`),
] as const;

// ─── Demographics ─────────────────────────────────────────────────────────────

export interface BpDemographics {
  age: number;
  sex: number; // 1 = male, 0 = female
  weight: number; // kg
  height: number; // cm
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

const _mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const _std = (a: number[]) => {
  if (a.length <= 1) return 0;
  const m = _mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const _nanMean = (a: number[]) => { const f = a.filter(Number.isFinite); return f.length ? _mean(f) : NaN; };
const _nanMax  = (a: number[]) => { const f = a.filter(Number.isFinite); return f.length ? Math.max(...f) : NaN; };
const _nanMin  = (a: number[]) => { const f = a.filter(Number.isFinite); return f.length ? Math.min(...f) : NaN; };
const _nanStd  = (a: number[]) => { const f = a.filter(Number.isFinite); return f.length > 1 ? _std(f) : NaN; };

function _median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const _skew = (a: number[]) => {
  if (a.length < 3) return 0;
  const m = _mean(a); const s = _std(a);
  if (s === 0) return 0;
  return _mean(a.map(v => ((v - m) / s) ** 3));
};
const _kurtosis = (a: number[]) => {
  if (a.length < 4) return 0;
  const m = _mean(a); const s = _std(a);
  if (s === 0) return 0;
  return _mean(a.map(v => ((v - m) / s) ** 4));
};

function trapz(y: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length - 1; i++) s += (y[i] + y[i + 1]) * 0.5;
  return s;
}

function gradient(data: number[], fs: number = 1): number[] {
  const n = data.length;
  if (n < 2) return new Array(n).fill(0);
  const out = new Array(n).fill(0);
  out[0] = (data[1] - data[0]) * fs;
  out[n - 1] = (data[n - 1] - data[n - 2]) * fs;
  for (let i = 1; i < n - 1; i++) out[i] = (data[i + 1] - data[i - 1]) * 0.5 * fs;
  return out;
}

// ─── Signal preprocessing ─────────────────────────────────────────────────────

function resampleLinear(signal: number[], srcFs: number, dstFs: number): number[] {
  if (srcFs === dstFs || signal.length < 2) return [...signal];
  const duration = (signal.length - 1) / srcFs;
  const outLen = Math.max(2, Math.round(duration * dstFs) + 1);
  const out = new Array(outLen).fill(0);
  for (let i = 0; i < outLen; i++) {
    const pos = (i / dstFs) * srcFs;
    const l = Math.min(Math.floor(pos), signal.length - 2);
    const frac = pos - l;
    out[i] = signal[l] * (1 - frac) + signal[l + 1] * frac;
  }
  return out;
}

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; }

function bpBiquad(fs: number, low: number, high: number): Biquad {
  // Clamp to safe Nyquist margin (never exceed 45% of fs)
  const nyquist = fs * 0.45;
  const hi = Math.min(high, nyquist);
  const lo = Math.min(low, hi * 0.8);
  if (hi <= lo) {
    // Degenerate range — return identity (pass-through) coefficients
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }
  const fc = (hi + lo) / 2;
  const bw = hi - lo;
  const omega = 2 * Math.PI * fc / fs;
  const sinO = Math.sin(omega);
  if (sinO < 1e-6) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  const alpha = sinO * Math.sinh(Math.log(2) / 2 * bw * omega / sinO);
  const cosOmega = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0, b1: 0, b2: -alpha / a0,
    a1: -2 * cosOmega / a0, a2: (1 - alpha) / a0,
  };
}

function applyBiquad(sig: number[], c: Biquad): number[] {
  const out = new Array(sig.length).fill(0);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < sig.length; i++) {
    const x0 = sig[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0; x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

function filtfiltBiquad(sig: number[], c: Biquad): number[] {
  if (sig.length < 8) return [...sig];
  const pad = Math.min(sig.length - 1, 30);
  const left = sig.slice(1, pad + 1).reverse();
  const right = sig.slice(sig.length - pad - 1, sig.length - 1).reverse();
  const padded = [...left, ...sig, ...right];
  const fwd = applyBiquad(padded, c);
  const bwd = applyBiquad([...fwd].reverse(), c).reverse();
  return bwd.slice(pad, pad + sig.length);
}

function savgolFilter5(sig: number[]): number[] {
  if (sig.length < 5) return [...sig];
  const coeffs = [-3, 12, 17, 12, -3];
  const norm = 35;
  const out = new Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    if (i < 2 || i >= sig.length - 2) { out[i] = sig[i]; continue; }
    let acc = 0;
    for (let k = 0; k < 5; k++) acc += coeffs[k] * sig[i - 2 + k];
    out[i] = acc / norm;
  }
  return out;
}

function preprocessLight(raw: number[], fs: number): number[] {
  const centered = raw.map(v => v - _mean(raw));
  const c = bpBiquad(fs, 0.5, 8.0);
  const bp = filtfiltBiquad(centered, c);
  return savgolFilter5(bp);
}

// ─── Peak detection ──────────────────────────────────────────────────────────

interface Peak { idx: number; val: number; }

function findPeaks(sig: number[], minDist: number): Peak[] {
  const candidates: Peak[] = [];
  for (let i = 1; i < sig.length - 1; i++) {
    if (sig[i] > sig[i - 1] && sig[i] > sig[i + 1])
      candidates.push({ idx: i, val: sig[i] });
  }
  candidates.sort((a, b) => b.val - a.val);
  const kept: Peak[] = [];
  for (const c of candidates) {
    if (!kept.some(p => Math.abs(p.idx - c.idx) < minDist)) kept.push(c);
  }
  return kept.sort((a, b) => a.idx - b.idx);
}

function findValleys(sig: number[], minDist: number): Peak[] {
  return findPeaks(sig.map(v => -v), minDist).map(p => ({ idx: p.idx, val: -p.val }));
}

function findSystolicPeak(ppg: number[], fs: number): number | null {
  const prom = 0.3 * (Math.max(...ppg) - Math.min(...ppg) + 1e-8);
  const minDist = Math.round(0.3 * fs);
  const peaks = findPeaks(ppg, minDist).filter(p => p.val >= Math.min(...ppg) + prom);
  if (!peaks.length) return null;
  return peaks.reduce((best, p) => p.val > best.val ? p : best).idx;
}

// ─── HR estimation ─────────────────────────────────────────────────────────────

/**
 * Autocorrelation-based HR estimation.
 * Finds the dominant repeating period by searching for the peak of the
 * normalised autocorrelation function in the physiological range (40–150 bpm).
 * Immune to dicrotic notch peaks and secondary waveform bumps.
 *
 * @param ppg   preprocessed (mean-subtracted) PPG signal at fs
 * @param fs    sample rate (Hz)
 */
function estimateHrFromAutocorr(
  ppg: number[],
  fs: number,
  logPrefix = '',
): { ppi: number; bpm: number; confidence: number } {
  const n = ppg.length;
  if (n < Math.round(0.8 * fs)) return { ppi: NaN, bpm: NaN, confidence: 0 };

  // Lag range: 40–150 bpm
  const lagMin = Math.round(0.4 * fs);
  const lagMax = Math.min(Math.round(1.5 * fs), n - 1);

  const sigma2 = ppg.reduce((s, v) => s + v * v, 0) / n + 1e-12;

  // Compute normalised ACF
  const acf = new Array(lagMax + 1).fill(0);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    const count = n - lag;
    for (let i = 0; i < count; i++) sum += ppg[i] * ppg[i + lag];
    acf[lag] = sum / (count * sigma2);
  }

  // Smooth ACF with a 3-point moving average to reduce noise spikes
  const acfSmooth = [...acf];
  for (let lag = lagMin + 1; lag < lagMax; lag++) {
    acfSmooth[lag] = (acf[lag - 1] + acf[lag] + acf[lag + 1]) / 3;
  }

  // Find the lag with the highest smoothed ACF value
  let bestLag = -1;
  let bestCorr = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (acfSmooth[lag] > bestCorr) { bestCorr = acfSmooth[lag]; bestLag = lag; }
  }

  if (logPrefix) {
    console.log(`[BP-FEAT ${logPrefix}]   autocorr: bestLag=${bestLag} (${(bestLag/fs).toFixed(3)}s = ${(60*fs/bestLag).toFixed(1)}bpm) corr=${bestCorr.toFixed(3)}`);
  }

  // Threshold lowered to 0.05: even low-confidence autocorr is
  // more reliable than peak-based HR with dicrotic notch false peaks
  if (bestLag < 0 || bestCorr < 0.05) {
    if (logPrefix) console.warn(`[BP-FEAT ${logPrefix}]   autocorr confidence too low (${bestCorr.toFixed(3)}) — using peak fallback`);
    return { ppi: NaN, bpm: NaN, confidence: bestCorr };
  }

  const ppi = bestLag / fs;
  return { ppi, bpm: 60 / ppi, confidence: bestCorr };
}

/** Fallback: median PPI from peaks with larger minDist to avoid dicrotic notches */
function estimateHrFromPeaks(peaks: Peak[], fs: number): { ppi: number; bpm: number } {
  if (peaks.length < 2) return { ppi: NaN, bpm: NaN };
  const intervals = peaks.slice(1).map((p, i) => (p.idx - peaks[i].idx) / fs);
  // 0.5s minimum (120 bpm max) — eliminates dicrotic notch false-positives
  const valid = intervals.filter(t => t >= 0.5 && t <= 1.5);
  if (!valid.length) return { ppi: NaN, bpm: NaN };
  const ppi = _median(valid);
  return { ppi, bpm: 60 / ppi };
}

// ─── APG wave detection ──────────────────────────────────────────────────────

function detectAeWaves(apg: number[], fs: number, pulsePeriodS: number) {
  const wins = {
    a: [0.00, 0.12], b: [0.08, 0.20], c: [0.20, 0.35],
    d: [0.30, 0.45], e: [0.40, 0.58],
  } as const;
  const n = apg.length;
  const vals: Record<string, number> = {};
  for (const [name, [f0, f1]] of Object.entries(wins)) {
    const i0 = Math.min(Math.floor(f0 * pulsePeriodS * fs), n - 1);
    const i1 = Math.min(Math.floor(f1 * pulsePeriodS * fs), n);
    if (i1 <= i0 + 1) { vals[name] = NaN; continue; }
    const seg = apg.slice(i0, i1);
    const isPeak = name === 'a' || name === 'c' || name === 'e';
    const rel = isPeak ? seg.indexOf(Math.max(...seg)) : seg.indexOf(Math.min(...seg));
    vals[name] = apg[i0 + rel];
  }
  return vals as { a: number; b: number; c: number; d: number; e: number };
}

// ─── Time-domain features ─────────────────────────────────────────────────────

function timeDomainFeatures(ppg: number[], fs: number, logPrefix = ''): Record<string, number> {
  const f: Record<string, number> = {};
  f.ppg_mean = _mean(ppg);
  f.ppg_std = _std(ppg);
  f.ppg_skew = _skew(ppg);
  f.ppg_kurtosis = _kurtosis(ppg);

  const minDist = Math.round(0.3 * fs);
  const sigMin = Math.min(...ppg);
  const sigMax = Math.max(...ppg);
  const prom = 0.3 * (sigMax - sigMin + 1e-8);
  const allPeaks = findPeaks(ppg, minDist);
  const peaks = allPeaks.filter(p => p.val >= sigMin + prom);

  if (logPrefix) {
    console.log(`[BP-FEAT ${logPrefix}] timeDomain: signal=[${sigMin.toFixed(3)}, ${sigMax.toFixed(3)}] all_peaks=${allPeaks.length} prom_filtered_peaks=${peaks.length} prom_thresh=${prom.toFixed(3)}`);
    if (peaks.length > 0 && peaks.length <= 20) {
      const intervals = peaks.slice(1).map((p, i) => ((p.idx - peaks[i].idx) / fs).toFixed(3));
      console.log(`[BP-FEAT ${logPrefix}]   peak_indices=[${peaks.map(p => p.idx).join(',')}] intervals_s=[${intervals.join(', ')}]`);
    }
  }

  // ── HR: autocorrelation primary, peak-based fallback ─────────────────────
  const { ppi: acfPpi, bpm: acfBpm, confidence } = estimateHrFromAutocorr(ppg, fs, logPrefix);
  let finalPpi: number;
  let finalBpm: number;

  if (Number.isFinite(acfPpi)) {
    finalPpi = acfPpi;
    finalBpm = acfBpm;
    if (logPrefix) console.log(`[BP-FEAT ${logPrefix}]   HR (autocorr): ppi=${finalPpi.toFixed(3)}s bpm=${finalBpm.toFixed(1)} conf=${confidence.toFixed(3)}`);
  } else {
    // Fallback to peak-based with larger minDist
    const { ppi: pkPpi, bpm: pkBpm } = estimateHrFromPeaks(peaks, fs);
    finalPpi = pkPpi;
    finalBpm = pkBpm;
    if (logPrefix) console.log(`[BP-FEAT ${logPrefix}]   HR (peak-fallback): ppi=${isNaN(finalPpi)?'NaN':finalPpi.toFixed(3)}s bpm=${isNaN(finalBpm)?'NaN':finalBpm.toFixed(1)}`);
  }

  f.peak_to_peak_interval = finalPpi;
  f.hr_est = finalBpm;

  const sysIdx = findSystolicPeak(ppg, fs);
  if (sysIdx !== null) {
    const troughs = findValleys(ppg.slice(0, sysIdx + 1), 1);
    const onsetIdx = troughs.length ? troughs[troughs.length - 1].idx : 0;

    f.rise_time = (sysIdx - onsetIdx) / fs;
    f.pulse_width = (ppg.length - onsetIdx) / fs;
    f.crest_time = f.rise_time;
    f.systolic_amplitude = ppg[sysIdx] - ppg[onsetIdx];

    const tail = ppg.slice(sysIdx);
    const fallTroughs = findValleys(tail, 1);
    f.fall_time = fallTroughs.length
      ? fallTroughs[fallTroughs.length - 1].idx / fs
      : tail.length / fs;

    f.systolic_area = trapz(ppg.slice(onsetIdx, sysIdx).map(v => Math.max(v, 0)));
    f.diastolic_area = trapz(ppg.slice(sysIdx).map(v => Math.max(v, 0)));
    f.total_pulse_area = f.systolic_area + f.diastolic_area;

    const halfTail = tail.slice(0, Math.max(Math.floor(tail.length / 2), 1));
    const notchCandidates = findValleys(halfTail, 1);
    if (notchCandidates.length) {
      const notchIdx = sysIdx + notchCandidates[0].idx;
      f.dicrotic_notch_height = ppg[notchIdx];
      const diaTail = ppg.slice(notchIdx);
      const diaPeaks = findPeaks(diaTail, 1);
      if (diaPeaks.length) {
        const diaIdx = notchIdx + diaPeaks[0].idx;
        f.diastolic_amplitude = ppg[diaIdx] - ppg[onsetIdx];
        f.augmentation_index = ppg[diaIdx] / (ppg[sysIdx] + 1e-8);
        f.notch_to_diastolic_ratio = ppg[notchIdx] / (ppg[diaIdx] + 1e-8);
      } else {
        f.diastolic_amplitude = NaN;
        f.augmentation_index = NaN;
        f.notch_to_diastolic_ratio = NaN;
      }
    } else {
      f.dicrotic_notch_height = NaN;
      f.diastolic_amplitude = NaN;
      f.augmentation_index = NaN;
      f.notch_to_diastolic_ratio = NaN;
    }
    f.reflection_index = (f.diastolic_amplitude ?? NaN) / (f.systolic_amplitude + 1e-8);
    f.pulse_amplitude_ratio = f.systolic_area / (f.diastolic_area + 1e-8);
  } else {
    if (logPrefix) console.warn(`[BP-FEAT ${logPrefix}]   ⚠️ No systolic peak found on processed signal!`);
    for (const k of [
      'rise_time', 'pulse_width', 'crest_time', 'systolic_amplitude', 'fall_time',
      'systolic_area', 'diastolic_area', 'total_pulse_area', 'dicrotic_notch_height',
      'diastolic_amplitude', 'augmentation_index', 'notch_to_diastolic_ratio',
      'reflection_index', 'pulse_amplitude_ratio',
    ]) f[k] = NaN;
  }
  return f;
}

// ─── Derivative features ──────────────────────────────────────────────────────

function derivativeFeatures(vpg: number[], apg: number[], fs: number): Record<string, number> {
  const zc: number[] = [];
  for (let i = 0; i < vpg.length - 1; i++) {
    if (Math.sign(vpg[i]) !== Math.sign(vpg[i + 1])) zc.push(i);
  }
  let pulsePeriodS = apg.length / fs;
  if (zc.length > 3) {
    const diffs = zc.slice(1).map((v, i) => v - zc[i]);
    pulsePeriodS = (_median(diffs) * 2) / fs;
  }

  const waves = detectAeWaves(apg, fs, pulsePeriodS);
  const { a, b, c, d, e } = waves;
  const aSafe = Number.isFinite(a) ? a : NaN;
  const safe = (num: number) => (Number.isFinite(aSafe) && Number.isFinite(num)) ? num / (aSafe + 1e-12) : NaN;

  const apgZC = apg.slice(0, -1).reduce((cnt, v, i) =>
    Math.sign(v) !== Math.sign(apg[i + 1]) ? cnt + 1 : cnt, 0);

  return {
    a_amp: a, b_amp: b, c_amp: c, d_amp: d, e_amp: e,
    b_a: safe(b), c_a: safe(c), d_a: safe(d), e_a: safe(e),
    aging_index: (Number.isFinite(aSafe) && [b, c, d, e].every(Number.isFinite))
      ? (b - c - d - e) / (aSafe + 1e-12) : NaN,
    stiffness_index: _nanMax(vpg) - _nanMin(vpg),
    vpg_max: _nanMax(vpg), vpg_min: _nanMin(vpg),
    vpg_mean: _nanMean(vpg), vpg_std: _nanStd(vpg),
    apg_max: _nanMax(apg), apg_min: _nanMin(apg),
    apg_mean: _nanMean(apg), apg_std: _nanStd(apg),
    vpg_slope_mean: _nanMean(gradient(vpg)),
    apg_slope_mean: _nanMean(gradient(apg)),
    vpg_time_to_peak: vpg.length ? vpg.indexOf(Math.max(...vpg)) / fs : NaN,
    apg_time_to_peak: apg.length ? apg.indexOf(Math.max(...apg)) / fs : NaN,
    apg_zero_crossings: apgZC,
  };
}

// ─── Frequency-domain features ────────────────────────────────────────────────

function getWelchPsd(sig: number[], fs: number): { freqs: number[]; psd: number[] } {
  // Match python's nperseg=min(128, len(ppg))
  const nperseg = Math.min(128, sig.length);
  if (nperseg < 16) return { freqs: [], psd: [] };
  const step = Math.max(1, Math.floor(nperseg / 2));
  const win = Array.from({ length: nperseg }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (nperseg - 1))));
  const acc = new Array(Math.floor(nperseg / 2) + 1).fill(0);
  let nWins = 0;
  for (let s = 0; s + nperseg <= sig.length; s += step) {
    const seg = sig.slice(s, s + nperseg).map((v, i) => v * win[i]);
    for (let k = 0; k < acc.length; k++) {
      let re = 0, im = 0;
      for (let t = 0; t < nperseg; t++) {
        const angle = -2 * Math.PI * k * t / nperseg;
        re += seg[t] * Math.cos(angle);
        im += seg[t] * Math.sin(angle);
      }
      acc[k] += re * re + im * im;
    }
    nWins++;
  }
  if (!nWins) return { freqs: [], psd: [] };
  const winPow = win.reduce((s, v) => s + v * v, 0);
  const scale = 1 / (winPow * fs + 1e-12);
  const psd = acc.map((v, i) => {
    const base = (v / nWins) * scale;
    return i > 0 && i < acc.length - 1 ? base * 2 : base;
  });
  const freqs = psd.map((_, i) => (i * fs) / nperseg);
  return { freqs, psd };
}

function freqDomainFeatures(ppg: number[], fs: number): Record<string, number> {
  const { freqs, psd } = getWelchPsd(ppg, fs);
  if (!freqs.length) {
    const f: Record<string, number> = {};
    for (let i = 0; i < 8; i++) f[`band_power_${i}`] = NaN;
    return { ...f, fundamental_freq: NaN, total_power: NaN, spectral_entropy: NaN, spectral_centroid: NaN };
  }
  const bands: [number, number][] = [
    [0.5, 1.0], [1.0, 1.5], [1.5, 2.0], [2.0, 3.0],
    [3.0, 4.0], [4.0, 6.0], [6.0, 8.0], [8.0, 10.0],
  ];
  const f: Record<string, number> = {};
  bands.forEach(([lo, hi], i) => {
    f[`band_power_${i}`] = freqs.reduce((s, freq, k) => freq >= lo && freq < hi ? s + psd[k] : s, 0);
  });
  const totalPow = psd.reduce((s, v) => s + v, 0);
  f.total_power = totalPow;
  f.fundamental_freq = freqs[psd.indexOf(Math.max(...psd))];
  const psdNorm = psd.map(v => v / (totalPow + 1e-12));
  f.spectral_entropy = -psdNorm.reduce((s, p) => s + p * Math.log(p + 1e-12), 0);
  f.spectral_centroid = freqs.reduce((s, freq, k) => s + freq * psdNorm[k], 0);
  return f;
}

// ─── Quantum-inspired features ─────────────────────────────────────────────────

function quantumFeatures(ppg: number[], vpg: number[], apg: number[]): Record<string, number> {
  const maxV = Math.max(...ppg.filter(Number.isFinite));
  const minV = Math.min(...ppg.filter(Number.isFinite));
  const range = maxV - minV + 1e-8;

  const energy = ppg.reduce((s, v) => s + v * v, 0) / (ppg.length + 1e-8);
  const normEnergy = energy / (range * range + 1e-8);
  const purity = Math.min(Math.max(normEnergy, 0), 1);

  const buckets = new Array(32).fill(0);
  ppg.forEach(v => {
    const bin = Math.min(31, Math.max(0, Math.floor(((v - minV) / range) * 32)));
    buckets[bin]++;
  });
  const probs = buckets.map(c => c / ppg.length);
  const vonNeumann = -probs.reduce((s, p) => p > 0 ? s + p * Math.log(p + 1e-12) : s, 0);

  const vpgMean = _mean(vpg); const apgMean = _mean(apg);
  const n = Math.min(vpg.length, apg.length);
  let cov = 0, sv = 0, sa = 0;
  for (let i = 0; i < n; i++) {
    cov += (vpg[i] - vpgMean) * (apg[i] - apgMean);
    sv += (vpg[i] - vpgMean) ** 2;
    sa += (apg[i] - apgMean) ** 2;
  }
  const coherence = Math.abs(cov / (Math.sqrt(sv * sa) + 1e-8));
  const fidelity = ppg.filter(v => v > minV + range * 0.1 && v < maxV - range * 0.1).length / ppg.length;
  const normMid = (ppg[Math.floor(ppg.length / 2)] - minV) / range;

  // The exported SBP/DBP/glucose configs were trained on quantum features that
  // are effectively near-constant. If we feed these raw values at full scale,
  // they explode after standardization and dominate the entire model input.
  // Keep them numerically aligned with the training distribution instead of
  // letting them behave like ordinary 0..1 style features.
  const purityNearOne = 1 - ((1 - purity) * 1e-9);
  const vonNeumannNearZero = vonNeumann * 1e-9;

  return {
    quantum_purity: purityNearOne,
    quantum_von_neumann_entropy: vonNeumannNearZero,
    quantum_phase_coherence: coherence,
    quantum_state_fidelity: fidelity,
    quantum_bloch_z_expval: normMid * 2 - 1,
    quantum_bloch_x_expval: Math.cos(Math.PI * normMid),
  };
}

// ─── Derived composite features ───────────────────────────────────────────────

function derivedFeatures(base: Record<string, number>): Record<string, number> {
  const sysAmp = base.systolic_amplitude ?? 0;
  const ri = base.reflection_index ?? 0;
  const stiff = base.stiffness_index ?? 0;
  const aging = base.aging_index ?? 0;
  const hr = base.hr_est ?? 72;
  const ppi = base.peak_to_peak_interval ?? 0;
  const lf = base.band_power_3 ?? 0;
  const hf = base.band_power_2 ?? 1e-8;

  return {
    pulse_pressure_proxy: sysAmp * ppi,
    stiffness_aging_product: stiff * Math.abs(aging),
    reflection_timing_index: ri * (base.rise_time ?? 0),
    vascular_load_index: (base.total_pulse_area ?? 0) / (sysAmp + 1e-8),
    hrv_spectral_balance: lf / (hf + 1e-8),
    metabolic_stiffness_coupling: stiff * hr,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface SegmentFeatures {
  sbpFeatures: Float32Array; // 80 values
  mapFeatures: Float32Array; // 136 values
  pulseBpm: number;
}

/**
 * Extract 80-feature SBP vector and 136-feature MAP vector from a raw PPG segment.
 *
 * @param rawSegment   raw PPG samples at actualFs rate — avg red channel from camera
 * @param actualFs     MEASURED frame rate from timestamps (not assumed APP_FS)
 * @param demographics patient demographics
 * @param segmentIndex for log labelling
 */
export function extractSegmentFeatures(
  rawSegment: number[],
  actualFs: number,
  demographics: BpDemographics,
  segmentIndex = 0,
): SegmentFeatures {
  const LOG = `seg${segmentIndex}`;

  // ── ① Raw signal diagnostics ──────────────────────────────────────────────
  const rawMin = Math.min(...rawSegment);
  const rawMax = Math.max(...rawSegment);
  const rawStd = _std(rawSegment);
  console.log(`\n[BP-PIPE ${LOG}] ════════════════════ START SEGMENT ${segmentIndex} ════════════════════`);
  console.log(`[BP-PIPE ${LOG}] ① RAW: n=${rawSegment.length} actualFs=${actualFs.toFixed(1)} range=[${rawMin.toFixed(1)}, ${rawMax.toFixed(1)}] std=${rawStd.toFixed(2)} demographics=${JSON.stringify(demographics)}`);

  // Only reject truly constant/dead signals. A real PPG from a finger + torch
  // produces just 0.5–2.0 ADC units of std on a 0–255 camera red channel
  // (heartbeat shifts red by ~1–5 counts). The post-preprocessing guard below
  // (procStd < 1e-4) is the reliable noise rejection stage — bandpass filtering
  // crushes ambient flicker to near-zero while preserving real pulsatile content.
  if (rawStd < 0.3) {
    throw new Error(`FLATLINE: std=${rawStd.toFixed(3)} — sensor appears completely dead or torch is off.`);
  }

  // ── ② Invert (matches training: inv_sig = -1 * raw_sig) ──────────────────
  const inverted = rawSegment.map(v => -v);
  console.log(`[BP-PIPE ${LOG}] ② Inverted: range=[${Math.min(...inverted).toFixed(1)}, ${Math.max(...inverted).toFixed(1)}]`);

  // ── ③ Resample to PROC_FS ─────────────────────────────────────────────────
  const resampled = resampleLinear(inverted, actualFs, PROC_FS);
  console.log(`[BP-PIPE ${LOG}] ③ Resample ${actualFs.toFixed(1)}→${PROC_FS}Hz: n_out=${resampled.length}`);

  // ── ④ Heavy preprocessing: bandpass at actualFs + 3× SG5 ─────────────────────────────
  const heavyCentered = resampled.map(v => v - _mean(resampled));
  const heavyBp = filtfiltBiquad(heavyCentered, bpBiquad(PROC_FS, 0.5, 8.0));
  const heavy = savgolFilter5(savgolFilter5(savgolFilter5(heavyBp)));
  console.log(`[BP-PIPE ${LOG}] ④ Heavy preprocess: range=[${Math.min(...heavy).toFixed(4)}, ${Math.max(...heavy).toFixed(4)}] std=${_std(heavy).toFixed(4)}`);

  // Guard: after the full preprocessing chain a real PPG should still have
  // meaningful variation. Near-zero std means the raw signal was pure noise
  // that the bandpass filter cancelled out.
  const procStd = _std(heavy);
  if (procStd < 1e-4) {
    throw new Error(`Signal has no variation after preprocessing (std=${procStd.toExponential(2)}) — likely not a real PPG signal.`);
  }

  // ── ⑤ Light preprocessing: bandpass + single SG5 at actualFs ──────────────
  const lightAtAppFs = preprocessLight(inverted, actualFs);
  const lightResampled = resampleLinear(lightAtAppFs, actualFs, PROC_FS);
  console.log(`[BP-PIPE ${LOG}] ⑤ Light preprocess: range=[${Math.min(...lightResampled).toFixed(4)}, ${Math.max(...lightResampled).toFixed(4)}]`);

  // ── Feature extraction ─────────────────────────────────────────────────────
  const vpg = gradient(heavy, PROC_FS);
  const apg = gradient(vpg, PROC_FS);

  // Higher-order derivatives can explode very quickly when the signal is
  // sampled at 100 Hz. The training config expects these features to stay in a
  // much narrower range, so normalize the third-derivative branch before
  // taking the fourth derivative. This keeps `jpg_*` from dominating the model
  // input while preserving relative shape changes.
  const dpg = gradient(apg, PROC_FS).map(v => v / PROC_FS);
  const jpg = gradient(dpg, PROC_FS);

  const tdH   = timeDomainFeatures(heavy, PROC_FS, LOG);   // logs peak info + HR
  const derH  = derivativeFeatures(vpg, apg, PROC_FS);
  const freqH = freqDomainFeatures(heavy, PROC_FS);
  const quantH = quantumFeatures(heavy, vpg, apg);
  const derivedH = derivedFeatures({ ...tdH, ...derH, ...freqH });

  const dpgFeats = { dpg_max: _nanMax(dpg), dpg_min: _nanMin(dpg), dpg_std: _nanStd(dpg), dpg_mean: _nanMean(dpg) };
  const jpgFeats = { jpg_max: _nanMax(jpg), jpg_min: _nanMin(jpg), jpg_std: _nanStd(jpg), jpg_mean: _nanMean(jpg) };
  const demoFeats = { demo_age: demographics.age, demo_sex: demographics.sex, demo_weight: demographics.weight, demo_height: demographics.height };

  const heavyMap: Record<string, number> = {
    ...tdH, ...derH, ...freqH, ...quantH, ...derivedH, ...dpgFeats, ...jpgFeats, ...demoFeats,
  };

  const vpgL = gradient(lightResampled, PROC_FS);
  const apgL = gradient(vpgL, PROC_FS);
  const tdL   = timeDomainFeatures(lightResampled, PROC_FS);
  const derL  = derivativeFeatures(vpgL, apgL, PROC_FS);
  const freqL = freqDomainFeatures(lightResampled, PROC_FS);
  const lightMap: Record<string, number> = { ...tdL, ...derL, ...freqL };

  // ── Assemble feature arrays ───────────────────────────────────────────────
  const sbpArr = new Float32Array(80);
  SBP_FEATURE_NAMES.forEach((name, i) => {
    const val = heavyMap[name];
    sbpArr[i] = Number.isFinite(val) ? val : NaN;
  });

  const mapArr = new Float32Array(136);
  sbpArr.forEach((v, i) => { mapArr[i] = v; });
  LIGHT_BASE_NAMES.forEach((name, i) => {
    const val = lightMap[name];
    mapArr[80 + i] = Number.isFinite(val) ? val : NaN;
  });

  // ── ⑥ Final diagnostics ───────────────────────────────────────────────────
  const sbpNaN = Array.from(sbpArr).filter(v => isNaN(v)).length;
  const mapNaN = Array.from(mapArr).filter(v => isNaN(v)).length;
  const pulseBpm = Number.isFinite(tdH.peak_to_peak_interval) && tdH.peak_to_peak_interval > 0
    ? 60 / tdH.peak_to_peak_interval : 0;

  console.log(`[BP-PIPE ${LOG}] ⑥ KEY FEATURES:`);
  console.log(`[BP-PIPE ${LOG}]   hr_est=${isNaN(tdH.hr_est) ? 'NaN' : tdH.hr_est.toFixed(1)} bpm | ppi=${isNaN(tdH.peak_to_peak_interval) ? 'NaN' : tdH.peak_to_peak_interval.toFixed(3)}s`);
  console.log(`[BP-PIPE ${LOG}]   sys_amp=${tdH.systolic_amplitude?.toFixed(4)} | aug_idx=${tdH.augmentation_index?.toFixed(4)} | refl_idx=${tdH.reflection_index?.toFixed(4)}`);
  console.log(`[BP-PIPE ${LOG}]   fundamental_freq=${freqH.fundamental_freq?.toFixed(3)}Hz | total_power=${freqH.total_power?.toFixed(6)}`);
  console.log(`[BP-PIPE ${LOG}]   stiffness=${derH.stiffness_index?.toFixed(4)} | aging_idx=${derH.aging_index?.toFixed(4)}`);
  console.log(`[BP-PIPE ${LOG}] ⑦ NaN counts: sbpArr=${sbpNaN}/80 mapArr=${mapNaN}/136`);

  if (sbpNaN > 0) {
    const nanNames = SBP_FEATURE_NAMES.filter((_, i) => isNaN(sbpArr[i]));
    console.warn(`[BP-PIPE ${LOG}]   NaN features: [${nanNames.join(', ')}]`);
  }

  console.log(`[BP-PIPE ${LOG}] ⑧ SBP vec[0:10]:`, Array.from(sbpArr.slice(0, 10)).map(v => isNaN(v) ? 'NaN' : v.toFixed(4)));
  console.log(`[BP-PIPE ${LOG}] ⑧ SBP vec[70:80] (dpg/jpg/demo):`, Array.from(sbpArr.slice(70, 80)).map(v => isNaN(v) ? 'NaN' : v.toFixed(4)));
  console.log(`[BP-PIPE ${LOG}] ✅ pulse_bpm=${pulseBpm.toFixed(1)} — segment ready for ONNX`);
  console.log(`[BP-PIPE ${LOG}] ════════════════════ END SEGMENT ${segmentIndex} ══════════════════════\n`);

  return { sbpFeatures: sbpArr, mapFeatures: mapArr, pulseBpm };
}
