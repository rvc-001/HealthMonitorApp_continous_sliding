'use client';

import React, { useState, useEffect } from 'react';
import { PPGRecordSession } from '@/types/ppg-data';
import { exportSessionsToZip } from '@/utils/export-helpers';
import { Download, Database, Activity, FileArchive, SearchX } from 'lucide-react';

export default function DataRecordsTab() {
  const [sessions, setSessions] = useState<PPGRecordSession[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [activeSession, setActiveSession] = useState<PPGRecordSession | null>(null);

  useEffect(() => {
    // Attempt to load real sessions from local storage if any exist
    try {
      const stored = localStorage.getItem('ppg_recorded_sessions');
      if (stored) {
        setSessions(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to parse stored sessions', e);
    }
  }, []);

  const toggleSelectAll = () => {
    if (selectedSessionIds.length === sessions.length) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(sessions.map((s) => s.sessionId));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleExportSelected = async () => {
    const targets = sessions.filter((s) => selectedSessionIds.includes(s.sessionId));
    if (targets.length === 0) return;

    try {
      setIsExporting(true);
      await exportSessionsToZip(targets, `PPG_Selected_Sessions_${Date.now()}.zip`);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAll = async () => {
    try {
      setIsExporting(true);
      await exportSessionsToZip(sessions, `PPG_All_Sessions_${Date.now()}.zip`);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto font-sans space-y-6 text-foreground">
      {/* Header & Global Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-border pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" />
            PPG Signal & BP Database
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View raw photoplethysmogram time-series, segment-level BP estimates, and export archives.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportSelected}
            disabled={isExporting || selectedSessionIds.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition shadow-sm"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Packaging...' : `Export Selected (${selectedSessionIds.length})`}
          </button>
          <button
            onClick={handleExportAll}
            disabled={isExporting || sessions.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80 transition shadow-sm"
          >
            <FileArchive className="w-4 h-4" />
            Export All to ZIP
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-card border border-border rounded-lg shadow-sm text-center">
          <SearchX className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No sessions recorded yet</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">
            Go to the Record tab to start capturing PPG signals and estimating blood pressure. Your saved sessions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Table: Recording Sessions */}
          <div className="overflow-x-auto bg-card border border-border rounded-lg shadow-sm">
            <table className="min-w-full divide-y divide-border text-sm text-left">
              <thead className="bg-muted/50 text-foreground font-semibold">
                <tr>
                  <th className="p-4 w-4">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={selectedSessionIds.length === sessions.length && sessions.length > 0}
                      className="rounded border-input bg-background text-primary focus:ring-primary"
                    />
                  </th>
                  <th className="px-4 py-3">Session ID</th>
                  <th className="px-4 py-3">Patient ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actuals</th>
                  <th className="px-4 py-3">Sampling Rate</th>
                  <th className="px-4 py-3">Segments</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-muted-foreground">
                {sessions.map((session) => (
                  <tr
                    key={session.sessionId}
                    className={`transition-colors ${
                      activeSession?.sessionId === session.sessionId
                        ? 'bg-primary/10'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedSessionIds.includes(session.sessionId)}
                        onChange={() => toggleSelectOne(session.sessionId)}
                        className="rounded border-input bg-background text-primary focus:ring-primary"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{session.sessionId}</td>
                    <td className="px-4 py-3">{session.patientId}</td>
                    <td className="px-4 py-3">{session.recordingDate}</td>
                    <td className="px-4 py-3 text-xs">
                      {session.actualSBP || session.actualDBP || session.actualGlucose ? (
                        <div className="space-y-0.5">
                          {session.actualSBP && session.actualDBP && <div>BP: {session.actualSBP}/{session.actualDBP}</div>}
                          {session.actualGlucose && <div>Glu: {session.actualGlucose}</div>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{session.samplingRateHz} Hz</td>
                    <td className="px-4 py-3">{session.segments.length} segments</td>
                    <td className="px-4 py-3 space-x-3">
                      <button
                        onClick={() => setActiveSession(session)}
                        className="text-xs text-primary hover:underline font-medium transition"
                      >
                        View Segments
                      </button>
                      <button
                        onClick={() => exportSessionsToZip([session], `${session.sessionId}_Export.zip`)}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline transition"
                      >
                        Single ZIP
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Segment Breakdown & Signal Preview */}
          {activeSession && (
            <div className="bg-card border border-border rounded-lg p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex justify-between items-center border-b border-border pb-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  Estimated BP & Segments: {activeSession.sessionId}
                </h2>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded font-medium border border-border">
                  Patient: {activeSession.patientId}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-xs text-left">
                  <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 font-medium">Segment #</th>
                      <th className="px-3 py-2 font-medium">Time Interval</th>
                      <th className="px-3 py-2 font-medium">Estimated SBP</th>
                      <th className="px-3 py-2 font-medium">Estimated DBP</th>
                      <th className="px-3 py-2 font-medium">MAP</th>
                      <th className="px-3 py-2 font-medium">Heart Rate</th>
                      <th className="px-3 py-2 font-medium">Signal Samples</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-foreground">
                    {activeSession.segments.map((seg) => (
                      <tr key={seg.segmentIndex} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-medium text-muted-foreground">Seg {seg.segmentIndex}</td>
                        <td className="px-3 py-2">{seg.startTimeSec.toFixed(1)}s - {seg.endTimeSec.toFixed(1)}s</td>
                        <td className="px-3 py-2 font-semibold text-rose-500 dark:text-rose-400">{seg.estimatedSBP.toFixed(1)} mmHg</td>
                        <td className="px-3 py-2 font-semibold text-blue-500 dark:text-blue-400">{seg.estimatedDBP.toFixed(1)} mmHg</td>
                        <td className="px-3 py-2">{seg.estimatedMAP.toFixed(1)} mmHg</td>
                        <td className="px-3 py-2">{seg.heartRateBpm.toFixed(0)} bpm</td>
                        <td className="px-3 py-2 text-muted-foreground">{seg.ppgRawSignal.length} samples</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
