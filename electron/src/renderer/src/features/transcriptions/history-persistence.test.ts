import { expect, it, vi } from 'vitest';
import {
  addTranscription,
  loadTranscriptions,
  removeTranscription,
  subscribeTranscriptions,
  TRANSCRIPTIONS_KEY,
} from '@shared/utils/transcriptionsStore';

const mutations = [
  { name: 'append', run: () => addTranscription({ text: 'New transcript' }) },
  { name: 'remove', run: () => removeTranscription(1) },
];

it.each(mutations)(
  '$name preserves inaccessible history and the original read error',
  ({ run }) => {
    const history = '[{"id":1,"text":"Keep"}]';
    localStorage.setItem(TRANSCRIPTIONS_KEY, history);
    const refresh = vi.fn();
    const stop = subscribeTranscriptions(refresh);
    const error = new DOMException('Storage access denied', 'SecurityError');
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw error;
    });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    try {
      expect(() => run()).toThrow(error);
      expect(write).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(loadTranscriptions()).toEqual([]);
      read.mockRestore();
      expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
    } finally {
      stop();
    }
  },
);

for (const { name, run } of mutations) {
  it.each(['{', '{}', 'null', '42', '"history"', ''])(
    `${name} refuses malformed or non-array history (%j) without overwriting it`,
    (history) => {
      localStorage.setItem(TRANSCRIPTIONS_KEY, history);
      const refresh = vi.fn();
      const stop = subscribeTranscriptions(refresh);
      const write = vi.spyOn(Storage.prototype, 'setItem');
      try {
        expect(() => run()).toThrow('Invalid transcription history');
        expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
        expect(write).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(loadTranscriptions()).toEqual([]);
      } finally {
        stop();
      }
    },
  );
}

it('creates absent history and publishes only after a successful append', () => {
  const refresh = vi.fn();
  const stop = subscribeTranscriptions(refresh);
  try {
    const saved = addTranscription({ text: 'First', speakers: ['Speaker 1'] });
    expect(loadTranscriptions()).toEqual([saved]);
    expect(saved.speakers).toEqual(['Speaker 1']);
    expect(refresh).toHaveBeenCalledExactlyOnceWith([saved]);
  } finally {
    stop();
  }
});

it('keeps existing entries and does not notify when appending exceeds the storage quota', () => {
  const history = '[{"id":1,"text":"Keep"}]';
  localStorage.setItem(TRANSCRIPTIONS_KEY, history);
  const refresh = vi.fn();
  const stop = subscribeTranscriptions(refresh);
  const error = new DOMException('Storage quota exceeded', 'QuotaExceededError');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw error;
  });
  try {
    expect(() => addTranscription({ text: 'New' })).toThrow(error);
    expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
