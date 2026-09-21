/**
 * Local bootstrap stub for the Grok PWA plugin. The real platform chrome
 * (manifest injection, ?install=1 tutorial, head tags) lives in the Grok
 * sandbox; this stub only keeps `vite.config.ts` importable so the dev server
 * can run on a plain checkout.
 */
export function grokPwaPlugin() {
  return {
    name: "app-builder:grok-pwa-plugin",
  };
}