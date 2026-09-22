/**
 * mapboxConfig.ts — Mapbox settings for the WebView-based maps.
 *
 * The token is optional: when it isn't set, the map components fall back to
 * Leaflet + OpenStreetMap tiles, which need no API key. Set one in .env as
 * EXPO_PUBLIC_MAPBOX_TOKEN to switch to Mapbox tiles.
 */

const PLACEHOLDER = 'your_mapbox_token_here';

/** Mapbox access token, or '' when not configured (callers fall back to Leaflet). */
export function getMapboxToken(): string {
  const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
  if (!token || token === PLACEHOLDER) return '';
  return token;
}

/** True only when a usable Mapbox token is present. */
export function isMapboxConfigured(): boolean {
  return getMapboxToken().length > 0;
}

// ─── Mapbox GL JS assets (loaded inside the WebView) ──────────────────────────
export const MAPBOX_GL_JS_CDN  = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js';
export const MAPBOX_GL_CSS_CDN = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css';

/** Satellite + streets suits field tree surveying (canopy visible, roads labelled). */
export const DEFAULT_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
