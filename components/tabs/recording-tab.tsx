'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { RPPGAcquisition } from '@/lib/camera-utils'; 
import { FS, preprocessPreviewPPG } from '@/lib/signal-processing';
import { readJsonStorage, writeJsonStorage } from '@/lib/browser-storage';
import { PPGRecordSession, PPGSegment } from '@/types/ppg-data';
import SignalVisualizer from '@/components/visualization/signal-visualizer';
import BpLiveMonitor, { BpSegmentResult } from '@/components/visualization/bp-live-monitor';
import { extractSegmentFeatures } from '@/lib/bp-feature-extraction';
import { runClassicalInference, preloadClassicalModels, getLastInferenceDebug } from '@/lib/classical-models-pipeline';
import { Pause, Play, Zap, ZapOff, Timer, User, X, Activity, Loader2, CheckCircle, ShieldAlert, RefreshCcw, Camera } from 'lucide-react';

const SAMPLE_RATE = FS;
const UI_UPDATE_INTERVAL_MS = 200;
const MAX_RECORDING_SECONDS = 3600; // Allow 1-hour recordings for continuous mode
/** Segment duration in ms for continuous BP mode */
const BP_SEGMENT_MS = 12000; // 12 seconds of real wall-clock time
const SLIDE_INTERVAL_MS = 3000; // Slide window every 3 seconds (overlapping estimation)
const MAX_RECORDING_SAMPLES = SAMPLE_RATE * MAX_RECORDING_SECONDS;

