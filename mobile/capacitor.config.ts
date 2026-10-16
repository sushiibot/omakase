import type { CapacitorConfig } from '@capacitor/cli';
const url = process.env.OMAKASE_URL ?? 'https://agent.sushii.bot';
if (!url) throw new Error('Set OMAKASE_URL to your existing HTTPS omakase URL.');
const origin = new URL(url);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('OMAKASE_URL must be an HTTPS origin without credentials, path, query or fragment.');
}
const config: CapacitorConfig = {
  appId: 'app.omakase.mobile',
  appName: 'omakase',
  webDir: 'www',
  server: { url: origin.origin, cleartext: false },
  android: { allowMixedContent: false },
  plugins: { SystemBars: { insetsHandling: 'native' } },
};
export default config;
