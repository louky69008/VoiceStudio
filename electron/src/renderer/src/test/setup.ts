/// <reference types="vitest/jsdom" />
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

if (typeof window !== 'undefined') {
  // Vitest aliases window to globalThis, where Node can already expose its own
  // Web Storage. Use the actual jsdom instances without replacing their methods:
  // prototype spies, StorageEvent and local/session isolation then match a browser.
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => jsdom.window[name],
    });
  }
}

function clearStorage() {
  if (typeof window === 'undefined') return;
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(clearStorage);

afterEach(() => {
  vi.restoreAllMocks();
  clearStorage();
});
