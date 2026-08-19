'use client';

import { Analytics } from '@vercel/analytics/next';
import { Capacitor } from '@capacitor/core';

export default function VercelAnalyticsGate() {
  // In Capacitor, the app origin is typically https://localhost and Vercel's
  // injected assets won't exist in the packaged build, causing noise/errors.
  if (Capacitor.isNativePlatform()) return null;
  return <Analytics />;
}

