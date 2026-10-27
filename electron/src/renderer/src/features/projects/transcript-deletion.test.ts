import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadTranscriptions,
  removeTranscription,
  subscribeTranscriptions,
  TRANSCRIPTIONS_KEY,
} from '@shared/utils/transcriptionsStore';
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('deletes from fresh storage and notifies mounted library subscribers', () => {
  localStorage.setItem(TRANSCRIPTIONS_KEY, JSON.stringify([{ id: 1, text: 'older' }]));
  const refresh = vi.fn();
  const stop = subscribeTranscriptions(refresh);
  localStorage.setItem(
    TRANSCRIPTIONS_KEY,
    JSON.stringify([
      { id: 2, text: 'new' },
      { id: 1, text: 'older' },
    ]),
  );
  removeTranscription(1);
  expect(loadTranscriptions()).toEqual([{ id: 2, text: 'new' }]);
  expect(refresh).toHaveBeenCalledWith([{ id: 2, text: 'new' }]);
  stop();
});
it('does not notify deletion or lose data when storage rejects the write', () => {
  localStorage.setItem(TRANSCRIPTIONS_KEY, '[{"id":1}]');
  const refresh = vi.fn();
  const stop = subscribeTranscriptions(refresh);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  expect(() => removeTranscription(1)).toThrow('Storage unavailable');
  expect(loadTranscriptions()).toEqual([{ id: 1 }]);
  expect(refresh).not.toHaveBeenCalled();
  stop();
});

it('does not write or notify when the requested transcription is missing', () => {
  const history = JSON.stringify([{ id: 2, text: 'keep' }]);
  localStorage.setItem(TRANSCRIPTIONS_KEY, history);
  const refresh = vi.fn();
  const stop = subscribeTranscriptions(refresh);
  const setItem = vi.spyOn(Storage.prototype, 'setItem');

  removeTranscription(1);

  expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
  expect(setItem).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  stop();
});

it('refuses to overwrite malformed history', () => {
  localStorage.setItem(TRANSCRIPTIONS_KEY, '{');
  expect(() => removeTranscription(1)).toThrow();
  expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe('{');
});
