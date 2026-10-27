import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelInstallSync, type ModelInstallJobsResponse } from './use-model-install-sync';

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  jobs: {
    jobs: [{ repo_id: 'k2-fsa/OmniVoice', state: 'downloading' }],
  } as ModelInstallJobsResponse,
}));

vi.mock('@/lib/api/client', () => ({ apiJson: mock.api }));
vi.mock('@/hooks/use-backend-status', () => ({
  useBackendStatus: () => ({ stage: 'ready' }),
}));

afterEach(() => {
  cleanup();
  mock.api.mockReset();
  mock.jobs = {
    jobs: [{ repo_id: 'k2-fsa/OmniVoice', state: 'downloading' }],
  };
});

it('invalidates every readiness surface when an observed install completes', async () => {
  mock.api.mockImplementation(() => Promise.resolve(mock.jobs));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(['model-install-jobs'], mock.jobs);
  client.setQueryData(['engines'], { stale: false });
  render(
    <QueryClientProvider client={client}>
      <ModelInstallSync />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.getQueryData(['model-install-jobs'])).toEqual(mock.jobs));
  await act(async () => {});

  mock.jobs = { jobs: [] };
  act(() => client.setQueryData(['model-install-jobs'], mock.jobs));

  await waitFor(() => {
    expect(client.getQueryState(['engines'])?.isInvalidated).toBe(true);
  });
});

it.each(['done', 'failed', 'cancelled', 'install_cancelled', 'removed'])(
  'refreshes fast and accurate transcription readiness when a download becomes %s',
  async (state) => {
    mock.api.mockImplementation(() => Promise.resolve(mock.jobs));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [
      ['transcription-readiness'],
      ['transcription-readiness', 'accurate'],
      ['dictation-setup-models'],
      ['model-catalogue'],
    ];
    client.setQueryData(['model-install-jobs'], mock.jobs);
    for (const key of keys) client.setQueryData(key, { ready: false });
    try {
      render(
        <QueryClientProvider client={client}>
          <ModelInstallSync />
        </QueryClientProvider>,
      );
      await act(async () => {});
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);

      mock.jobs =
        state === 'removed' ? { jobs: [] } : { jobs: [{ repo_id: 'k2-fsa/OmniVoice', state }] };
      act(() => client.setQueryData(['model-install-jobs'], mock.jobs));

      await waitFor(() => {
        for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      });
    } finally {
      cleanup();
      client.clear();
    }
  },
);
