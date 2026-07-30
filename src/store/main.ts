// Store client entry (the /store Vite entry, loaded by store.html). Loads
// the active locale, then mounts the SPA. Mirrors src/guide/main.ts.

import './styles.css';
import { ensureLocaleLoaded, getLanguage } from '../ui/i18n';
import { StoreApp } from './app';

async function boot(): Promise<void> {
  const mount = document.getElementById('store-app');
  if (!mount) return;
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // A missing locale chunk falls back to English; render regardless.
  }
  new StoreApp(mount).start();
}

void boot();
