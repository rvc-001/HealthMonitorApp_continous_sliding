import { readJsonStorage, removeStorage, writeJsonStorage } from '@/lib/browser-storage';
import Fili from 'fili';

export const FS = 25;
export const TRIM_SAMPLES = FS * 5;
export const PRS_THRESHOLD = 0.4;
export const TARGET_STD = 150.0;
export const TARGET_MEAN = 0.0;

export const MODEL_FEATURES: string[] = [];

export const DEMOGRAPHIC_FEATURES = ['Age', 'Height', 'Weight', 'BMI'] as const;

export type FeatureName = string;
export type FeatureMap = Record<string, number>;

export interface FilterConfig {
  lowCutoff: number;
  highCutoff: number;
  order: number;
  samplingRate: number;
}

export interface SignalSample {
  timestamp: number;
  value: number;
}

export interface RecordingSession {
  id: string;
  startTime: number;
  endTime?: number;
  samplingRate: number;
  rawSignal: SignalSample[];
  createdAt: Date;
  patientId?: string;
  patientName?: string;
  age?: number;
  height?: number;
  weight?: number;
  features?: number[];
  sbp?: number;
  dbp?: number;
  glucose?: number;
  quality?: string;
  prsScore?: number;
  pulseBpm?: number;
  modelRuntimeMs?: number;
  modelEngine?: string;
  modelPath?: string;
  modelInputLength?: number;
}

export interface ExtractedAnalysis {
  featureMap: FeatureMap;
  featureVector: number[];
  prs: number;
  pulseBpm: number;
}

export interface OptimalSignalWindow {
  startIndex: number;
  endIndex: number;
  rawSignal: number[];
  analysis: ExtractedAnalysis;
}

export interface ModelInputDemographics {
  age: number;
  height: number;
  weight: number;
}

const FEATURE_INDEX = new Map<string, number>();

const _mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const _min = (arr: number[]) => arr.length ? Math.min(...arr) : 0;
const _max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;

function _std(arr: number[]) {
  if (arr.length <= 1) return 0;
  const m = _mean(arr);
  return Math.sqrt(arr.reduce((sum, value) => sum + (value - m) ** 2, 0) / arr.length);
}

function _quantile(arr: number[], q: number) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return sorted[base] + rest * (next - sorted[base]);
}

function _skew(arr: number[]) {
  if (arr.length < 3) return 0;
  const m = _mean(arr);
  const s = _std(arr);
  if (s === 0) return 0;
  return _mean(arr.map((value) => ((value - m) / s) ** 3));
}

function _kurtosis(arr: number[]) {
  if (arr.length < 4) return 0;
  const m = _mean(arr);
  const s = _std(arr);
  if (s === 0) return 0;
  return _mean(arr.map((value) => ((value - m) / s) ** 4)) - 3;
}

function trapz(y: number[]) {
  let sum = 0;
  for (let i = 0; i < y.length - 1; i++) {
    sum += (y[i] + y[i + 1]) * 0.5;
  }
  return sum;
}

function gradient(data: number[]) {
  const n = data.length;
  if (n < 2) return new Array(n).fill(0);
  const out = new Array(n).fill(0);
  out[0] = data[1] - data[0];
  out[n - 1] = data[n - 1] - data[n - 2];
  for (let i = 1; i < n - 1; i++) {
    out[i] = (data[i + 1] - data[i - 1]) * 0.5;
  }
  return out;
}

function gaussianFilter1d(data: number[], sigma: number) {
  const radius = Math.max(1, Math.ceil(4 * sigma));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  const normalized = kernel.map((value) => value / sum);
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    let acc = 0;
    for (let j = 0; j < normalized.length; j++) {
      const idx = Math.min(Math.max(i + j - radius, 0), data.length - 1);
      acc += data[idx] * normalized[j];
    }
    out[i] = acc;
  }
  return out;
}

