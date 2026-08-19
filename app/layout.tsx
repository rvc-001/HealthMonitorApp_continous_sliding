import React from "react"
import type { Metadata, Viewport } from 'next'
import PWARegister from '@/components/pwa/pwa-register'
import BackButtonHandler from '@/components/pwa/back-button-handler'
import { ThemeProvider } from '@/components/theme-provider' //
import VercelAnalyticsGate from '@/components/pwa/vercel-analytics-gate'
import '../styles/globals.css';

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  title: 'PPG PWA',
  description: 'Medical-grade PWA...',
  generator: 'v0.app',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PPG PWA',
  },
  icons: {
    // Add the newly uploaded 16, 32, and 48px favicons
    icon: [
      { url: '/icons/favicon.ico' },
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    // Update to match your uploaded Apple Touch Icon filenames
    apple: [
      { url: '/icons/apple-touch-icon.png' },
      { url: '/icons/apple-touch-icon-180x180.png', sizes: '180x180', type: 'image/png' }
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // Add suppressHydrationWarning to html to prevent mismatch errors with next-themes
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PPG PWA" />
      </head>
      <body className={`font-sans antialiased`}>
        {/* Wrap children with ThemeProvider */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <PWARegister />
          <BackButtonHandler />
          <VercelAnalyticsGate />
        </ThemeProvider>
      </body>
    </html>
  )
}
