'use client';

import React from 'react';
import { Activity, Clock, Loader2, TrendingUp } from 'lucide-react';

export interface BpSegmentResult {
  segmentIndex: number;
  timestamp: number;
  sbp: number;
  dbp: number;
  map: number;
  glucose?: number;
  pulseBpm: number;
  elapsedMs: number;
  debug?: {
    sbp: InferenceDebugLine | null;
    dbp: InferenceDebugLine | null;
    glucose: InferenceDebugLine | null;
  };
}

export interface InferenceDebugLine {
  target: 'sbp' | 'dbp' | 'glucose';
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

interface BpLiveMonitorProps {
  results: BpSegmentResult[];
  isAnalyzing: boolean;
  segmentProgress: number; // 0–1, progress within current 12-second segment
  currentSegment: number;  // Which segment we're collecting (0-indexed)
}

// ─── BP Classification ────────────────────────────────────────────────────────

function classifyBp(sbp: number, dbp: number) {
  if (sbp < 120 && dbp < 80) {
    return { label: 'Normal', ring: 'ring-emerald-500/60', bg: 'from-emerald-950/40 to-emerald-900/20', sbpColor: 'text-emerald-400', dbpColor: 'text-emerald-300', dot: 'bg-emerald-400' };
  }
  if (sbp < 130 && dbp < 80) {
    return { label: 'Elevated', ring: 'ring-yellow-500/60', bg: 'from-yellow-950/40 to-yellow-900/20', sbpColor: 'text-yellow-400', dbpColor: 'text-yellow-300', dot: 'bg-yellow-400' };
  }
  if (sbp < 140 || dbp < 90) {
    return { label: 'Stage 1 HT', ring: 'ring-orange-500/60', bg: 'from-orange-950/40 to-orange-900/20', sbpColor: 'text-orange-400', dbpColor: 'text-orange-300', dot: 'bg-orange-400' };
  }
  return { label: 'Stage 2 HT', ring: 'ring-red-500/60', bg: 'from-red-950/40 to-red-900/20', sbpColor: 'text-red-400', dbpColor: 'text-red-300', dot: 'bg-red-400' };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDebugLine(label: string, debug: InferenceDebugLine | null) {
  if (!debug) return `${label}: n/a`;
  const raw = Number.isFinite(debug.rawPrediction) ? debug.rawPrediction.toFixed(1) : 'n/a';
  const displayed = Number.isFinite(debug.displayedPrediction) ? debug.displayedPrediction.toFixed(1) : 'n/a';
  const dIn = Number.isFinite(debug.inputDelta) ? debug.inputDelta.toFixed(2) : 'n/a';
  const dRaw = Number.isFinite(debug.rawDelta) ? debug.rawDelta.toFixed(2) : 'n/a';
  const fallback = debug.usedFallback && Number.isFinite(debug.fallbackPrediction ?? NaN)
    ? ` fallback ${debug.fallbackPrediction!.toFixed(1)}`
    : '';
  const smooth = debug.smoothingAlpha !== undefined ? ` smooth ${debug.smoothingAlpha.toFixed(2)}` : '';
  const prev = debug.previousDisplayedPrediction !== undefined ? ` prev ${debug.previousDisplayedPrediction.toFixed(1)}` : '';
  const top = debug.topInputs
    .slice(0, 2)
    .map((item) => `${item.name}=${Number.isFinite(item.value) ? item.value.toFixed(1) : 'n/a'}`)
    .join(', ');
  return `${label} raw ${raw} -> ${displayed} | dIn ${dIn} | dRaw ${dRaw}${fallback}${smooth}${prev}${top ? ` | top ${top}` : ''}`;
}

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-white/5 ${className}`} />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BpLiveMonitor({
  results,
  isAnalyzing,
  segmentProgress,
  currentSegment,
}: BpLiveMonitorProps) {
  const latest = results[results.length - 1] ?? null;
  const history = results.slice(-5).reverse(); // last 5, newest first

  const cls = latest ? classifyBp(latest.sbp, latest.dbp) : null;
  const hasData = latest !== null;

  const SEGMENT_SECONDS = 12;
  const progressPct = Math.round(segmentProgress * 100);
  const secondsCollected = Math.round(segmentProgress * SEGMENT_SECONDS);

  return (
    <div className="space-y-3">
      {/* ── Live Readout Card ─────────────────────────────────────── */}
      <div
        className={`relative rounded-2xl border overflow-hidden bg-gradient-to-br transition-all duration-700 ${
          cls
            ? `${cls.bg} ${cls.ring} ring-1`
            : 'from-slate-950/60 to-slate-900/40 ring-1 ring-white/10'
        }`}
      >
        {/* Subtle animated background pulse when analyzing */}
        {isAnalyzing && !hasData && (
          <div className="absolute inset-0 bg-blue-500/5 animate-pulse rounded-2xl" />
        )}

        <div className="p-5">
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/50">
                Blood Pressure
              </span>
            </div>
          </div>

          {/* Main numbers */}
          {hasData ? (
            <div className="flex items-end justify-center gap-4 py-2">
              {/* SBP */}
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Systolic</p>
                <p className={`text-4xl sm:text-5xl md:text-6xl font-black font-mono tabular-nums leading-none ${cls?.sbpColor ?? 'text-white'}`}>
                  {latest!.sbp}
                </p>
                <p className="text-[10px] text-white/40 mt-1">mmHg</p>
              </div>

              {/* Divider */}
              <div className="flex flex-col items-center gap-1 pb-4">
                <div className="w-px h-8 bg-white/20" />
                <span className="text-white/30 text-sm font-light">/</span>
                <div className="w-px h-8 bg-white/20" />
              </div>

              {/* DBP */}
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Diastolic</p>
                <p className={`text-4xl sm:text-5xl md:text-6xl font-black font-mono tabular-nums leading-none ${cls?.dbpColor ?? 'text-white/80'}`}>
                  {latest!.dbp}
                </p>
                <p className="text-[10px] text-white/40 mt-1">mmHg</p>
              </div>
            </div>
          ) : (
            <div className="flex items-end justify-center gap-4 py-2">
              <SkeletonBlock className="h-14 w-24 rounded-xl" />
              <SkeletonBlock className="h-8 w-4 rounded mb-4" />
              <SkeletonBlock className="h-14 w-24 rounded-xl" />
            </div>
          )}

          {/* Pulse + MAP row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-2 mt-3 pt-3 border-t border-white/10">
            <div className="text-center">
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Pulse</p>
              {hasData ? (
                <p className="text-xl font-bold font-mono text-blue-300 tabular-nums">
                  {latest!.pulseBpm > 0 ? Math.round(latest!.pulseBpm) : '—'}
                  <span className="text-[10px] text-white/30 ml-1">bpm</span>
                </p>
              ) : (
                <SkeletonBlock className="h-6 w-12 rounded mt-1 mx-auto" />
              )}
            </div>
            <div className="text-center">
              <p className="text-[10px] text-white/40 uppercase tracking-widest">MAP</p>
              {hasData ? (
                <p className="text-xl font-bold font-mono text-purple-300 tabular-nums">
                  {latest!.map}
                  <span className="text-[10px] text-white/30 ml-1">mmHg</span>
                </p>
              ) : (
                <SkeletonBlock className="h-6 w-12 rounded mt-1 mx-auto" />
              )}
            </div>
            <div className="text-center">
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Glucose</p>
              {hasData && latest!.glucose !== undefined ? (
                <p className="text-xl font-bold font-mono text-pink-300 tabular-nums">
                  {latest!.glucose}
                  <span className="text-[10px] text-white/30 ml-1">mg/dL</span>
                </p>
              ) : (
                <SkeletonBlock className="h-6 w-12 rounded mt-1 mx-auto" />
              )}
            </div>
            <div className="text-center">
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Segments</p>
              <p className="text-xl font-bold font-mono text-white/60 tabular-nums">
                {results.length}
              </p>
            </div>
          </div>

        </div>

        {/* ── Segment progress bar ─────────────────────────────────── */}
        <div className="px-5 pb-4 space-y-1.5">
          <div className="flex justify-between items-center text-[10px] text-white/30">
            {isAnalyzing ? (
              <>
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing segment {currentSegment + 1}…
                </span>
                <span>{latest ? `Last: ${formatTime(latest.timestamp)}` : 'No data yet'}</span>
              </>
            ) : (
              <>
                <span>Segment {currentSegment + 1} — {secondsCollected}s / {SEGMENT_SECONDS}s</span>
                <span>{progressPct}%</span>
              </>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isAnalyzing ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── History Table ────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/3 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/3">
            <TrendingUp className="w-3.5 h-3.5 text-white/40" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              Recent Readings
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {history.map((r, i) => {
              const c = classifyBp(r.sbp, r.dbp);
              return (
                <div
                  key={r.segmentIndex}
                  className={`flex items-center justify-between px-4 py-2.5 ${i === 0 ? 'bg-white/5' : ''}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${c.dot} ${i === 0 ? '' : 'opacity-50'}`} />
                    <div>
                      <p className={`text-sm font-bold font-mono tabular-nums ${i === 0 ? 'text-white' : 'text-white/50'}`}>
                        {r.sbp} / {r.dbp}
                        <span className="text-[10px] font-normal text-white/30 ml-1">mmHg</span>
                      </p>
                      <p className="text-[10px] text-white/30">
                        {r.pulseBpm > 0 ? `${Math.round(r.pulseBpm)} bpm` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-white/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(r.timestamp)}
                    </p>
                    <p className="text-[10px] text-white/20">
                      seg {r.segmentIndex + 1} · {r.elapsedMs.toFixed(0)}ms
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── First-segment waiting state ──────────────────────────── */}
      {!hasData && !isAnalyzing && (
        <div className="text-center py-2">
          <p className="text-xs text-white/30 animate-pulse">
            Keep finger on camera — first reading in {SEGMENT_SECONDS - secondsCollected}s…
          </p>
        </div>
      )}
    </div>
  );
}