function sanitizeSignal(raw: number[]) {
  return raw
    .map((value) => Number.isFinite(value) ? value : 0)
    .filter((value) => !Number.isNaN(value));
}

// Causal moving average: removes camera/electrical noise spikes before they reach
// the IIR filter. Spikes are the primary trigger of Gibbs ringing on the bandpass output.
function movingAverage(signal: number[], windowSize: number) {
  if (signal.length === 0 || windowSize <= 1) return [...signal];
  const out = new Array(signal.length);
  let runningSum = 0;
  for (let i = 0; i < signal.length; i++) {
    runningSum += signal[i];
    if (i >= windowSize) runningSum -= signal[i - windowSize];
    const count = Math.min(i + 1, windowSize);
    out[i] = runningSum / count;
  }
  return out;
}

function invertSignal(signal: number[]) {
  return signal.map((value) => -value);
}

function scaleSignalToTrainingDomain(signal: number[]) {
  if (!signal.length) return [];
  const currentMean = _mean(signal);
  const currentStd = _std(signal);
  if (!Number.isFinite(currentStd) || currentStd <= 1e-8) {
    return signal.map(() => TARGET_MEAN);
  }
  return signal.map((value) => ((value - currentMean) / currentStd) * TARGET_STD + TARGET_MEAN);
}

function resampleLinear(signal: number[], sourceRate: number, targetRate: number) {
  if (!signal.length || sourceRate <= 0 || targetRate <= 0 || sourceRate === targetRate) {
    return [...signal];
  }
  const duration = (signal.length - 1) / sourceRate;
  const outputLength = Math.max(2, Math.round(duration * targetRate) + 1);
  const out = new Array(outputLength).fill(0);
  for (let i = 0; i < outputLength; i++) {
    const t = i / targetRate;
    const pos = t * sourceRate;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, signal.length - 1);
    const frac = pos - left;
    out[i] = signal[left] * (1 - frac) + signal[right] * frac;
  }
  return out;
}

function dftReal(signal: number[]) {
  const n = signal.length;
  const real = new Array(n).fill(0);
  const imag = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sumReal = 0;
    let sumImag = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sumReal += signal[t] * Math.cos(angle);
      sumImag += signal[t] * Math.sin(angle);
    }
    real[k] = sumReal;
    imag[k] = sumImag;
  }
  return { real, imag };
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function createLowpassBiquad(fs: number, cutoffHz: number, q = Math.SQRT1_2): BiquadCoefficients {
  const omega = (2 * Math.PI * Math.max(1e-6, cutoffHz)) / fs;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cos) * 0.5) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) * 0.5) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function createHighpassBiquad(fs: number, cutoffHz: number, q = Math.SQRT1_2): BiquadCoefficients {
  const omega = (2 * Math.PI * Math.max(1e-6, cutoffHz)) / fs;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) * 0.5) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) * 0.5) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(signal: number[], coeffs: BiquadCoefficients) {
  const out = new Array(signal.length).fill(0);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return out;
}

function reflectPad(signal: number[], padLength: number) {
  if (signal.length < 2 || padLength <= 0) return [...signal];
  const left = new Array(padLength).fill(0).map((_, i) => signal[Math.min(padLength - i, signal.length - 1)]);
  const right = new Array(padLength).fill(0).map((_, i) => signal[Math.max(signal.length - 2 - i, 0)]);
  return [...left, ...signal, ...right.reverse()];
}

function filtfiltBiquad(signal: number[], coeffs: BiquadCoefficients) {
  if (signal.length < 8) return [...signal];
  // Increased pad: gives IIR filter more pre-history to settle before real signal starts,
  // suppressing startup transients at both edges.
  const padLength = Math.min(signal.length - 1, 30);
  const padded = reflectPad(signal, padLength);
  const forward = applyBiquad(padded, coeffs);
  const backward = applyBiquad([...forward].reverse(), coeffs).reverse();
  return backward.slice(padLength, padLength + signal.length);
}

