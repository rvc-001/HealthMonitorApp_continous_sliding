'use client';

import React, { useContext, useState, useEffect } from 'react';
import { 
  Settings, 
  Trash2, 
  Moon, 
  Sun, 
  Monitor, 
  Info, 
  Database, 
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Mail,
  User
} from 'lucide-react';
import { AppSettingsContext } from '@/lib/app-context';
import { SignalStorage } from '@/lib/signal-processing';

export default function SettingsTab() {
  const { settings, updateSettings } = useContext(AppSettingsContext);
  const [mounted, setMounted] = useState(false);
  const [clearStatus, setClearStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [storageUsage, setStorageUsage] = useState<string>('Checking...');

  async function checkStorage() {
    try {
      const storage = new SignalStorage();
      const sessions = await storage.getSessions();
      setStorageUsage(`${sessions.length} recordings stored`);
    } catch {
      setStorageUsage('Unknown');
    }
  }

  // Prevent hydration mismatch
  useEffect(() => {
    const mountTimer = window.setTimeout(() => {
      void checkStorage();
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(mountTimer);
  }, []);

  const handleClearData = async () => {
    // 1. Safety Check
    if (!window.confirm("⚠️ ARE YOU SURE?\n\nThis will permanently delete ALL recorded signals and patient data. This action cannot be undone.")) {
      return;
    }

    try {
      setClearStatus('loading');
      
      // 2. Perform Deletion
      const storage = new SignalStorage();
      await storage.clearAll();
      
      // 3. Update UI
      setClearStatus('success');
      setStorageUsage('0 recordings stored');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        setClearStatus('idle');
      }, 3000);

    } catch (error) {
      console.error(error);
      setClearStatus('error');
    }
  };

  if (!mounted) return null;

  return (
    <div className="w-full flex flex-col bg-background min-h-screen pb-24">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" /> Settings
        </h1>
        <p className="text-xs text-muted-foreground">
          Preferences • Data Management • About
        </p>
      </div>

      <div className="p-4 space-y-6">
        
        {/* Theme Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Appearance</h2>
          <div className="bg-card border border-border rounded-lg p-1 flex">
            <button
              onClick={() => updateSettings({ theme: 'light' })}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-md text-sm transition-all ${settings.theme === 'light' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Sun className="w-4 h-4" /> Light
            </button>
            <button
              onClick={() => updateSettings({ theme: 'dark' })}
              className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-md text-sm transition-all ${settings.theme === 'dark' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Moon className="w-4 h-4" /> Dark
            </button>
            <button
              onClick={() => updateSettings({ theme: 'dark' })}
              className="flex-1 flex items-center justify-center gap-2 p-2 rounded-md text-sm text-muted-foreground opacity-60"
              disabled
            >
              <Monitor className="w-4 h-4" /> System
            </button>
          </div>
        </section>

        {/* Data Management Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Data Management</h2>
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-full">
                <Database className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Local Storage</div>
                <div className="text-xs text-muted-foreground">{storageUsage}</div>
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-2">
              <button
                onClick={handleClearData}
                disabled={clearStatus === 'loading' || clearStatus === 'success'}
                className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                  clearStatus === 'success' 
                    ? 'bg-green-100 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20'
                }`}
              >
                {clearStatus === 'idle' && (
                  <>
                    <Trash2 className="w-4 h-4" /> Delete All Data
                  </>
                )}
                {clearStatus === 'loading' && (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></span> Deleting...
                  </>
                )}
                {clearStatus === 'success' && (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Data Cleared
                  </>
                )}
                {clearStatus === 'error' && (
                  <>
                    <AlertTriangle className="w-4 h-4" /> Error - Try Again
                  </>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground text-center">
                This action is irreversible. All patient recordings will be lost.
              </p>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">About</h2>
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Info className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-sm">PPG Inference PWA</h3>
                <p className="text-xs text-muted-foreground">v1.0.0 (Beta)</p>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed">
              A progressive web application for real-time PPG signal acquisition and client-side ONNX inference. Designed for privacy-first, offline-capable medical research.
            </p>
          </div>
        </section>

        {/* About Developer Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">About the Developer</h2>
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-3 rounded-full">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Developed By</p>
                <h3 className="font-bold text-base">Rajvardhan Chhugani</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1 pt-2 border-t border-border">
              <a
                href="https://www.linkedin.com/in/rajvardhan-chhugani-510276297/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-md hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="w-5 h-5 text-[#0A66C2]" />
                <span className="font-medium">LinkedIn Profile</span>
              </a>
              <a
                href="mailto:chhuganirajvardhan@gmail.com"
                className="flex items-center gap-3 p-3 rounded-md hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="w-5 h-5 text-red-500" />
                <span className="font-medium">chhuganirajvardhan@gmail.com</span>
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-[10px] text-muted-foreground/50">
            Running locally on your device. <br/> No data is sent to the cloud.
          </p>
        </div>

      </div>
    </div>
  );
}
