'use client';

import { useState, useEffect } from 'react';
import RecordingTab from '@/components/tabs/recording-tab';
import SettingsTab from '@/components/tabs/settings-tab';
import DataRecordsTab from '@/components/tabs/data-records-tab';
import BottomNavigation from '@/components/navigation/bottom-navigation';
import AppErrorBoundary from '@/components/app-error-boundary';
import { AppSettingsContext, defaultSettings, type AppSettings } from '@/lib/app-context';
import { readJsonStorage, readStorage, writeJsonStorage, writeStorage } from '@/lib/browser-storage';

type TabType = 'recording' | 'data' | 'settings';
const SETTINGS_STORAGE_KEY = 'signalMonitorSettings';
const ACTIVE_TAB_STORAGE_KEY = 'ppg_active_tab';
const VALID_TABS: TabType[] = ['recording', 'data', 'settings'];

function normalizeSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    filterConfig: {
      ...defaultSettings.filterConfig,
      ...(settings?.filterConfig ?? {}),
    },
    graphPreferences: {
      ...defaultSettings.graphPreferences,
      ...(settings?.graphPreferences ?? {}),
    },
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('recording');
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);

  function applyTheme(theme: 'light' | 'dark') {
    const html = document.documentElement;
    if (theme === 'light') {
      html.classList.remove('dark');
      html.classList.add('light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
    }
  }

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      const savedTab = readStorage(ACTIVE_TAB_STORAGE_KEY);
      if (savedTab && VALID_TABS.includes(savedTab as TabType)) {
        setActiveTab(savedTab as TabType);
      }

      const loadedSettings = normalizeSettings(
        readJsonStorage<Partial<AppSettings> | null>(SETTINGS_STORAGE_KEY, null),
      );
      setAppSettings(loadedSettings);
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    applyTheme(appSettings.theme);
  }, [appSettings.theme]);

  useEffect(() => {
    writeStorage(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    const updated = normalizeSettings({ ...appSettings, ...newSettings });
    setAppSettings(updated);
    writeJsonStorage(SETTINGS_STORAGE_KEY, updated);
    if (newSettings.theme) {
      applyTheme(newSettings.theme);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'recording':
        return <RecordingTab />;
      case 'data':
        return <DataRecordsTab />;
      case 'settings':
        return <SettingsTab />;
      default:
        return <RecordingTab />;
    }
  };

  return (
    <AppSettingsContext.Provider value={{ settings: appSettings, updateSettings: handleUpdateSettings }}>
      <div className="flex flex-col h-[100dvh] bg-background text-foreground">
        <main className="flex-1 overflow-auto pb-20">
          <AppErrorBoundary resetKey={activeTab}>
            {renderTab()}
          </AppErrorBoundary>
        </main>

        <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </AppSettingsContext.Provider>
  );
}
