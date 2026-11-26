/**
 * Unit Tests - Firestore Pagination Hook
 * Covers: initial load, loadMore, refresh, reset, error handling.
 * firebase/firestore is mocked — these tests verify hook logic only.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useFirestorePagination } from '../useFirestorePagination';
import { getDocs } from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
  getDocs: jest.fn(),
  query: jest.fn((base: unknown, ...constraints: unknown[]) => ({ base, constraints })),
  collection: jest.fn((_db: unknown, name: string) => ({ __collection: name })),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  limit: jest.fn((n: number) => ({ __limit: n })),
  startAfter: jest.fn((doc: unknown) => ({ __startAfter: doc })),
}));

const mockGetDocs = getDocs as jest.Mock;
const baseQuery: any = { __base: 'orders' };

function makeSnapshot(items: Array<Record<string, unknown>>) {
  return {
    docs: items.map((item, i) => ({
      id: `doc_${i}`,
      data: () => item,
    })),
  };
}

beforeEach(() => {
  mockGetDocs.mockReset();
});

describe('useFirestorePagination', () => {
  it('starts idle when autoLoad is false', async () => {
    const { result } = await renderHook(() => useFirestorePagination(baseQuery, { autoLoad: false }));
    const [state] = result.current;
    expect(state.loading).toBe(false);
    expect(state.data).toEqual([]);
    expect(state.hasMore).toBe(true);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('loads the first page automatically when autoLoad is true', async () => {
    mockGetDocs.mockResolvedValue(makeSnapshot([{ total: 1 }, { total: 2 }]));
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true, pageSize: 20 })
    );

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    const [state] = result.current;
    expect(state.data).toHaveLength(2);
    expect(state.data[0]).toMatchObject({ id: 'doc_0', total: 1 });
    expect(state.hasMore).toBe(false); // fewer docs than pageSize
    expect(state.error).toBeNull();
  });

  it('sets error state when the fetch fails', async () => {
    mockGetDocs.mockRejectedValue(new Error('permission-denied'));
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true })
    );

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].error).toBe('permission-denied');
    expect(result.current[0].data).toEqual([]);
  });

  it('appends data on loadMore', async () => {
    mockGetDocs
      .mockResolvedValueOnce(makeSnapshot([{ n: 1 }, { n: 2 }])) // page 1 (== pageSize)
      .mockResolvedValueOnce(makeSnapshot([{ n: 3 }]));           // page 2
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true, pageSize: 2 })
    );

    await waitFor(() => expect(result.current[0].data).toHaveLength(2));
    expect(result.current[0].hasMore).toBe(true);

    await act(async () => {
      await result.current[1].loadMore();
    });

    expect(result.current[0].data.map((d: any) => d.n)).toEqual([1, 2, 3]);
    expect(result.current[0].hasMore).toBe(false); // page 2 shorter than pageSize
  });

  it('does not loadMore without a lastDoc or when nothing more exists', async () => {
    mockGetDocs.mockResolvedValue(makeSnapshot([])); // empty first page -> no lastDoc
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true, pageSize: 5 })
    );

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    await act(async () => {
      await result.current[1].loadMore();
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(1); // no second call
  });

  it('refresh clears and reloads', async () => {
    mockGetDocs.mockResolvedValue(makeSnapshot([{ n: 'a' }]));
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true, pageSize: 20 })
    );

    await waitFor(() => expect(result.current[0].data).toHaveLength(1));

    mockGetDocs.mockResolvedValue(makeSnapshot([{ n: 'b' }, { n: 'c' }]));
    await act(async () => {
      await result.current[1].refresh();
    });

    expect(result.current[0].data.map((d: any) => d.n)).toEqual(['b', 'c']);
  });

  it('reset clears all state without fetching', async () => {
    mockGetDocs.mockResolvedValue(makeSnapshot([{ n: 'a' }]));
    const { result } = await renderHook(() =>
      useFirestorePagination(baseQuery, { autoLoad: true, pageSize: 20 })
    );

    await waitFor(() => expect(result.current[0].data).toHaveLength(1));
    await act(async () => { result.current[1].reset(); });

    expect(result.current[0].data).toEqual([]);
    expect(result.current[0].hasMore).toBe(true);
    expect(result.current[0].error).toBeNull();
  });

  it('handles a null baseQuery without crashing', async () => {
    const { result } = await renderHook(() => useFirestorePagination(null, { autoLoad: true }));
    expect(result.current[0].data).toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});
