# Signal Monitor - Physiological Signal Acquisition & ML Inference PWA

A medical-grade Progressive Web App (PWA) and cross-platform mobile app (via Capacitor) designed for real-time physiological signal acquisition, continuous monitoring, and ML-based prediction of Blood Pressure (Systolic and Diastolic) and Glucose levels using remote photoplethysmography (rPPG).

## Key Capabilities

### 1. Real-Time Physiological Inference
- **Classical ML Pipeline:** Utilizes ONNX Runtime Web (`onnxruntime-web`) to run customized classical machine learning models (e.g., Polynomial feature extraction, StandardScaler) entirely client-side.
- **Multi-Target Prediction:** Supports real-time prediction of Systolic Blood Pressure (SBP), Diastolic Blood Pressure (DBP), and Glucose levels.
- **Continuous Monitoring:** Processes 12-second rolling signal segments with dynamic progress tracking.
- **Smart Fallbacks:** Implements physiological heuristics (e.g., relying on reflection index, augmentation index, and stiffness index) to estimate values when ML predictions collapse across changing inputs.
- **Live Classification:** Visually categorizes BP readings into standard clinical stages (Normal, Elevated, Stage 1 HT, Stage 2 HT).

### 2. Signal Acquisition & Recording
- **rPPG Camera Integration:** Non-contact physiological signal acquisition by extracting the green channel from a live camera feed.
- **Simulation Mode:** Provides realistic synthetic signal data for testing when a camera is unavailable.
- **Live Visualization:** Real-time dual-graph visualization of raw camera signals vs. bandpass-filtered signals.
- **Filtering:** High-performance Butterworth bandpass filtering (customizable cutoffs and order) to isolate physiological frequencies and remove DC offset/noise.

### 3. Patient Data & History
- **MIMIC-III Standardized Export:** Ensures that collected data aligns with the MIMIC-III waveform conventions, including timestamp-based sampling, standard formatting, and metadata headers.
- **Offline Storage:** Full offline capability leveraging IndexedDB for secure, local persistence of recorded sessions.
- **Session Management:** Browse past sessions, review raw/filtered signals, compute statistical summaries (Min, Max, Mean, Std Dev), and selectively clip time ranges for CSV export.

### 4. Cross-Platform App
- **PWA Ready:** Installable on Desktop and Mobile browsers, complete with a Service Worker for offline operation and network-first caching.
- **Native Android & iOS:** Configured with Capacitor (`@capacitor/core`, `@capacitor/android`) for native device deployment.

---

## Technical Architecture

### Frontend Stack
- **Framework:** Next.js 16 (App router) and React 19.
- **Styling:** Tailwind CSS v4 with custom dark-mode aesthetics for clinical environments.
- **UI Components:** Built on top of `shadcn/ui`, utilizing `radix-ui` primitives.
- **Icons:** `lucide-react`.

### Signal Processing & ML Stack
- **Inference Engine:** `onnxruntime-web` running WASM for high-performance, client-side ML evaluation without server dependencies.
- **Signal Processing:** Custom C2D-based rendering and Butterworth filter implementations for real-time signal analysis.
- **Data Math:** `fili` for advanced digital filtering algorithms.

### Project Structure
```text
/app               - Next.js application routing
/components
  ├── /navigation  - Bottom tab navigation for mobile interfaces
  ├── /tabs        - Core application views (Recording, History, Model, Settings)
  └── /visualization - Real-time signal graphs and BP live monitoring
/lib
  ├── signal-processing.ts       - Core algorithms for rPPG and filtering
  └── classical-models-pipeline.ts - ONNX execution spec and feature mapping
/public
  ├── /models      - Hosted ONNX models and weights (.onnx, .onnx.data)
  ├── manifest.json - PWA manifest
  └── sw.js        - Offline Service Worker
```

---

## Getting Started

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm or pnpm

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Native Build (Capacitor)
To sync your web assets to the native Android project:
```bash
npm run build
npx cap sync android
npx cap open android
```

---

## Usage Guide

1. **Recording Data:**
   Navigate to the Recording tab. Grant camera permissions. The app will extract the rPPG signal from your fingertip over the camera lens. You can also run the app in simulated mode for testing.

2. **Monitoring Results:**
   Once recording starts, the ML pipeline aggregates data into 12-second rolling segments. Extracted features (72 base features mapped into 15 polynomial features) are passed to the ONNX models to output SBP, DBP, and Glucose estimates.

3. **Data Review & Export:**
   Go to the History tab to review past sessions. You can trim the data and export it as a MIMIC-III compatible CSV file.

4. **Model Configuration:**
   In the Model tab, review the assumptions made by the ML models or upload custom `.pth`, `.pkl`, or `.onnx` models if extending the platform.

---

## Security and Privacy
- **Client-Side Only:** No data is sent to a server. Camera feeds are processed entirely in memory. ML inference happens directly within the browser using WASM.
- **Local Storage:** Patient details and signals are stored only on the device via IndexedDB.
- **Offline By Default:** Works in environments without internet access once the PWA is installed.

## License
Designed for clinical research, physiological data collection, and medical device development purposes. Ensure adherence to local regulatory standards when utilizing this software for actual patient monitoring.
