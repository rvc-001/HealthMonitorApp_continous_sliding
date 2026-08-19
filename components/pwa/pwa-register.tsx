'use client';

import { useEffect, useState } from 'react';

const OFFLINE_CACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-48x48.png',
  '/icons/apple-touch-icon.png',
  '/icons/apple-touch-icon-180x180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/Ok_ppg_bp_glucose_final.onnx',
  '/ort-wasm-simd-threaded.mjs',
  '/ort-wasm-simd-threaded.wasm',
];

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
  }>;
}

export default function PWARegister() {
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const DEV_SW_CLEANUP_KEY = 'ppg_dev_sw_cleanup_complete';
    const isDevEnvironment =
      process.env.NODE_ENV !== 'production' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const unregisterDevelopmentWorkers = async () => {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('signal-monitor-v'))
            .map((cacheName) => caches.delete(cacheName)),
        );

        const shouldReload =
          registrations.length > 0 &&
          Boolean(navigator.serviceWorker.controller) &&
          window.sessionStorage.getItem(DEV_SW_CLEANUP_KEY) !== '1';

        if (shouldReload) {
          window.sessionStorage.setItem(DEV_SW_CLEANUP_KEY, '1');
          window.location.reload();
          return;
        }

        window.sessionStorage.removeItem(DEV_SW_CLEANUP_KEY);
      } catch (error) {
        console.error('[pwa] Failed to clean up development service workers:', error);
      }
    };

    const getWarmupUrls = () => {
      const runtimeEntries = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((entry): entry is string => typeof entry === 'string')
        .filter((entry) => entry.startsWith(window.location.origin))
        .map((entry) => {
          const url = new URL(entry);
          if (url.pathname.startsWith('/api/')) {
            return null;
          }

          return `${url.pathname}${url.search}`;
        })
        .filter((entry): entry is string => Boolean(entry));

      return Array.from(new Set([
        window.location.pathname || '/',
        ...OFFLINE_CACHE_URLS,
        ...runtimeEntries,
      ]));
    };

    const warmServiceWorkerCache = async () => {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const target = registration.active ?? registration.waiting ?? registration.installing;
        target?.postMessage({
          type: 'CACHE_URLS',
          payload: getWarmupUrls(),
        });
      } catch (error) {
        console.error('[pwa] Failed to warm service worker cache:', error);
      }
    };

    if (isDevEnvironment) {
      unregisterDevelopmentWorkers().catch(() => {});
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).then(() => {
        warmServiceWorkerCache().catch(() => {});
      }).catch((error) => {
        console.error('[v0] Service Worker registration failed:', error);
      });
    }

    const handler = (e: Event) => {
      const event = e as BeforeInstallPromptEvent;
      event.preventDefault();
      setDeferredPrompt(event);
      setShowInstallPrompt(true);
    };

    const onWindowLoad = () => {
      warmServiceWorkerCache().catch(() => {});
    };

    const onControllerChange = () => {
      warmServiceWorkerCache().catch(() => {});
    };

    window.addEventListener('beforeinstallprompt', handler);
    if (!isDevEnvironment) {
      window.addEventListener('load', onWindowLoad);
      navigator.serviceWorker?.addEventListener?.('controllerchange', onControllerChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      if (!isDevEnvironment) {
        window.removeEventListener('load', onWindowLoad);
        navigator.serviceWorker?.removeEventListener?.('controllerchange', onControllerChange);
      }
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome === 'accepted') {
      console.log('App installed');
    }

    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  if (!showInstallPrompt || !deferredPrompt) {
    return null;
  }

  return null;
}
