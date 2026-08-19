export interface PPGSegment {
  segmentIndex: number;
  startTimeSec: number;
  endTimeSec: number;
  estimatedSBP: number; // Systolic Blood Pressure (mmHg)
  estimatedDBP: number; // Diastolic Blood Pressure (mmHg)
  estimatedMAP: number; // Mean Arterial Pressure (mmHg)
  estimatedGlucose?: number; // Estimated Glucose
  heartRateBpm: number;
  ppgRawSignal: number[]; // Raw PPG sensor values (e.g. 50-250 Hz sampling)
  timeStamps: number[];   // Relative time offsets in ms/sec
}

export interface PPGRecordSession {
  sessionId: string;
  patientId: string;
  samplingRateHz: number;
  recordingDate: string;
  totalDurationSec: number;
  baselineSBP?: number;
  baselineDBP?: number;
  actualSBP?: number;
  actualDBP?: number;
  actualGlucose?: number;
  segments: PPGSegment[];
}
