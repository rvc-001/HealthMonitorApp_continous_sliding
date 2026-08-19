'use client';
import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { useRouter } from 'next/navigation';

export default function BackButtonHandler() {
  const router = useRouter();

  useEffect(() => {
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        router.back();
      } else {
        App.exitApp();
      }
    });
    return () => { App.removeAllListeners(); };
  }, [router]);

  return null;
}
