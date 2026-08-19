export class RPPGAcquisition {
    private frameInterval: number;
    private stream: MediaStream | null = null;
    private track: MediaStreamTrack | null = null;
    private sampleCanvas: HTMLCanvasElement | null = null;
    private sampleContext: CanvasRenderingContext2D | null = null;
  
    constructor(targetFps: number = 25) {
      this.frameInterval = 1000 / targetFps;
    }
  
    /**
     * Robust Camera Request
     */
    async requestCameraPermission(): Promise<MediaStream> {
      if (typeof window !== 'undefined' && 
          window.location.protocol !== 'https:' && 
          window.location.hostname !== 'localhost') {
        throw new Error("Camera access requires HTTPS. Please deploy with SSL.");
      }
  
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser API not supported");
      }
  
      try {
        this.stop();
  
        const constraints: MediaStreamConstraints = {
            audio: false,
            video: {
                facingMode: 'environment',
                // Prefer smaller frames to reduce WebView strain; PPG only needs consistent exposure.
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 25 }
            }
        };
  
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.track = this.stream.getVideoTracks()[0];

        try {
          const caps = (this.track.getCapabilities && typeof this.track.getCapabilities === 'function') 
            ? this.track.getCapabilities() as any 
            : {};
          const advanced: any[] = [];
          if (caps?.exposureMode?.includes('manual')) advanced.push({ exposureMode: 'manual' });
          if (caps?.whiteBalanceMode?.includes('manual')) advanced.push({ whiteBalanceMode: 'manual' });
          if (caps?.focusMode?.includes('manual')) advanced.push({ focusMode: 'manual' });
          if (advanced.length) await this.track.applyConstraints({ advanced });
        } catch (e) {
          console.warn("Manual exposure/WB not supported on this device", e);
        }

        return this.stream;
      } catch (err) {
        // Normalize common permission errors into a more actionable message for the UI.
        const name = (err as any)?.name as string | undefined;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          console.error("Camera Error: permission denied", err);
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          console.error("Camera Error: no camera device found", err);
        } else {
          console.error("Camera Error:", err);
        }
        throw err;
      }
    }
  
    getTorchState(): { supported: boolean; enabled: boolean } {
        if (!this.track) {
            return { supported: false, enabled: false };
        }

        const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
        const capabilities = typeof this.track.getCapabilities === 'function'
            ? (this.track.getCapabilities() as any)
            : {};
        const settings = typeof this.track.getSettings === 'function'
            ? (this.track.getSettings() as any)
            : {};
        const fillLightModes = Array.isArray(capabilities?.fillLightMode) ? capabilities.fillLightMode : [];
        const supported =
            Boolean(capabilities?.torch) ||
            Boolean((supportedConstraints as any).torch) ||
            fillLightModes.includes('flash') ||
            fillLightModes.includes('torch');
        const enabled = Boolean(settings?.torch) || settings?.fillLightMode === 'flash' || settings?.fillLightMode === 'torch';

        return { supported, enabled };
    }

    async toggleTorch(on: boolean): Promise<boolean> {
        if (!this.track) return false;

        try {
            const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
            const capabilities = typeof this.track.getCapabilities === 'function'
                ? (this.track.getCapabilities() as any)
                : {};
            const fillLightModes = Array.isArray(capabilities?.fillLightMode) ? capabilities.fillLightMode : [];

            if (capabilities?.torch || (supportedConstraints as any).torch) {
                await this.track.applyConstraints({
                    advanced: [{ torch: on } as any]
                });
                return this.getTorchState().enabled === on || on;
            }

            const desiredFillLightMode = on
                ? (fillLightModes.includes('torch') ? 'torch' : fillLightModes.includes('flash') ? 'flash' : null)
                : (fillLightModes.includes('off') ? 'off' : null);

            if (desiredFillLightMode) {
                await this.track.applyConstraints({
                    advanced: [{ fillLightMode: desiredFillLightMode } as any]
                });
                return desiredFillLightMode === 'off' ? !this.getTorchState().enabled : true;
            }

            return false;
        } catch (e) {
            console.warn("Failed to toggle torch:", e);
            return false;
        }
    }
  
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            this.track = null;
        }
    }
  
    /**
     * Extracts avg red intensity from the center of the video frame.
     * Removed internal throttling to allow caller (setInterval) to control rate.
     */
    extractSignal(video: HTMLVideoElement): number | null {
      if (!this.sampleCanvas) {
        this.sampleCanvas = document.createElement('canvas');
        this.sampleCanvas.width = 40;
        this.sampleCanvas.height = 40;
      }

      if (!this.sampleContext) {
        this.sampleContext = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
      }

      const canvas = this.sampleCanvas;
      const ctx = this.sampleContext;
      
      if (!ctx) return null;
  
      // Draw center crop (50% width/height)
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return null;

      ctx.drawImage(video, vw/4, vh/4, vw/2, vh/2, 0, 0, canvas.width, canvas.height);
  
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      
      let sumRed = 0;
      let count = 0;
  
      for (let i = 0; i < data.length; i += 4) {
        sumRed += data[i]; // Red channel
        count++;
      }
  
      return count > 0 ? sumRed / count : null;
    }

    getSignalQuality(avgRed: number): 'saturated' | 'no_contact' | 'ok' {
      if (avgRed > 250) return 'saturated';   // finger pressed too hard / lens overexposed
      if (avgRed < 30) return 'no_contact';   // no finger detected, or torch off
      return 'ok';
    }
}
