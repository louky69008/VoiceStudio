import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useModelOps } from './model-ops';
import { useModelCatalogue, type CatalogueModel } from '../model-catalogue-query';

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  apiJson: mocks.api,
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock('@/hooks/use-backend-status', () => ({ useBackendStatus: () => ({ stage: 'ready' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));

const model: CatalogueModel = {
  repo_id: 'owner/model name',
  label: 'Model',
  role: 'ASR',
  size_gb: 1,
  installed: true,
  supported: true,
};
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

it.each(['install', 'cancel'] as const)(
  '%s refreshes readiness and setup immediately after the backend accepts it',
  async (action) => {
    mocks.api.mockResolvedValue({ jobs: [] });
    const { client, wrapper } = setup();
    const keys = [
      ['transcription-readiness'],
      ['transcription-readiness', 'accurate'],
      ['dictation-setup-models'],
    ];
    for (const key of keys) client.setQueryData(key, { ready: true });
    const { result } = renderHook(() => useModelOps({ trackResidency: false }), { wrapper });

    await act(async () => {
      expect(await result.current[action](model.repo_id)).toBe(true);
    });

    expect(mocks.api).toHaveBeenCalledWith(
      action === 'cancel' ? '/models/install/cancel' : '/models/install',
      { method: 'POST', body: JSON.stringify({ repo_id: model.repo_id }) },
    );
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  },
);

it.each(['install', 'cancel'] as const)(
  '%s reconciles uncertain backend state without hiding the request error',
  async (action) => {
    mocks.api.mockImplementation(async (_path: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new Error('Mutation response lost');
      return { jobs: [] };
    });
    const { client, wrapper } = setup();
    const keys = [
      ['model-catalogue'],
      ['transcription-readiness'],
      ['transcription-readiness', 'accurate'],
      ['dictation-setup-models'],
    ];
    for (const key of keys) client.setQueryData(key, { ready: true });
    const { result } = renderHook(() => useModelOps({ trackResidency: false }), { wrapper });

    await act(async () => {
      expect(await result.current[action](model.repo_id)).toBe(false);
    });

    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(result.current.failed).toBe(true);
    expect(result.current.pending).toBeNull();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Mutation response lost');
    expect(mocks.success).not.toHaveBeenCalled();
  },
);

it('keeps the original mutation failure when cache reconciliation also rejects', async () => {
  mocks.api.mockImplementation(async (_path: string, options?: RequestInit) => {
    if (options?.method === 'POST') throw new Error('Mutation response lost');
    return { jobs: [] };
  });
  const { client, wrapper } = setup();
  vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('Cache refresh failed'));
  const { result } = renderHook(() => useModelOps({ trackResidency: false }), { wrapper });

  await act(async () => {
    expect(await result.current.install(model.repo_id)).toBe(false);
  });

  expect(result.current.failed).toBe(true);
  expect(result.current.pending).toBeNull();
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Mutation response lost');
  expect(mocks.success).not.toHaveBeenCalled();
});

function Maintenance() {
  const ops = useModelOps();
  const catalogue = useModelCatalogue();
  return (
    <>
      <p>{catalogue.data?.models[0]?.installed ? 'Model installed' : 'Model missing'}</p>
      <button onClick={() => ops.requestDelete(model)}>Remove model</button>
      <button onClick={() => ops.requestReinstall(model)}>Reinstall model</button>
      {ops.confirmDialog}
    </>
  );
}

it.each(['delete', 'reinstall'] as const)(
  '%s refreshes a cached installed model even if the later operation fails',
  async (kind) => {
    let installed = true;
    mocks.api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/models') return { models: [{ ...model, installed }] };
      if (path === '/model/loaded') return { models: [], count: 0 };
      if (path === '/models/install/status') return { jobs: [] };
      if (path === '/models/owner/model%20name' && options?.method === 'DELETE') {
        installed = false;
        if (kind === 'delete') throw new Error('Deletion response lost');
        return {};
      }
      if (path === '/models/install') throw new Error('Download could not start');
      return {};
    });
    const { client, wrapper } = setup();
    client.setQueryData(['model-catalogue'], { models: [model] });
    render(<Maintenance />, { wrapper });
    expect(screen.getByText('Model installed')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: kind === 'delete' ? 'Remove model' : 'Reinstall model' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: `modelMaintenance.${kind}` }),
    );

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        kind === 'delete' ? 'Deletion response lost' : 'Download could not start',
      ),
    );
    expect(await screen.findByText('Model missing')).toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(client.getQueryData(['model-catalogue'])).toEqual({
      models: [{ ...model, installed: false }],
    });
  },
);
