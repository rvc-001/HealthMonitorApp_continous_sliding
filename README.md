# Signal Monitor - Physiological Signal Acquisition PWA

A medical-grade Progressive Web App (PWA) for physiological signal acquisition, analysis, and ML-based blood pressure prediction, aligned with MIMIC-III data standards.

## Features

### 1. Recording Tab
- **Camera Integration**: Remote photoplethysmography (rPPG) signal acquisition from camera feed
- **Real-time Visualization**: Live graphing of raw and filtered signals side-by-side
- **Patient Information**: Optional patient ID and name capture for record keeping
- **Simulated Signal Mode**: Falls back to realistic simulated signal data if camera unavailable
- **Offline Recording**: Full offline capability with IndexedDB storage

### 2. History Tab
- **Session Management**: Browse all recorded physiological sessions
- **Session Details**: View recording metadata (patient, duration, sampling rate, filters applied)
- **Signal Visualization**: Review raw and filtered signals from previous recordings
- **Clipping**: Select specific time ranges within recordings for export
- **Signal Statistics**: Calculate and display min, max, mean, and standard deviation
- **MIMIC-III CSV Export**: Export data in clinical-grade format with proper headers

### 3. Model Tab
- **Model Upload**: Support for PyTorch (.pth), Pickle (.pkl), ONNX, TensorFlow, and other ML formats
- **Model Assumptions**: Explicit UI for confirming model expectations (filtered signal, sampling rate, window length)
- **Inference Interface**: Run trained models against filtered signal data
- **Blood Pressure Prediction**: Predict Systolic (SBP) and Diastolic (DBP) from physiological signals
- **Results Comparison**: Compare predictions against reference values with error metrics
- **Export Results**: Download inference results as CSV

### 4. Settings Tab
- **Signal Processing Configuration**: Adjust bandpass filter parameters
  - Low/High frequency cutoffs (Hz)
  - Butterworth filter order
  - Sampling rate (fixed to recording rate)
- **Graph Preferences**: Grid display and auto-scaling options
- **Data Management**: Clear all local recordings with confirmation
- **Theme Control**: Dark mode (default for clinical environment)

## Technical Stack

### Frontend
- **Framework**: Next.js 16 with React 19
- **Styling**: Tailwind CSS v4 with custom design tokens
- **UI Components**: shadcn/ui
- **Charts**: Canvas-based custom signal visualization (Recharts compatible)

### Signal Processing
- **Butterworth Filtering**: Bandpass filtering for noise removal
- **rPPG Extraction**: Green channel analysis from camera frames
- **Statistics**: Min, max, mean, std deviation calculations
- **MIMIC-III Alignment**: Timestamp, sampling rate, and CSV format compatibility

### Storage & Offline
- **Database**: IndexedDB for offline-capable data persistence
- **Service Worker**: Network-first caching with offline fallback
- **PWA Manifest**: Full installability on Android and iOS

## Architecture

```
/components
  /navigation      - Bottom tab navigation
  /tabs            - Tab content (Recording, History, Model, Settings)
  /visualization   - Signal visualizers
  /pwa             - PWA registration

/lib
  /signal-processing.ts  - Core signal algorithms, storage
  /camera-utils.ts       - Camera access, rPPG extraction
  /app-context.ts        - Global app settings

/public
  /manifest.json   - PWA manifest
  /sw.js          - Service worker (offline support)
```

## Data Format

### RecordingSession (Internal)
```typescript
{
  id: string;
  patientId?: string;
  patientName?: string;
  startTime: number;          // Timestamp in milliseconds
  endTime?: number;
  samplingRate: number;       // Hz
  rawSignal: Array<{
    timestamp: number;
    value: number;
  }>;
  filterConfig: FilterConfig;
  createdAt: Date;
}
```

### CSV Export (MIMIC-III Format)
```
# MIMIC-III Signal Export
# Patient ID: P12345
# Patient Name: John Doe
# Start Time: 2026-01-22T10:30:00Z
# Sampling Rate: 30 Hz
# Filter: Butterworth Bandpass 0.5-50 Hz, Order 4

Time(s),Raw Signal,Filtered Signal
0.0000,0.1234,0.0456
0.0333,0.1567,0.0789
...
```

## Signal Processing Pipeline

1. **Acquisition**: 30 Hz sampling from camera (rPPG) or simulation
2. **Raw Signal**: Unmodified green channel values (-1 to 1 normalized)
3. **Preprocessing**: DC offset removal (mean subtraction)
4. **Filtering**: Butterworth bandpass filter (default 0.5-50 Hz, order 4)
5. **Output**: Filtered signal ready for ML inference

## Usage

### Recording a Session
1. Navigate to Recording tab
2. Grant camera permission (or use simulated mode)
3. Enter patient ID or name
4. Click "Start Recording"
5. View real-time raw and filtered signal graphs
6. Click "Stop Recording" to finalize

### Reviewing Sessions
1. Navigate to History tab
2. Select a session from the list
3. View full signal visualization and statistics
4. Optionally clip to specific time range
5. Export as CSV

### ML Inference
1. Navigate to Model tab
2. Upload a trained model (.pth, .pkl, .onnx, etc.)
3. Review and confirm model assumptions
4. Select a recorded session
5. Run inference to get SBP/DBP predictions
6. Compare against reference values
7. Export results

## PWA Installation

### Android
1. Open app in Chrome
2. Tap menu → "Install app" or "Add to Home screen"
3. Confirm installation

### iOS (Web Clip)
1. Open app in Safari
2. Tap share → "Add to Home Screen"
3. Confirm addition

### Desktop
1. Open app in Chrome/Edge
2. Click install icon in address bar
3. Confirm installation

## Offline Capabilities

- **Full Recording**: Record sessions without network connection
- **Signal Visualization**: View stored sessions offline
- **Data Export**: Generate CSV exports without internet
- **Model Inference**: Run models offline (model already downloaded)
- **Automatic Sync**: Data syncs when connection restored

## MIMIC-III Compliance

This app follows MIMIC-III waveform conventions:
- ✓ Timestamp-based sampling
- ✓ Fixed sampling rates (30 Hz default)
- ✓ Signal normalization
- ✓ CSV export format with metadata headers
- ✓ Patient identification support
- ✓ Filter configuration tracking

## Security & Privacy

- **Local Storage**: All data stored in browser IndexedDB only
- **No Server Upload**: Option to export data, but not automatic
- **Patient Privacy**: Patient ID/name stored locally only
- **HTTPS Required**: PWA requires HTTPS (or localhost)

## Performance Optimization

- **Canvas Rendering**: Efficient C2D-based signal visualization
- **Lazy Loading**: Components load on demand
- **Data Pagination**: Large session lists paginated
- **Memory Management**: Signal buffers cleared after processing
- **Service Worker Caching**: Optimal cache strategies

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+ (iOS 14.5+)
- Edge 90+

## Future Enhancements

- [ ] Real-time heart rate extraction from PPG
- [ ] Multi-model inference with ensemble averaging
- [ ] Cloud sync option with opt-in
- [ ] Advanced signal preprocessing (artifact removal)
- [ ] Data sharing with healthcare providers
- [ ] Notification system for abnormal readings
- [ ] TensorFlow.js model support
- [ ] Real-time video analysis improvements

## License

Clinical research and medical device development purposes.

## References

- MIMIC-III Dataset: https://mimic.physionet.org/
- Remote PPG (rPPG): IEEE Transactions on Biomedical Engineering
- Butterworth Filter: Signal Processing literature
