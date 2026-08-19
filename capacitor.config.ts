import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourdomain.ppgpwa', // Your App ID
  appName: 'PPG PWA', // Your App Name
  webDir: 'out', // REQUIRED: This is where Next.js exports static files
  server: {
    androidScheme: 'https' // Prevents CORS/fetch issues on Android
  }
};

export default config;
