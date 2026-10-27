import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { TRANSCRIPTIONS_KEY } from '@shared/utils/transcriptionsStore';

vi.mock('@/components/workspace-sidebar', () => ({
  SecondarySidebar: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/components/recording-inputs', () => ({ RecordingInputs: () => null }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), Link: () => null }));
vi.mock('@/hooks/use-engines', () => ({ useEngines: () => ({}) }));
vi.mock('@/hooks/use-dictation-selection', () => ({ useDictationSelection: () => ({}) }));
vi.mock('@/hooks/use-native-dictation', () => ({ useNativeShortcut: () => ({}) }));
vi.mock('@/features/settings/model-catalogue-query', () => ({ useModelCatalogue: () => ({}) }));
vi.mock('@/hooks/use-recording', () => ({
  useRecording: () => ({
    isStarting: false,
    isRecording: false,
    isCleaning: false,
    seconds: 0,
    selectedInputId: '',
  }),
}));
vi.mock('@/lib/api/client', () => ({ apiJson: vi.fn(async () => ({ ready: true })) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { TranscriptionsPage } from './transcriptions-page';

const history = JSON.stringify([
  { id: 1, text: 'First transcript', language: 'en', timestamp: '2026-10-26T10:00:00Z' },
  { id: 2, text: 'Second transcript', language: 'en', timestamp: '2026-10-26T10:01:00Z' },
]);
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem(TRANSCRIPTIONS_KEY, history);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
async function mount() {
  render(
    <QueryClientProvider client={client}>
      <TranscriptionsPage />
    </QueryClientProvider>,
  );
  const selected = await screen.findByRole('button', { name: /Second transcript/ });
  fireEvent.click(selected);
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  return selected;
}

it('surfaces a failed deletion without changing history or selection, then permits retry', async () => {
  const selected = await mount();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('transcriptions.delete') }));

  expect(toast.error).toHaveBeenCalledWith(i18n.t('modelSettings.failed'));
  expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(toast.success).not.toHaveBeenCalled();
  write.mockRestore();

  fireEvent.click(screen.getByRole('button', { name: i18n.t('transcriptions.delete') }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Second transcript/ })).toBeNull(),
  );
  expect(screen.getByRole('button', { name: /First transcript/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(JSON.parse(localStorage.getItem(TRANSCRIPTIONS_KEY)!)).toEqual([JSON.parse(history)[0]]);
});

it('preserves selection and clear confirmation when storage rejects clearing all transcripts', async () => {
  const selected = await mount();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('transcriptions.clear_title') }));
  const confirm = screen.getByRole('button', { name: i18n.t('common.confirm') });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  fireEvent.click(confirm);

  expect(toast.error).toHaveBeenCalledWith(i18n.t('modelSettings.failed'));
  expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe(history);
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(confirm).toBeVisible();
  write.mockRestore();

  fireEvent.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Second transcript/ })).toBeNull(),
  );
  expect(screen.queryByRole('button', { name: /First transcript/ })).toBeNull();
  expect(localStorage.getItem(TRANSCRIPTIONS_KEY)).toBe('[]');
});
