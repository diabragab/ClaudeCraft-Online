// Tiny history-based router for the storefront SPA. No dependencies:
// intercepts in-app link clicks, drives history.pushState, and notifies on
// every navigation (click, back/forward, initial load). Mirrors
// src/guide/router.ts's shape (GuideRouter), retargeted at STORE_BASE.
// Clean URLs (/store/products/iron-sword) work because both vite.config.ts
// and server/main.ts fall back to store.html for /store* paths.

import { STORE_BASE } from './routes';

export type NavigateHandler = (pathname: string) => void;

export class StoreRouter {
  private onNavigate: NavigateHandler;

  constructor(onNavigate: NavigateHandler) {
    this.onNavigate = onNavigate;
  }

  start(): void {
    document.addEventListener('click', this.handleClick);
    window.addEventListener('popstate', this.handlePopState);
    this.onNavigate(window.location.pathname + window.location.search);
  }

  go(pathname: string): void {
    if (pathname === window.location.pathname + window.location.search) {
      this.onNavigate(pathname);
      return;
    }
    window.history.pushState({}, '', pathname);
    this.onNavigate(pathname);
  }

  private handlePopState = (): void => {
    this.onNavigate(window.location.pathname + window.location.search);
  };

  private handleClick = (ev: MouseEvent): void => {
    if (
      ev.defaultPrevented ||
      ev.button !== 0 ||
      ev.metaKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.altKey
    ) {
      return;
    }
    const anchor = (ev.target as Element | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#') || (anchor.hash && anchor.pathname === window.location.pathname)) {
      return;
    }
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.origin !== window.location.origin) return;
    const path = anchor.pathname;
    if (path !== STORE_BASE && !path.startsWith(`${STORE_BASE}/`)) return;
    ev.preventDefault();
    this.go(path + anchor.search + anchor.hash);
  };
}
