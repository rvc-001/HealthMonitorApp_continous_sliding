import * as ort from 'onnxruntime-web';

let config: any = null;
let sbpSession: ort.InferenceSession | null = null;
let dbpSession: ort.InferenceSession | null = null;
let glucoseSession: ort.InferenceSession | null = null;

type TargetName = 'sbp' | 'dbp' | 'glucose';

interface InferenceState {
  lastRawPrediction: number | null;
  lastPrediction: number | null;
  lastFinalFeatures: Float32Array | null;
  lastDebug: InferenceDebug | null;
}

export interface InferenceDebug {
  target: TargetName;
  rawPrediction: number;
  displayedPrediction: number;
  usedFallback: boolean;
  fallbackPrediction?: number;
  previousDisplayedPrediction?: number;
  smoothingAlpha?: number;
  inputDelta: number;
  rawDelta: number;
  topInputs: Array<{ name: string; value: number }>;
}

const inferenceState: Record<TargetName, InferenceState> = {
  sbp: { lastRawPrediction: null, lastPrediction: null, lastFinalFeatures: null, lastDebug: null },
  dbp: { lastRawPrediction: null, lastPrediction: null, lastFinalFeatures: null, lastDebug: null },
  glucose: { lastRawPrediction: null, lastPrediction: null, lastFinalFeatures: null, lastDebug: null },
};

function configureOrt() {
  if (typeof window === 'undefined') return;
  ort.env.logLevel = 'error';
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: '/ort-wasm-simd-threaded.mjs',
    wasm: '/ort-wasm-simd-threaded.wasm',
  };
}

async function loadConfig() {
  if (!config) {
    const res = await fetch('/models/production_config.json');
    if (!res.ok) throw new Error('Failed to load production_config.json');
    config = await res.json();
  }
  return config;
}

async function loadSessionWithExternalData(basePath: string): Promise<ort.InferenceSession> {
  const modelResp = await fetch(`${basePath}.onnx`);
  if (!modelResp.ok) throw new Error(`Failed to fetch ${basePath}.onnx`);
  const modelData = await modelResp.arrayBuffer();

  const dataResp = await fetch(`${basePath}.onnx.data`);
  if (!dataResp.ok) throw new Error(`Failed to fetch ${basePath}.onnx.data`);
  const weightData = await dataResp.arrayBuffer();
  
  const filename = basePath.split('/').pop() + '.onnx.data';

  return await ort.InferenceSession.create(modelData, {
    executionProviders: ['wasm'],
    externalData: [
      {
        data: new Uint8Array(weightData),
        path: filename
      }
    ]
  });
}

async function getSession(target: 'sbp' | 'dbp' | 'glucose'): Promise<ort.InferenceSession> {
  configureOrt();
  if (target === 'sbp') {
    if (!sbpSession) sbpSession = await loadSessionWithExternalData('/models/sbp_model');
    return sbpSession;
  } else if (target === 'dbp') {
    if (!dbpSession) dbpSession = await loadSessionWithExternalData('/models/dbp_model');
    return dbpSession;
  } else if (target === 'glucose') {
    if (!glucoseSession) glucoseSession = await loadSessionWithExternalData('/models/glucose_model');
    return glucoseSession;
  }
  throw new Error('Unknown target');
}

function meanAbsoluteDiff(a: Float32Array, b: Float32Array) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / len;
}

function getSmoothingAlpha(target: TargetName) {
  if (target === 'dbp') return 0.20;
  if (target === 'glucose') return 0.12;
  return 1;
}

function getTopInputs(
  finalFeatures: Float32Array,
  selectedFeatures: Array<{ formula?: string; type?: string; idx?: number; idx1?: number; idx2?: number }>,
  limit = 3,
) {
  return Array.from(finalFeatures)
    .map((value, idx) => ({
      name: selectedFeatures[idx]?.formula ?? selectedFeatures[idx]?.type ?? `f${idx}`,
      value,
      absValue: Math.abs(value),
    }))
    .sort((a, b) => b.absValue - a.absValue)
    .slice(0, limit)
    .map(({ name, value }) => ({ name, value }));
}

export async function preloadClassicalModels() {
  await loadConfig();
  await Promise.all([
    getSession('sbp'),
    getSession('dbp'),
    getSession('glucose')
  ]);
}

export function getLastInferenceDebug(target: TargetName): InferenceDebug | null {
  return inferenceState[target].lastDebug;
}

/**
 * Run inference using the classical ONNX models.
 * @param target The target model to run ('sbp', 'dbp', or 'glucose')
 * @param raw_feature Array of exactly 72 base features
 * @returns The final prediction value
 */