function bandpassIirZeroPhase(signal: number[], fs: number, lowHz: number, highHz: number) {
  if (signal.length < 8) return [...signal];
  const centered = signal.map((value) => value - _mean(signal));
  const calc = new Fili.CalcCascades();
  const coeffs = calc.bandpass({
    // Order 2 (down from 4): gentler roll-off avoids the steep step-response transients
    // that cause Gibbs-phenomenon ringing around each systolic peak.
    order: 2,
    characteristic: 'butterworth',
    Fs: fs,
    Fc: (highHz - lowHz) / 2 + lowHz,
    BW: highHz - lowHz
  });

  const forwardFilter = new Fili.IirFilter(coeffs);
  const forwardFiltered = forwardFilter.multiStep(centered);

  const backwardFilter = new Fili.IirFilter(coeffs);
  const backwardFiltered = backwardFilter.multiStep([...forwardFiltered].reverse());

  return backwardFiltered.reverse();
}

function findPeaks(signal: number[], minDistance: number) {
  const candidates: { index: number; prominence: number }[] = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] <= signal[i - 1] || signal[i] <= signal[i + 1]) continue;
    candidates.push({ index: i, prominence: signal[i] });
  }
  candidates.sort((a, b) => signal[b.index] - signal[a.index]);

  const kept: { index: number; prominence: number }[] = [];
  for (const candidate of candidates) {
    if (!kept.some((peak) => Math.abs(peak.index - candidate.index) < minDistance)) {
      kept.push(candidate);
    }
  }

  return kept.sort((a, b) => a.index - b.index);
}

function findValleys(signal: number[], minDistance: number) {
  return findPeaks(signal.map((value) => -value), minDistance).map((peak) => ({
    index: peak.index,
    prominence: peak.prominence,
  }));
}

function getWelchPsd(signal: number[], fs: number) {
  const nperseg = Math.min(128, signal.length);
  if (nperseg < 16) {
    return { freqs: [] as number[], psd: [] as number[] };
  }

  const step = Math.max(1, Math.floor(nperseg / 2));
  const window = new Array(nperseg).fill(0).map((_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nperseg - 1))));
  const accumulator = new Array(Math.floor(nperseg / 2) + 1).fill(0);
  let windows = 0;

  for (let start = 0; start + nperseg <= signal.length; start += step) {
    const segment = signal.slice(start, start + nperseg).map((value, i) => value * window[i]);
    const { real, imag } = dftReal(segment);
    for (let k = 0; k < accumulator.length; k++) {
      accumulator[k] += real[k] * real[k] + imag[k] * imag[k];
    }
    windows++;
  }

  if (!windows) {
    return { freqs: [] as number[], psd: [] as number[] };
  }

  const scale = 1 / Math.max(window.reduce((sum, value) => sum + value * value, 0) * fs, 1e-8);
  const psd = accumulator.map((value, idx) => {
    const base = (value / windows) * scale;
    return idx > 0 && idx < accumulator.length - 1 ? base * 2 : base;
  });
  const freqs = psd.map((_, idx) => (idx * fs) / nperseg);
  return { freqs, psd };
}

function bandPower(freqs: number[], psd: number[], low: number, high: number) {
  let sum = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= low && freqs[i] <= high) {
      sum += psd[i];
    }
  }
  return sum;
}

function spectralEntropy(psd: number[]) {
  const sum = psd.reduce((acc, value) => acc + Math.max(value, 0), 0);
  if (!sum) return 0;
  const probs = psd.filter((value) => value > 0).map((value) => value / sum);
  const entropy = -probs.reduce((acc, value) => acc + value * Math.log2(value), 0);
  return probs.length > 1 ? entropy / Math.log2(probs.length) : 0;
}

