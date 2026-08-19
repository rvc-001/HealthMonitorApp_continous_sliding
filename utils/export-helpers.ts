import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { PPGRecordSession } from '@/types/ppg-data';

/**
 * Generates structured CSV for per-segment summary metrics
 */
export function buildSegmentSummaryCSV(session: PPGRecordSession): string {
  const headers = [
    'Segment_Index',
    'Start_Time_s',
    'End_Time_s',
    'Estimated_SBP_mmHg',
    'Estimated_DBP_mmHg',
    'Estimated_MAP_mmHg',
    'Heart_Rate_BPM',
    'Samples_Count',
  ];

  const rows = session.segments.map((seg) => [
    seg.segmentIndex,
    seg.startTimeSec.toFixed(2),
    seg.endTimeSec.toFixed(2),
    seg.estimatedSBP.toFixed(2),
    seg.estimatedDBP.toFixed(2),
    seg.estimatedMAP.toFixed(2),
    seg.heartRateBpm.toFixed(1),
    seg.ppgRawSignal.length,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * Generates high-density Raw PPG signal time-series CSV
 */
export function buildRawSignalCSV(session: PPGRecordSession): string {
  const headers = ['Segment_Index', 'Timestamp_ms', 'Raw_PPG_Value'];
  const lines: string[] = [headers.join(',')];

  session.segments.forEach((seg) => {
    for (let i = 0; i < seg.ppgRawSignal.length; i++) {
      const t = seg.timeStamps[i] !== undefined ? seg.timeStamps[i] : i * (1000 / session.samplingRateHz);
      const val = seg.ppgRawSignal[i];
      lines.push(`${seg.segmentIndex},${t.toFixed(4)},${val.toFixed(6)}`);
    }
  });

  return lines.join('\r\n');
}

/**
 * Bundles single or multiple sessions into a structured ZIP file
 */
export async function exportSessionsToZip(
  sessions: PPGRecordSession[],
  zipFilename = `PPG_Data_Export_${new Date().toISOString().slice(0, 10)}.zip`
): Promise<void> {
  const zip = new JSZip();

  // Root manifest summarizing all contained sessions
  const manifest = sessions.map((s) => ({
    sessionId: s.sessionId,
    patientId: s.patientId,
    samplingRateHz: s.samplingRateHz,
    recordingDate: s.recordingDate,
    totalSegments: s.segments.length,
  }));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  sessions.forEach((session) => {
    // Isolated folder per session to keep files organized
    const sessionFolder = zip.folder(`session_${session.sessionId}`);
    if (!sessionFolder) return;

    // 1. Full lossless JSON data (all raw points, nested metadata)
    sessionFolder.file('session_complete.json', JSON.stringify(session, null, 2));

    // 2. Metrics summary CSV
    sessionFolder.file('segment_summary_metrics.csv', buildSegmentSummaryCSV(session));

    // 3. Raw Signal CSV
    sessionFolder.file('raw_ppg_signal_data.csv', buildRawSignalCSV(session));
  });

  // Generate compression with standard DEFLATE
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  saveAs(zipBlob, zipFilename);
}