export default function RecordingTab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingActiveRef = useRef<boolean>(false);
  const torchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [visRaw, setVisRaw] = useState<number[]>([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isTorchAvailable, setIsTorchAvailable] = useState(false);
  const [isTorchBusy, setIsTorchBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  
  const [showUserForm, setShowUserForm] = useState(false);
  const [userDetails, setUserDetails] = useState({ name: '', age: '30', height: '170', weight: '70' });
  const [currentSubjectId, setCurrentSubjectId] = useState('sub001');
  const [showPostRecordForm, setShowPostRecordForm] = useState(false);
  const [actualValues, setActualValues] = useState({ sbp: '', dbp: '', glucose: '' });

  // ── Continuous BP mode ───────────────────────────────────────────────────
  const [bpResults, setBpResults] = useState<BpSegmentResult[]>([]);
  const [isBpAnalyzing, setIsBpAnalyzing] = useState(false);
  const [bpSegmentProgress, setBpSegmentProgress] = useState(0);
  const [bpCurrentSegment, setBpCurrentSegment] = useState(0);
  const bpSegmentCountRef = useRef(0); // how many segments have been processed
  const bpAnalyzingRef = useRef(false); // guard against concurrent segment runs

  const recordedSamplesRef = useRef<{ timestamp: number; value: number }[]>([]);
  const rpPgRef = useRef<any | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const recordingDurationRef = useRef(0);
  const visualBufferRef = useRef<number[]>([]);
  const lastUiUpdateRef = useRef(0);
  const cameraInitTokenRef = useRef(0);
  const bpSegmentWindowStartRef = useRef<number | null>(null);
  
  // Wall-clock timestamp when the LAST analysis was triggered
  const lastAnalysisMsRef = useRef<number | null>(null);
  const warmUpStartRef = useRef<number | null>(null);

  const formattedRecordingTime = recordingTime.toFixed(1).padStart(4, '0');
  useEffect(() => {
    const cleanupTokenRef = cameraInitTokenRef;
    const savedDetails = readJsonStorage('ppg_user_details', null as typeof userDetails | null);
    if (savedDetails) {
      setUserDetails({
        name: savedDetails.name ?? '',
        age: savedDetails.age ?? '30',
        height: savedDetails.height ?? '170',
        weight: savedDetails.weight ?? '70',
      });
    }

    initCamera();
    // Pre-warm BP ONNX sessions in background so they are ready for first segment
    preloadClassicalModels();
    return () => {
      cleanupTokenRef.current++;
      stopCamera();
    };
  }, []);

  const initCamera = async () => {
    const myToken = ++cameraInitTokenRef.current;
    try {
      setIsCameraStarting(true);
      setCameraError(null);
      setStatusMsg("Starting…");
      rpPgRef.current = new RPPGAcquisition(SAMPLE_RATE);
      const stream = await rpPgRef.current.requestCameraPermission();
      if (cameraInitTokenRef.current !== myToken) {
        // A newer init started (or we unmounted) while awaiting permission.
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        return;
      }
      if (videoRef.current) {
        const v = videoRef.current;
        // Reset element state in case a previous init was interrupted.
        v.pause();
        v.srcObject = null;
        v.srcObject = stream;

        // Wait for metadata before playing; avoids sporadic AbortError races.
        await new Promise<void>((resolve) => {
          const onMeta = () => {
            v.removeEventListener('loadedmetadata', onMeta);
            resolve();
          };
          v.addEventListener('loadedmetadata', onMeta, { once: true });
          // If metadata is already there, resolve immediately.
          if (v.readyState >= 1) {
            v.removeEventListener('loadedmetadata', onMeta);
            resolve();
          }
        });

        if (cameraInitTokenRef.current !== myToken) return;

        try {
          await v.play();
        } catch (e: any) {
          // AbortError is common when the UA cancels play during rapid re-inits; ignore it.
          if (e?.name !== 'AbortError') {
            console.error("Play error", e);
          }
        }
        if (torchTimeoutRef.current) clearTimeout(torchTimeoutRef.current);
        torchTimeoutRef.current = setTimeout(() => {
          const torchState = rpPgRef.current?.getTorchState();
          setIsTorchAvailable(Boolean(torchState?.supported));
          setIsTorchOn(Boolean(torchState?.enabled));
        }, 800);
      }
    } catch (e) {
      console.error("Camera init failed", e);
      setStatusMsg("Camera Error");
      const errName = (e as any)?.name as string | undefined;
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setCameraError("Camera permission was denied. Please allow camera access and try again.");
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setCameraError("No camera was detected on this device.");
      } else {
        setCameraError("The camera could not be started. Please retry.");
      }
    } finally {
      setIsCameraStarting(false);
    }
  };

  const stopCamera = () => {
    isRecordingActiveRef.current = false;
    if (recordingIntervalRef.current) {
      clearTimeout(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (torchTimeoutRef.current) {
      clearTimeout(torchTimeoutRef.current);
      torchTimeoutRef.current = null;
    }
    rpPgRef.current?.stop();
    setIsTorchOn(false);
    setIsTorchAvailable(false);
    setIsTorchBusy(false);
  };

  const handleStartClick = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return alert("Wait for camera to load...");
    const torch = rpPgRef.current?.getTorchState();
    if (torch && torch.supported && !torch.enabled) {
      return alert("Flash isn't on — cover the camera and flash fully with your finger, then retry.");
    }
    
    const stored = localStorage.getItem('ppg_recorded_sessions');
    let nextSub = 'sub001';
    if (stored) {
      try {
        const sessions = JSON.parse(stored);
        let maxNum = 0;
        sessions.forEach((s: any) => {
          const m = s.patientId?.match(/sub(\d+)/i);
          if (m && m[1]) {
            const num = parseInt(m[1], 10);
            if (num > maxNum) maxNum = num;
          }
        });
        if (maxNum > 0) nextSub = `sub${String(maxNum + 1).padStart(3, '0')}`;
      } catch(e) {}
    }
    setCurrentSubjectId(nextSub);
    setShowUserForm(true);
  };

  const startRecording = () => {
    writeJsonStorage('ppg_user_details', userDetails);

    setShowUserForm(false);
    if (recordingIntervalRef.current) {
      clearTimeout(recordingIntervalRef.current);
    }
    // Reset continuous BP state
    setBpResults([]);
    setIsBpAnalyzing(false);
    setBpSegmentProgress(0);
    setBpCurrentSegment(0);
    bpSegmentCountRef.current = 0;
    lastAnalysisMsRef.current = null;
    bpAnalyzingRef.current = false;
    bpSegmentWindowStartRef.current = null;
    recordedSamplesRef.current = [];
    visualBufferRef.current = [];
    recordingStartRef.current = null;
    warmUpStartRef.current = Date.now();
    recordingDurationRef.current = 0;
    lastUiUpdateRef.current = 0;
    setRecordingTime(0);
    setVisRaw([]);
    setIsRecording(true);
    setStatusMsg("Rest correctly, recording not started...");
    
    isRecordingActiveRef.current = true;
    
    const frameLoop = () => {
      if (!isRecordingActiveRef.current) return;
      if (!rpPgRef.current || !videoRef.current) return;
      
      const val = rpPgRef.current.extractSignal(videoRef.current);
      if (val !== null) {
        const now = Date.now();

        // ── WARM-UP PHASE ──
        if (warmUpStartRef.current && (now - warmUpStartRef.current < 5000)) {
          const remaining = Math.ceil(5 - (now - warmUpStartRef.current) / 1000);
          setStatusMsg(`Rest correctly, recording not started... ${remaining}s`);
          
          if (now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
            lastUiUpdateRef.current = now;
          }
          
          if ('requestVideoFrameCallback' in videoRef.current) {
            (videoRef.current as any).requestVideoFrameCallback(frameLoop);
          } else {
            recordingIntervalRef.current = setTimeout(frameLoop, 1000 / SAMPLE_RATE) as any;
          }
          return;
        }


        if (recordedSamplesRef.current.length < MAX_RECORDING_SAMPLES) {
          const quality = rpPgRef.current.getSignalQuality(val);

          if (quality === 'saturated') {
            setStatusMsg("Too much pressure / overexposed");
          } else if (quality === 'no_contact') {
            setStatusMsg("No finger detected / flash off");
          } else {
            // quality === 'ok' — only valid samples enter the buffer
            // Anchor the recording clock on the first good-quality frame
            if (recordingStartRef.current === null) {
              recordingStartRef.current = now;
              bpSegmentWindowStartRef.current = now;
            }
            setStatusMsg("Recording...");

            recordedSamplesRef.current.push({ timestamp: now, value: val });
            visualBufferRef.current.push(val);
            if (visualBufferRef.current.length > 300) {
              visualBufferRef.current = visualBufferRef.current.slice(-300);
            }

            const startTime = recordingStartRef.current;
            // Use real wall-clock elapsed time — do NOT cap by sample count
            // since actual fps (≈10) differs from SAMPLE_RATE (25)
            const durationSeconds = Math.min(
              (now - startTime) / 1000,
              MAX_RECORDING_SECONDS,
            );
            recordingDurationRef.current = durationSeconds;

            if (now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
              lastUiUpdateRef.current = now;
              setVisRaw([...visualBufferRef.current]);
              setRecordingTime(durationSeconds);

              // ── Continuous BP segment trigger (SLIDING WINDOW) ────────────
              if (bpSegmentWindowStartRef.current === null) {
                bpSegmentWindowStartRef.current = now;
              }

              const segmentWindowStart = bpSegmentWindowStartRef.current;
              const elapsedSinceSegmentStart = now - segmentWindowStart;
              const elapsedSinceLastAnalysis = lastAnalysisMsRef.current ? now - lastAnalysisMsRef.current : Infinity;
              
              let progress = 0;
              if (bpSegmentCountRef.current === 0) {
                progress = Math.min(1, elapsedSinceSegmentStart / BP_SEGMENT_MS);
              } else {
                progress = Math.min(1, elapsedSinceLastAnalysis / SLIDE_INTERVAL_MS);
              }
              setBpSegmentProgress(progress);
              setBpCurrentSegment(bpSegmentCountRef.current);

              // Trigger once 12 s of valid-quality data is collected AND
              // SLIDE_INTERVAL_MS has elapsed since the previous analysis window.
              if (elapsedSinceSegmentStart >= BP_SEGMENT_MS &&
                  elapsedSinceLastAnalysis >= SLIDE_INTERVAL_MS &&
                  !bpAnalyzingRef.current) {

                bpAnalyzingRef.current = true;
                const segIdx = bpSegmentCountRef.current;
                bpSegmentCountRef.current++;

                const segEndMs = now;
                const segStartMs = now - BP_SEGMENT_MS;
                lastAnalysisMsRef.current = now;

                // Only valid-quality samples were pushed, so every sample here
                // comes from a properly covered camera+torch frame.
                const segSamplesRaw = recordedSamplesRef.current.filter(
                  s => s.timestamp >= segStartMs && s.timestamp <= segEndMs
                );

                if (segSamplesRaw.length < 10) {
                  console.warn(`[BP-SEG ${segIdx}] Too few valid samples in window (${segSamplesRaw.length}). Skipping.`);
                  bpAnalyzingRef.current = false;
                } else {
                  // Compute ACTUAL FPS from timestamps (fixes wrong-rate resampling)
                  const spanMs = segSamplesRaw[segSamplesRaw.length - 1].timestamp - segSamplesRaw[0].timestamp;
                  const actualFps = spanMs > 0 ? (segSamplesRaw.length - 1) / (spanMs / 1000) : SAMPLE_RATE;
                  const segSamples = segSamplesRaw.map(s => s.value);

                  console.log(`[BP-SEG ${segIdx}] Window: ${segSamplesRaw.length} valid samples over ${(spanMs/1000).toFixed(2)}s → actualFps=${actualFps.toFixed(1)}`);

                  setIsBpAnalyzing(true);
                  void (async () => {
                    try {
                      // Demographics zeroed: ONNX models use 72 PPG-only features
                      const { sbpFeatures, pulseBpm } = extractSegmentFeatures(
                        segSamples, actualFps, { age: 0, sex: 0, weight: 0, height: 0 }, segIdx
                      );

                      const t0 = Date.now();
                      // ── Fix Issues 8 & 9: correct feature mapping ─────────────────
                      // extractSegmentFeatures returns SBP_FEATURE_NAMES[0..79] (80 values):
                      //   [0..67]  = ppg_mean … quantum_bloch_x_expval  (match config exactly)
                      //   [68..71] = dpg_max, dpg_min, dpg_std, dpg_mean  (NOT in config → skip)
                      //   [72..75] = jpg_max, jpg_min, jpg_std, jpg_mean  (order differs from config)
                      //   [76..79] = demo_age, demo_sex, demo_weight, demo_height  (NOT in config → skip)
                      //
                      // production_config.json expects 72 features ending with:
                      //   [68] = jpg_max, [69] = jpg_min, [70] = jpg_mean, [71] = jpg_std
                      const base72 = new Float32Array(72);
                      base72.set(sbpFeatures.slice(0, 68));   // [0..67]: identical to config
                      base72[68] = sbpFeatures[72];            // config[68]=jpg_max  → SBP[72]
                      base72[69] = sbpFeatures[73];            // config[69]=jpg_min  → SBP[73]
                      base72[70] = sbpFeatures[75];            // config[70]=jpg_mean → SBP[75]
                      base72[71] = sbpFeatures[74];            // config[71]=jpg_std  → SBP[74]

                      // Run ONNX models sequentially to prevent WASM memory corruption
                      const sbp = await runClassicalInference('sbp', base72);
                      const dbp = await runClassicalInference('dbp', base72);
                      const glucose = await runClassicalInference('glucose', base72);
                      const debug = {
                        sbp: getLastInferenceDebug('sbp'),
                        dbp: getLastInferenceDebug('dbp'),
                        glucose: getLastInferenceDebug('glucose'),
                      };

                      console.groupCollapsed(`[BP-DEBUG seg${segIdx}]`);
                      console.log('segment', {
                        segmentIndex: segIdx,
                        actualFps: Number(actualFps.toFixed(2)),
                        pulseBpm: Number(pulseBpm.toFixed(1)),
                        sbp,
                        dbp,
                        glucose,
                        map: (sbp + 2 * dbp) / 3,
                        elapsedMs: Date.now() - t0,
                      });
                      console.log('sbp', debug.sbp);
                      console.log('dbp', debug.dbp);
                      console.log('glucose', debug.glucose);
                      console.log('debug bundle', debug);
                      console.groupEnd();

                      const map = (sbp + 2 * dbp) / 3;
                      const elapsedMs = Date.now() - t0;

                      const result: BpSegmentResult = {
                        segmentIndex: segIdx,
                        timestamp: Date.now(),
                        sbp: Number(sbp.toFixed(1)),
                        dbp: Number(dbp.toFixed(1)),
                        map: Number(map.toFixed(1)),
                        glucose: Number(glucose.toFixed(1)),
                        pulseBpm,
                        elapsedMs,
                        debug,
                      };
                      console.log('segment result', result);
                      setBpResults(prev => [...prev, result]);
                    } catch (err) {
                      console.warn('BP segment inference error:', err);
                    } finally {
                      setIsBpAnalyzing(false);
                      bpAnalyzingRef.current = false;
                    }
                  })();
                }
              }
            }

            if (durationSeconds >= MAX_RECORDING_SECONDS) {
              setStatusMsg("Max duration reached.");
              isRecordingActiveRef.current = false;
              if (recordingIntervalRef.current) {
                clearTimeout(recordingIntervalRef.current);
                recordingIntervalRef.current = null;
              }
              setIsRecording(false);
              setStatusMsg("Done — tap Play to start a new session");
              setShowPostRecordForm(true);
              return;
            }
          }
        }
      }

      if ('requestVideoFrameCallback' in videoRef.current) {
        (videoRef.current as any).requestVideoFrameCallback(frameLoop);
      } else {
        recordingIntervalRef.current = setTimeout(frameLoop, 1000 / SAMPLE_RATE) as any;
      }
    };

    if (videoRef.current && 'requestVideoFrameCallback' in videoRef.current) {
      (videoRef.current as any).requestVideoFrameCallback(frameLoop);
    } else {
      recordingIntervalRef.current = setTimeout(frameLoop, 1000 / SAMPLE_RATE) as any;
    } 
  };

  const handleSaveSession = () => {
    const sbp = actualValues.sbp ? Number(actualValues.sbp) : undefined;
    const dbp = actualValues.dbp ? Number(actualValues.dbp) : undefined;
    const glucose = actualValues.glucose ? Number(actualValues.glucose) : undefined;

    const segments: PPGSegment[] = bpResults.map((res) => {
      const endMs = res.timestamp;
      const startMs = res.timestamp - 12000;
      const recStart = recordingStartRef.current || startMs;

      const segSamples = recordedSamplesRef.current.filter(
        s => s.timestamp >= startMs && s.timestamp <= endMs
      );

      return {
        segmentIndex: res.segmentIndex,
        startTimeSec: Math.max(0, (startMs - recStart) / 1000),
        endTimeSec: Math.max(0, (endMs - recStart) / 1000),
        estimatedSBP: res.sbp,
        estimatedDBP: res.dbp,
        estimatedMAP: res.map,
        estimatedGlucose: res.glucose,
        heartRateBpm: res.pulseBpm,
        ppgRawSignal: segSamples.map(s => s.value),
        timeStamps: segSamples.map(s => s.timestamp - recStart)
      };
    });

    const newSession: PPGRecordSession = {
      sessionId: `REC-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`,
      patientId: currentSubjectId,
      samplingRateHz: SAMPLE_RATE,
      recordingDate: new Date().toLocaleString(),
      totalDurationSec: recordingDurationRef.current,
      actualSBP: sbp,
      actualDBP: dbp,
      actualGlucose: glucose,
      segments
    };

    const stored = localStorage.getItem('ppg_recorded_sessions');
    let sessions = [];
    if (stored) {
      try { sessions = JSON.parse(stored); } catch(e){}
    }
    sessions.push(newSession);
    localStorage.setItem('ppg_recorded_sessions', JSON.stringify(sessions));

    setShowPostRecordForm(false);
    setActualValues({ sbp: '', dbp: '', glucose: '' });
  };

  return (
    <div className="space-y-4 p-4 pb-24 relative">

      
      {showUserForm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-sm rounded-xl border shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold flex items-center gap-2"><User className="w-5 h-5"/> Patient Details</h2>
                    <button onClick={()=>setShowUserForm(false)}><X className="w-5 h-5"/></button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium">Subject ID (Auto-Assigned)</label>
                        <input type="text" disabled className="w-full bg-muted border rounded p-2 opacity-70" value={currentSubjectId} />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Name (Optional)</label>
                        <input type="text" className="w-full bg-background border rounded p-2" value={userDetails.name} onChange={e => setUserDetails({...userDetails, name: e.target.value})} placeholder="Optional Name"/>
                    </div>
                </div>
                <button onClick={startRecording} className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-bold text-lg shadow hover:opacity-90">Confirm & Start</button>
            </div>
        </div>
      )}

      {/* Video Preview */}
      <div className="relative h-48 bg-black rounded-lg overflow-hidden shadow-md">
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
        {(statusMsg === "Camera Error" || cameraError) && (
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/95 via-slate-950/75 to-slate-900/95" />
            <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(50%_50%_at_50%_50%,rgba(16,185,129,0.25),transparent_65%),radial-gradient(60%_60%_at_20%_20%,rgba(59,130,246,0.18),transparent_60%)]" />
            <div className="relative h-full w-full p-4 flex items-center">
              <div className="w-full">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-10 w-10 rounded-xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
                    <ShieldAlert className="h-5 w-5 text-amber-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold leading-tight">Camera needs access</p>
                    <p className="text-white/70 text-xs mt-1 leading-relaxed">
                      {cameraError ?? "We couldn’t start the camera. Grant permission and retry."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={initCamera}
                        disabled={isCameraStarting}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-slate-950 px-3 py-2 text-xs font-bold shadow-sm disabled:opacity-60"
                      >
                        {isCameraStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                        Retry Camera
                      </button>
                      <button
                        onClick={() => {
                          // Keep UX simple: just attempt again (this will trigger the platform prompt if available).
                          initCamera();
                        }}
                        disabled={isCameraStarting}
                        className="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 ring-1 ring-white/15 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60"
                      >
                        <Camera className="h-4 w-4" />
                        Request Permission
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">Tip</p>
                        <p className="text-[11px] text-white/80 mt-0.5 leading-snug">Use rear camera</p>
                      </div>
                      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">Tip</p>
                        <p className="text-[11px] text-white/80 mt-0.5 leading-snug">Enable torch</p>
                      </div>
                      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-white/70">Tip</p>
                        <p className="text-[11px] text-white/80 mt-0.5 leading-snug">Hold still</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-2">
            <button
              onClick={async () => {
                if (!rpPgRef.current || !isTorchAvailable || isTorchBusy) {
                  return;
                }

                setIsTorchBusy(true);
                try {
                  const nextTorchState = !isTorchOn;
                  const enabled = await rpPgRef.current.toggleTorch(nextTorchState);
                  const torchState = rpPgRef.current.getTorchState();
                  setIsTorchAvailable(Boolean(torchState.supported));
                  setIsTorchOn(Boolean(enabled) && nextTorchState && torchState.supported ? Boolean(torchState.enabled || enabled) : Boolean(torchState.enabled));
                } finally {
                  setIsTorchBusy(false);
                }
              }}
              disabled={!isTorchAvailable || isTorchBusy}
              className={`p-2 backdrop-blur rounded-full transition-opacity ${
                isTorchAvailable ? 'bg-black/40' : 'bg-black/20 opacity-50 cursor-not-allowed'
              }`}
            >
            {isTorchOn ? <Zap className="text-yellow-400 w-5 h-5" /> : <ZapOff className="text-white w-5 h-5" />}
            </button>
            <div className="px-3 py-1 bg-black/40 backdrop-blur rounded-full text-white text-xs flex items-center">
              {isCameraStarting ? "Starting…" : statusMsg}
            </div>
        </div>
      </div>

      {/* Timer & Visualizer */}
      {isRecording && statusMsg.startsWith("Rest correctly") ? (
        <div className="bg-card border rounded-lg p-8 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-center font-medium animate-pulse">{statusMsg}</p>
        </div>
      ) : (
        <div className="bg-card border rounded-lg p-3">
            <div className="text-center font-mono text-3xl font-bold mb-2 flex justify-center items-center gap-2">
              <Timer className="w-6 h-6 text-muted-foreground"/> 
              <span
                className={`inline-block min-w-[5ch] tabular-nums text-left ${recordingTime < 10 && isRecording ? "text-red-500" : "text-primary"}`}
              >
                {formattedRecordingTime}s
              </span>
            </div>
            {recordingTime < 10 && isRecording && <p className="text-center text-xs text-red-500 animate-pulse">Keep recording... (min 12s for first reading)</p>}
            <div className="h-32 bg-slate-950 rounded border border-slate-800 p-1 mt-2">
              <SignalVisualizer
                rawSignal={visRaw}
                filteredSignal={visRaw.length > 0 ? preprocessPreviewPPG(visRaw, SAMPLE_RATE) : []}
                title="Preprocessed Signal"
                color="emerald"
              />
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Verify the systolic beats point upward in this preprocessed view.
            </p>
        </div>
      )}

      {/* ── Continuous BP Live Monitor ─── */}
      {(isRecording || bpResults.length > 0) && (
        <div className="mt-2">
          <BpLiveMonitor
            results={bpResults}
            isAnalyzing={isBpAnalyzing}
            segmentProgress={bpSegmentProgress}
            currentSegment={bpCurrentSegment}
          />
        </div>
      )}

      <div className="flex gap-4 justify-center pt-2">
        {!isRecording ? (
             <button onClick={handleStartClick} className="h-16 w-16 flex items-center justify-center rounded-full shadow-lg bg-green-500 hover:bg-green-600 text-white transition-all hover:scale-105"><Play className="w-8 h-8 ml-1" /></button>
        ) : (
            <button
              onClick={() => {
                isRecordingActiveRef.current = false;
                setIsRecording(false);
                setStatusMsg("Stopped");
                if (recordingIntervalRef.current) {
                  clearTimeout(recordingIntervalRef.current);
                  recordingIntervalRef.current = null;
                }
                setShowPostRecordForm(true);
              }}
              className="h-16 w-16 flex items-center justify-center rounded-full shadow-lg bg-red-500 hover:bg-red-600 text-white"
            >
              <Pause className="w-8 h-8" />
            </button>
        )}
      </div>

      {showPostRecordForm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card w-full max-w-sm rounded-xl border shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-foreground"><Activity className="w-5 h-5"/> Actual Values (Optional)</h2>
                    <button onClick={handleSaveSession} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5"/></button>
                </div>
                <div className="space-y-3 text-foreground">
                    <p className="text-sm text-muted-foreground mb-4">You can optionally provide the actual reference values for accuracy tracking.</p>
                    <div>
                        <label className="text-sm font-medium">Actual SBP (mmHg)</label>
                        <input type="number" className="w-full bg-background border rounded p-2" value={actualValues.sbp} onChange={e => setActualValues({...actualValues, sbp: e.target.value})} placeholder="e.g. 120"/>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Actual DBP (mmHg)</label>
                        <input type="number" className="w-full bg-background border rounded p-2" value={actualValues.dbp} onChange={e => setActualValues({...actualValues, dbp: e.target.value})} placeholder="e.g. 80"/>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Actual Glucose (mg/dL)</label>
                        <input type="number" className="w-full bg-background border rounded p-2" value={actualValues.glucose} onChange={e => setActualValues({...actualValues, glucose: e.target.value})} placeholder="e.g. 100"/>
                    </div>
                </div>
                <button onClick={handleSaveSession} className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-bold text-lg shadow hover:opacity-90">Save Record</button>
            </div>
        </div>
      )}

    </div>
  );
}
