import type { ComputedRef, Ref, ShallowRef } from "vue";
import { computed, ref, shallowRef } from "vue";

import { usePayloadData } from "#layers/core/app/composables/payload-data";

export interface ResourceTableQuery {
  search?: string | string[];
  searchBy?: string;
  order?: "asc" | "desc";
  orderBy?: string;
  cursor?: unknown;
}

interface ResourceTableFilter {
  // Fixed choices for this filter
  items?: string[];
  // Searchable choices for columns with too many values to list
  searchFn?: (search?: string) => Promise<string[]>;
}

// Sortable and filterable column IDs must be valid orderBy and searchBy keys, respectively
export type ResourceTableColumn<Q extends ResourceTableQuery = ResourceTableQuery> = {
  class?: { th?: string; td?: string };
} & (
  | ({
      id: NonNullable<Q["orderBy"]> & NonNullable<Q["searchBy"]>;
      sortable?: boolean;
      filterable?: boolean;
    } & ResourceTableFilter)
  | { id: NonNullable<Q["orderBy"]>; sortable?: boolean; filterable?: false }
  | ({ id: NonNullable<Q["searchBy"]>; sortable?: false; filterable?: boolean } & ResourceTableFilter)
  | { id: string; sortable?: false; filterable?: false }
);

export interface ResourceTableState<Q extends ResourceTableQuery, R extends { id: string }> {
  query: Readonly<Ref<Q>>;
  loadedQuery: Readonly<ShallowRef<Q>>;
  rows: Readonly<ShallowRef<R[]>>;
  loading: Readonly<Ref<boolean>>;
  hasMore: ComputedRef<boolean>;
  canLoadMore: ComputedRef<boolean>;
  retry: Readonly<ShallowRef<(() => Promise<void>) | undefined>>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setOrder: (columnId: string, order: "asc" | "desc") => Promise<void>;
  setFilter: (columnId: string, value: string | string[]) => Promise<void>;
}

export const useResourceTable = async <Q extends ResourceTableQuery, R extends { id: string }>(options: {
  // Tables with the same key share their first page
  key: string;
  query: Q;
  search: (query: Q) => Promise<{ rows: R[]; nextCursor?: Q["cursor"] }>;
}): Promise<ResourceTableState<Q, R>> => {
  const query = ref(options.query) as Ref<Q>;
  const rows = shallowRef<R[]>([]);
  const loading = ref<boolean>(false);
  const nextCursor = shallowRef<Q["cursor"]>();
  const retry = shallowRef<() => Promise<void>>();
  // A failed first-page load restores the query for the visible rows
  const loadedQuery = shallowRef(options.query) as ShallowRef<Q>;
  let lastLoad = 0;

  const hasMore = computed(() => nextCursor.value != null);
  const canLoadMore = computed(() => hasMore.value && !retry.value && !loading.value);

  // Only the latest load applies its result or error
  const load = async (loadQuery: Q, cursor?: Q["cursor"]): Promise<void> => {
    const current = ++lastLoad;
    query.value = loadQuery;
    try {
      loading.value = true;
      const result = await options.search({ ...loadQuery, cursor });
      if (current !== lastLoad) {
        return;
      }
      if (cursor == null) {
        rows.value = result.rows;
        loadedQuery.value = loadQuery;
      } else {
        // Rows can move between pages after an insert or update
        const loaded = new Set(rows.value.map((row) => row.id));
        rows.value = rows.value.concat(result.rows.filter((row) => !loaded.has(row.id)));
      }
      nextCursor.value = result.nextCursor;
      retry.value = undefined;
    } catch (error) {
      if (current === lastLoad) {
        if (cursor == null) {
          query.value = loadedQuery.value;
        }
        console.error("Failed to load the rows of the table", error);
        retry.value = () => load(loadQuery, cursor);
      }
    } finally {
      if (current === lastLoad) {
        loading.value = false;
      }
    }
  };

  const loadMore = async (): Promise<void> => {
    if (canLoadMore.value) {
      await load(query.value, nextCursor.value);
    }
  };

  const setOrder = (columnId: string, order: "asc" | "desc"): Promise<void> => {
    return load({ ...query.value, orderBy: columnId, order });
  };

  const setFilter = (columnId: string, value: string | string[]): Promise<void> => {
    return load({ ...query.value, searchBy: columnId, search: value });
  };

  try {
    const firstPage = await usePayloadData(`resource-table:${options.key}`, () => options.search({ ...options.query }));
    rows.value = firstPage?.rows ?? [];
    nextCursor.value = firstPage?.nextCursor;
  } catch (error) {
    console.error("Failed to load the rows of the table", error);
    retry.value = () => load(options.query);
  }

  return {
    query,
    loadedQuery,
    rows,
    loading,
    hasMore,
    canLoadMore,
    retry,
    refresh: () => load(query.value),
    loadMore,
    setOrder,
    setFilter,
  };
};