function sampleEntropy(signal: number[], m = 2, rRatio = 0.2) {
  if (signal.length < m + 2) return 0;
  const sd = _std(signal);
  const r = sd * rRatio;
  if (r === 0) return 0;

  const countMatches = (size: number) => {
    let matches = 0;
    for (let i = 0; i < signal.length - size; i++) {
      for (let j = i + 1; j < signal.length - size; j++) {
        let matched = true;
        for (let k = 0; k < size; k++) {
          if (Math.abs(signal[i + k] - signal[j + k]) > r) {
            matched = false;
            break;
          }
        }
        if (matched) matches++;
      }
    }
    return matches;
  };

  const b = countMatches(m);
  const a = countMatches(m + 1);
  if (b === 0 || a === 0) return 0;
  return -Math.log(a / b);
}

function permutationEntropy(signal: number[], order = 3, delay = 1) {
  const counts = new Map<string, number>();
  const total = Math.max(0, signal.length - (order - 1) * delay);
  if (total <= 1) return 0;
  for (let i = 0; i < total; i++) {
    const pattern = Array.from({ length: order }, (_, idx) => ({
      idx,
      value: signal[i + idx * delay],
    }))
      .sort((a, b) => a.value - b.value)
      .map((item) => item.idx)
      .join('-');
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  const probs = [...counts.values()].map((value) => value / total);
  const entropy = -probs.reduce((sum, value) => sum + value * Math.log2(value), 0);
  const maxEntropy = Math.log2(factorial(order));
  return maxEntropy ? entropy / maxEntropy : 0;
}

function factorial(n: number) {
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

function higuchiFd(signal: number[], kMax = 5) {
  if (signal.length < 16) return 1;
  const lengths: number[] = [];
  const scales: number[] = [];
  for (let k = 1; k <= kMax; k++) {
    let lk = 0;
    for (let m = 0; m < k; m++) {
      let length = 0;
      let count = 0;
      for (let i = 1; m + i * k < signal.length; i++) {
        length += Math.abs(signal[m + i * k] - signal[m + (i - 1) * k]);
        count++;
      }
      if (count > 0) {
        const norm = ((signal.length - 1) / (count * k)) / Math.max(k, 1);
        lk += length * norm;
      }
    }
    lk /= k;
    if (lk > 0) {
      lengths.push(Math.log(lk));
      scales.push(Math.log(1 / k));
    }
  }
  if (lengths.length < 2) return 1;
  const meanX = _mean(scales);
  const meanY = _mean(lengths);
  let num = 0;
  let den = 0;
  for (let i = 0; i < scales.length; i++) {
    num += (scales[i] - meanX) * (lengths[i] - meanY);
    den += (scales[i] - meanX) ** 2;
  }
  return den ? num / den : 1;
}

function normalize(value: number, minValue: number, maxValue: number, invert = false) {
  if (!Number.isFinite(value)) return 0.5;
  const norm = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  return invert ? 1 - norm : norm;
}

export function getFeature(featureVector: number[], name: FeatureName) {
  const index = MODEL_FEATURES.indexOf(name);
  return index >= 0 ? featureVector[index] : Number.NaN;
}

export function getPulseBpm(featureMap: FeatureMap) {
  const hrv_rr_mean = featureMap['hrv_rr_mean'];
  return (Number.isFinite(hrv_rr_mean) && hrv_rr_mean > 0) ? 60 / hrv_rr_mean : 0;
}

export function calculatePRS(featureMap: FeatureMap) {
  let prs = 1.0;
  const hrv_cv = featureMap['hrv_cv'];
  const hrv_rr_mean = featureMap['hrv_rr_mean'];
  const hr = (Number.isFinite(hrv_rr_mean) && hrv_rr_mean > 0) ? 60 / hrv_rr_mean : 0;

  if (!Number.isFinite(hrv_cv) || hrv_cv > 0.15) prs -= 0.5;
  if (!Number.isFinite(hr) || hr < 45 || hr > 130) prs -= 0.5;

  return Math.max(0.0, prs);
}

function preprocessCore(raw: number[], sourceRate = FS) {
  const sanitized = sanitizeSignal(raw);
  if (!sanitized.length) return [];
  const smoothed = movingAverage(sanitized, 5);
  const inverted = invertSignal(smoothed);
  // Guard: if the raw signal has almost no variation it cannot be a real PPG signal.
  // Ambient light without a finger will either be flat or have only high-frequency noise
  // that gets eliminated by the bandpass filter, producing a near-zero output.
  if (_std(inverted) < 0.3) return [];
  const resampled = resampleLinear(inverted, sourceRate, FS);
  return bandpassIirZeroPhase(resampled, FS, 0.5, 8.0);
}

export function preprocessPreviewPPG(raw: number[], sourceRate = FS) {
  const filtered = preprocessCore(raw, sourceRate);
  if (!filtered.length) return [];
  return scaleSignalToTrainingDomain(filtered);
}

export function preprocessPPG(raw: number[], sourceRate = FS) {
  const filtered = preprocessCore(raw, sourceRate);
  if (filtered.length <= 2 * TRIM_SAMPLES) {
    return scaleSignalToTrainingDomain(filtered);
  }
  const trimmed = filtered.slice(TRIM_SAMPLES, filtered.length - TRIM_SAMPLES);
  return scaleSignalToTrainingDomain(trimmed);
}

function buildFeatureMap(ppg: number[]): FeatureMap {
  if (!ppg.length) throw new Error('Signal is empty.');
  if (ppg.length < FS * 2) throw new Error(`Signal too short (${ppg.length} pts).`);
  
  const sigStd = _std(ppg);
  if (sigStd < 1e-6) throw new Error('Signal flatline.');

  const minDistance = Math.max(10, Math.round(FS * 0.4));
  const peaks = findPeaks(ppg, minDistance);
  if (peaks.length < 2) throw new Error('Not enough peaks.');

  const smoothed = gaussianFilter1d(ppg, 1.2);
  const valleys = findValleys(ppg, minDistance);
  const rr = peaks.slice(1).map((peak, idx) => peak.index - peaks[idx].index);
  const rrSec = rr.map((value) => value / FS);
  const rrDiff = rr.slice(1).map((value, idx) => value - rr[idx]);
  
  const widths = peaks.map((peak) => {
    const halfHeight = ppg[peak.index] - peak.prominence * 0.5;
    let left = peak.index;
    while (left > 0 && ppg[left] > halfHeight) left--;
    let right = peak.index;
    while (right < ppg.length - 1 && ppg[right] > halfHeight) right++;
    return right - left;
  });
  const widthSec = widths.map((value) => value / FS);

  const rrMean = _mean(rrSec);
  const rrStd = _std(rrSec);
  const rrCv = rrMean ? rrStd / rrMean : Number.NaN;

  // Physiological range check: 0.4 s (150 bpm) – 1.5 s (40 bpm)
  if (!Number.isFinite(rrMean) || rrMean < 0.4 || rrMean > 1.5) {
    throw new Error('Heart rate out of physiological range (40–150 bpm) — likely noise or no finger.');
  }
  // Regularity check: highly irregular peaks indicate noise rather than a real heartbeat
  if (Number.isFinite(rrCv) && rrCv > 0.5) {
    throw new Error('Irregular beat intervals (CV > 0.5) — likely noise, not a valid PPG signal.');
  }

  const { freqs, psd } = getWelchPsd(ppg, FS);
  const vlfPower = bandPower(freqs, psd, 0.003, 0.04);
  const lfPower = bandPower(freqs, psd, 0.04, 0.15);
  const hfPower = bandPower(freqs, psd, 0.15, 0.4);

  const vpg = gradient(ppg);
  const apg = gradient(vpg);
  const apgExtrema = [...findPeaks(apg, 3), ...findValleys(apg, 3)]
    .sort((a, b) => a.index - b.index)
    .slice(0, 5)
    .map((item) => apg[item.index]);
  const a = apgExtrema[0] ?? 1;
  const b = apgExtrema[1] ?? 0;
  const c = apgExtrema[2] ?? 0;
  const d = apgExtrema[3] ?? 0;
  const e = apgExtrema[4] ?? 0;
  const ratioDen = Math.abs(a) > 1e-8 ? a : 1;

  const firstPeak = peaks[0]?.index ?? 1;
  const prevValley = valleys.find((v) => v.index < firstPeak)?.index ?? 0;
  const crestTime = (firstPeak - prevValley) / FS;

  const base: FeatureMap = {
    raw_mean: _mean(ppg),
    raw_std: sigStd,
    raw_median: _quantile(ppg, 0.5),
    raw_mad: _mean(ppg.map(v => Math.abs(v - _mean(ppg)))),
    raw_iqr: _quantile(ppg, 0.75) - _quantile(ppg, 0.25),
    raw_energy: _mean(ppg.map(v => v * v)),
    raw_area: trapz(ppg.map(Math.abs)),
    raw_pulse_area: peaks.length ? trapz(ppg.map(Math.abs)) / peaks.length : 0,
    raw_fwhm: _mean(widthSec),
    raw_skew: _skew(ppg),
    raw_kurtosis: _kurtosis(ppg),

    hrv_rr_mean: rrMean,
    hrv_rmssd: rrDiff.length ? Math.sqrt(_mean(rrDiff.map(v => (v/FS)**2))) : 0,
    hrv_sdnn: rrStd,
    hrv_pnn50: rrDiff.length ? rrDiff.filter(v => Math.abs(v/FS) > 0.05).length / rrDiff.length : 0,
    hrv_cv: rrCv,

    morph_mean: _mean(smoothed),
    morph_std: _std(smoothed),
    morph_median: _quantile(smoothed, 0.5),
    morph_mad: _mean(smoothed.map(v => Math.abs(v - _mean(smoothed)))),
    morph_iqr: _quantile(smoothed, 0.75) - _quantile(smoothed, 0.25),
    morph_energy: _mean(smoothed.map(v => v * v)),
    morph_area: trapz(smoothed.map(Math.abs)),
    morph_pulse_area: peaks.length ? trapz(smoothed.map(Math.abs)) / peaks.length : 0,
    morph_fwhm: _mean(widthSec),
    morph_skew: _skew(smoothed),
    morph_kurtosis: _kurtosis(smoothed),

    vpg_max: _max(vpg),
    vpg_min: _min(vpg),
    vpg_var: _std(vpg) ** 2,

    apg_max: _max(apg),
    apg_min: _min(apg),
    apg_var: _std(apg) ** 2,
    apg_b_a: ratioDen ? b / ratioDen : 0,
    apg_c_a: ratioDen ? c / ratioDen : 0,
    apg_d_a: ratioDen ? d / ratioDen : 0,
    apg_e_a: ratioDen ? e / ratioDen : 0,

    aging_index: ratioDen ? (b - c - d - e) / ratioDen : 0,
    stiffness_index: crestTime > 0 ? 1.7 / crestTime : 0,

    vlf: vlfPower,
    lf: lfPower,
    hf: hfPower,
    lf_hf: hfPower > 0 ? lfPower / hfPower : 0,
    vlf_hf: hfPower > 0 ? vlfPower / hfPower : 0,

    psd_mean: _mean(psd),
    spectral_entropy: spectralEntropy(psd),
    sample_entropy: sampleEntropy(ppg),
    approx_entropy: sampleEntropy(ppg),
    line_length: ppg.slice(1).reduce((sum, value, idx) => sum + Math.abs(value - ppg[idx]), 0),
  };

  return base;
}

export function extractFeatures(ppg: number[]) {
  return analyzeSignal(ppg).featureVector;
}

export function analyzeSignal(raw: number[], sourceRate = FS): ExtractedAnalysis {
  const preprocessed = preprocessPPG(raw, sourceRate);
  if (preprocessed.length <= FS * 2) {
    throw new Error('Signal too short after preprocessing. Record at least 12-15 seconds.');
  }
  const featureMap = buildFeatureMap(preprocessed);
  const featureVector = MODEL_FEATURES.map((name: string) => {
    let val = featureMap[name];
    if (val === undefined) {
      if (name.endsWith('_squared')) {
        val = (featureMap[name.replace('_squared', '')] ?? 0) ** 2;
      } else if (name.endsWith('_log')) {
        val = Math.log(Math.abs(featureMap[name.replace('_log', '')] ?? 0) + 1);
      } else {
        val = 0;
      }
    }
    return val;
  });

  // Use featureMap directly — MODEL_FEATURES is intentionally empty in the classical
  // pipeline so featureVector-based lookups always return NaN.
  const prs = calculatePRS(featureMap);
  return {
    featureMap,
    featureVector,
    prs,
    pulseBpm: getPulseBpm(featureMap),
  };
}

export function selectOptimalSignalWindow(
  raw: number[],
  sourceRate = FS,
  windowSeconds = 20,
  stepSeconds = 5,
): OptimalSignalWindow {
  if (!raw.length) {
    throw new Error('No recording found.');
  }

  const minSamples = Math.max(sourceRate * 12, sourceRate * 2 * (TRIM_SAMPLES / FS));
  if (raw.length < minSamples) {
    return {
      startIndex: 0,
      endIndex: raw.length,
      rawSignal: raw,
      analysis: analyzeSignal(raw, sourceRate),
    };
  }

  let bestWindow: OptimalSignalWindow | null = null;
  let lastError: Error | null = null;

  const windowSamples = Math.min(raw.length, Math.max(Math.floor(windowSeconds * sourceRate), minSamples));
  const stepSamples = Math.max(1, Math.floor(stepSeconds * sourceRate));

  const candidates: Array<{ start: number; end: number }> = [{ start: 0, end: raw.length }];
  if (raw.length > windowSamples) {
    for (let start = 0; start + windowSamples <= raw.length; start += stepSamples) {
      candidates.push({ start, end: start + windowSamples });
    }
    if (candidates[candidates.length - 1].end !== raw.length) {
      candidates.push({ start: raw.length - windowSamples, end: raw.length });
    }
  }

  for (const candidate of candidates) {
    try {
      const candidateRaw = raw.slice(candidate.start, candidate.end);
      const analysis = analyzeSignal(candidateRaw, sourceRate);
      if (!bestWindow || analysis.prs > bestWindow.analysis.prs) {
        bestWindow = {
          startIndex: candidate.start,
          endIndex: candidate.end,
          rawSignal: candidateRaw,
          analysis,
        };
      }
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (!bestWindow) {
    throw lastError ?? new Error('Optimal recording not found.');
  }

  return bestWindow;
}

export function buildModelInput(featureVector: number[], demographics: ModelInputDemographics) {
  const age = demographics.age;
  const height = demographics.height;
  const weight = demographics.weight;
  const bmi = weight / (((height || 1) / 100) ** 2);
  const bsa = 0.007184 * (weight ** 0.425) * (height ** 0.725);
  const lbm = (0.407 * weight) + (0.267 * height) - 19.2;

  const demoVals: Record<string, number> = {
    Age: age,
    Height: height,
    Weight: weight,
    BMI: bmi,
    Age_Sq: age * age,
    BMI_Sq: bmi * bmi,
    Age_BMI: age * bmi,
    Age_Weight: age * weight,
    Height_Weight: height * weight,
    BSA: bsa,
    LBM: lbm
  };

  return featureVector.map((val, idx) => {
    const name = MODEL_FEATURES[idx];
    if (demoVals[name] !== undefined) {
      return demoVals[name];
    }
    return val;
  });
}

export function performMathEstimation(featureVector: number[], age: number, height: number, weight: number) {
  const ri = Number.isFinite(getFeature(featureVector, 'reflection_index')) ? getFeature(featureVector, 'reflection_index') : 0.5;
  const aix = Number.isFinite(getFeature(featureVector, 'aix')) ? getFeature(featureVector, 'aix') : 0.2;
  const hr = Number.isFinite(getFeature(featureVector, 'hr')) ? getFeature(featureVector, 'hr') : 72;
  const stiffness = Number.isFinite(getFeature(featureVector, 'apg_energy')) ? getFeature(featureVector, 'apg_energy') : 0.1;

  const hMeters = Math.max(height / 100, 0.5);
  const bmi = weight / (hMeters * hMeters);
  const normAge = Math.max(0, age - 30);
  const normBmi = Math.max(0, bmi - 25);
  const normHr = Math.max(0, hr - 70);
  const normAix = Math.max(0, aix);

  let sbp = 108 + 0.45 * normAge + 0.55 * normBmi + 0.2 * normHr + 8 * ri + 4 * normAix;
  let dbp = 68 + 0.22 * normAge + 0.3 * normBmi + 0.15 * normHr + 3 * ri + 2 * normAix;
  let glucose = 88 + 1.0 * normBmi + 0.2 * normAge + 8 * Math.min(stiffness, 5);

  sbp = Math.min(Math.max(sbp, 95), 165);
  dbp = Math.min(Math.max(dbp, 60), 105);
  glucose = Math.min(Math.max(glucose, 70), 220);

  return {
    sbp: Math.round(sbp),
    dbp: Math.round(dbp),
    glucose: Math.round(glucose),
  };
}

export function applyFilterToArray(data: number[], sourceRate = FS) {
  return preprocessPPG(data, sourceRate);
}

export function calculateSignalStats(data: number[]) {
  if (!data.length) return { mean: 0, std: 0, min: 0, max: 0 };
  return {
    mean: _mean(data),
    std: _std(data),
    min: _min(data),
    max: _max(data),
  };
}

export function generateMIMICCSV(session: RecordingSession, startTime: number, endTime: number) {
  const rows = [['Timestamp', 'PPG']];
  const data = session.rawSignal.filter((sample) => sample.timestamp >= startTime && sample.timestamp <= endTime);
  data.forEach((sample) => rows.push([new Date(sample.timestamp).toISOString(), sample.value.toString()]));
  return rows.map((row) => row.join(',')).join('\n');
}

export class SignalStorage {
  async saveSession(session: RecordingSession) {
    const sessions = await this.getSessions();
    const nextSessions = [...sessions, session].slice(-50);

    for (let startIndex = 0; startIndex < nextSessions.length; startIndex++) {
      const candidate = nextSessions.slice(startIndex);
      if (writeJsonStorage('ppg_sessions', candidate)) {
        return;
      }
    }

    throw new Error('Unable to persist this recording locally because device storage is full.');
  }

  async getSessions(): Promise<RecordingSession[]> {
    if (typeof window === 'undefined') return [];

    try {
      const parsed = readJsonStorage<any[]>('ppg_sessions', []);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((session: any) => ({
        ...session,
        createdAt: new Date(session.createdAt),
      })).filter((session) => session.id && Array.isArray(session.rawSignal));
    } catch (error) {
      console.error('Failed to parse sessions', error);
      return [];
    }
  }

  async deleteSession(id: string) {
    const sessions = await this.getSessions();
    writeJsonStorage('ppg_sessions', sessions.filter((session) => session.id !== id));
  }

  async clearAll() {
    removeStorage('ppg_sessions');
  }

  async generateNextId(): Promise<string> {
    const sessions = await this.getSessions();
    const ids = sessions
      .map((session) => parseInt(session.id, 10))
      .filter((value) => !Number.isNaN(value) && value < 1000000);

    if (!ids.length) return '000001';
    return String(Math.max(...ids) + 1).padStart(6, '0');
  }
}