export async function runClassicalInference(target: TargetName, raw_feature: number[] | Float32Array): Promise<number> {
  if (raw_feature.length !== 72) {
    throw new Error(`Expected exactly 72 base features, got ${raw_feature.length}`);
  }

  const conf = await loadConfig();
  const targetConf = conf.targets[target];
  if (!targetConf) throw new Error(`Target ${target} not found in config`);

  // Any missing feature MUST be imputed with the training mean (so standard scaler outputs 0.0 for it)
  const s1_mean = targetConf.scaler1.mean;
  const clean_raw_feature = new Float32Array(72);
  for (let i = 0; i < 72; i++) {
    clean_raw_feature[i] = Number.isFinite(raw_feature[i]) ? raw_feature[i] : s1_mean[i];
  }

  // Step 3.1: Apply Scaler 1
  const s1_scale = targetConf.scaler1.scale;
  const standardized_base = new Float32Array(72);
  for (let i = 0; i < 72; i++) {
    standardized_base[i] = (clean_raw_feature[i] - s1_mean[i]) / s1_scale[i];
  }

  // Step 3.2: Construct Polynomial Features
  const parsed_features = targetConf.selected_features;
  const polynomial_features = new Float32Array(15);
  parsed_features.forEach((feat: any, i: number) => {
    if (feat.type === 'single') {
      polynomial_features[i] = standardized_base[feat.idx];
    } else if (feat.type === 'squared') {
      polynomial_features[i] = standardized_base[feat.idx] ** 2;
    } else if (feat.type === 'interaction') {
      polynomial_features[i] = standardized_base[feat.idx1] * standardized_base[feat.idx2];
    }
  });

  // Step 3.3: Apply Scaler 2
  const scaler2_mean = targetConf.scaler2.mean;
  const scaler2_scale = targetConf.scaler2.scale;
  const final_features = new Float32Array(15);
  for (let i = 0; i < 15; i++) {
    final_features[i] = (polynomial_features[i] - scaler2_mean[i]) / scaler2_scale[i];
  }

  // Step 4: ONNX Execution Spec
  const session = await getSession(target);
  
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', final_features, [1, 15]);
  
  // Run inference
  const results = await session.run({ [inputName]: tensor });
  
  // Extract target
  const keyMap: Record<string, string> = {
    sbp: 'sbp_mmhg',
    dbp: 'dbp_mmhg',
    glucose: 'glucose_mgdl'
  };
  
  // If the hardcoded key is not found, fallback to the first output name dynamically
  const outKey = results[keyMap[target]] ? keyMap[target] : session.outputNames[0];
  const outputTensor = results[outKey];
  
  if (!outputTensor || !outputTensor.data) {
    throw new Error(`Output tensor ${outKey} not found in model results. Available keys: ${Object.keys(results).join(', ')}`);
  }
  
  const rawPrediction = Number(outputTensor.data[0]);

  // ONNX model already has y_scale and y_mean baked in via ExportWrapper in Python,
  // so rawPrediction is already the final un-scaled physiological value.
  let prediction = rawPrediction;

  // Apply clipping bounds to avoid physiologically impossible outputs
  if (target === 'sbp') {
    prediction = Math.max(80, Math.min(190, prediction));
  } else if (target === 'dbp') {
    prediction = Math.max(40, Math.min(130, prediction));
  } else if (target === 'glucose') {
    prediction = Math.max(40, Math.min(300, prediction));
  }

  {
    const selectedFeatureLabels2 = Array.isArray(targetConf.selected_features)
      ? targetConf.selected_features
      : [];
    const state2 = inferenceState[target];
    const inputDelta2 = state2.lastFinalFeatures ? meanAbsoluteDiff(final_features, state2.lastFinalFeatures) : Number.POSITIVE_INFINITY;
    const rawDelta2 = state2.lastRawPrediction === null ? Number.POSITIVE_INFINITY : Math.abs(rawPrediction - state2.lastRawPrediction);
    const isCollapsed2 = state2.lastRawPrediction !== null && state2.lastFinalFeatures !== null && inputDelta2 > 0.15 && rawDelta2 < 0.05;
    // A hand-written estimate is not a valid substitute for a trained model.
    // Keep the model result and surface the collapse as a diagnostic instead.
    const usedFallback2 = false;
    const topInputs2 = getTopInputs(final_features, selectedFeatureLabels2, 3);
    const fallbackPrediction2 = undefined;

    if (isCollapsed2) {
      console.warn(
        `[PIPELINE ${target}] Prediction collapsed across changing inputs ` +
        `(inputΔ=${inputDelta2.toFixed(3)}, rawΔ=${rawDelta2.toFixed(3)}). ` +
        `Keeping ONNX model output=${prediction.toFixed(2)}; inspect model sensitivity and feature scaling.`
      );
    }

    const previousDisplayed2 = state2.lastPrediction;
    const smoothingAlpha2 = getSmoothingAlpha(target);
    if (previousDisplayed2 !== null && smoothingAlpha2 < 1) {
      prediction = previousDisplayed2 + smoothingAlpha2 * (prediction - previousDisplayed2);
    }

    state2.lastRawPrediction = rawPrediction;
    state2.lastPrediction = prediction;
    state2.lastFinalFeatures = new Float32Array(final_features);
    state2.lastDebug = {
      target,
      rawPrediction,
      displayedPrediction: prediction,
      usedFallback: usedFallback2,
      fallbackPrediction: fallbackPrediction2,
      previousDisplayedPrediction: previousDisplayed2 ?? undefined,
      smoothingAlpha: smoothingAlpha2 < 1 ? smoothingAlpha2 : undefined,
      inputDelta: inputDelta2,
      rawDelta: rawDelta2,
      topInputs: topInputs2,
    };

    console.log(`[PIPELINE ${target}] 1. Input Base (72):`, Array.from(clean_raw_feature.slice(0, 5)).map(v => v.toFixed(3)) + '...');
    console.log(`[PIPELINE ${target}] 2. Standardized (72):`, Array.from(standardized_base.slice(0, 5)).map(v => v.toFixed(3)) + '...');
    console.log(`[PIPELINE ${target}] 3. Polynomial (15):`, Array.from(polynomial_features).map(v => v.toFixed(3)));
    console.log(`[PIPELINE ${target}] 4. Final ONNX Input (15):`, Array.from(final_features).map(v => v.toFixed(3)));
    console.log(`[PIPELINE ${target}] 5. Raw Prediction: ${rawPrediction.toFixed(4)}, Final Scaled: ${prediction.toFixed(2)}`);
    console.log(`[PIPELINE ${target}] debug snapshot:`, state2.lastDebug);
    
    return prediction;
  }
}
