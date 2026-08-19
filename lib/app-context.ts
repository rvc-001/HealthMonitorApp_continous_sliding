import { createContext } from 'react';
import { FilterConfig } from '@/lib/signal-processing';

export interface AppSettings {
  filterConfig: FilterConfig;
  graphPreferences: {
    showGrid: boolean;
    autoScale: boolean;
  };
  recordingSpeed: number; // 0.25x, 0.5x, 1x, 1.5x, 2x
  theme: 'light' | 'dark'; // light or dark mode
}

export const defaultSettings: AppSettings = {
  filterConfig: {
    lowCutoff: 0.5,
    highCutoff: 50,
    order: 4,
    samplingRate: 30,
  },
  graphPreferences: {
    showGrid: true,
    autoScale: true,
  },
  recordingSpeed: 1, // 1x = real-time
  theme: 'dark', // default to dark mode
};

export const AppSettingsContext = createContext<{
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
}>({
  settings: defaultSettings,
  updateSettings: () => {},
});
