import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gomoku.gemini',
  appName: 'Gemini Gomoku',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
