import { expect, it, vi } from 'vitest';

it.each(['localStorage', 'sessionStorage'] as const)(
  'exposes browser-compatible %s through both globals',
  (name) => {
    const storage = window[name];
    expect(globalThis[name]).toBe(storage);
    expect(storage).toBeInstanceOf(Storage);
    expect(Object.getPrototypeOf(storage)).toBe(window.Storage.prototype);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    const write = vi.spyOn(Storage.prototype, 'setItem');
    storage.setItem('setting', 'value');
    expect(write).toHaveBeenCalledWith('setting', 'value');
    expect(storage.getItem('setting')).toBe('value');
  },
);

it('keeps local and session storage independent when writing, removing and clearing', () => {
  localStorage.setItem('setting', 'local');
  sessionStorage.setItem('setting', 'session');
  expect(localStorage.getItem('setting')).toBe('local');
  expect(sessionStorage.getItem('setting')).toBe('session');

  sessionStorage.removeItem('setting');
  expect(localStorage.getItem('setting')).toBe('local');
  sessionStorage.setItem('setting', 'session');
  localStorage.clear();
  expect(sessionStorage.getItem('setting')).toBe('session');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(1);
});

it.each(['localStorage', 'sessionStorage'] as const)(
  'preserves named properties, key enumeration and StorageEvent branding for %s',
  (name) => {
    const storage = window[name];
    storage.setItem('empty', '');
    storage.setItem('setting', 'value');
    expect(storage.getItem('empty')).toBe('');
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.setting).toBe('value');
    expect(Object.keys(storage)).toEqual(['empty', 'setting']);
    expect(storage.key(0)).toBe('empty');
    expect(storage.key(2)).toBeNull();
    expect(new StorageEvent('storage', { storageArea: storage }).storageArea).toBe(storage);
  },
);
