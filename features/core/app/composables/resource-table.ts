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
  // Values to pick from instead of typing the filter
  items?: string[];
  // Searches the values to pick from, for columns with too many to list as items
  searchFn?: (search?: string) => Promise<string[]>;
}

// Column of a resource table, sortable or filterable only if the search accepts its ID as "orderBy" or "searchBy"
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
  rows: Readonly<ShallowRef<R[]>>;
  loading: Readonly<Ref<boolean>>;
  canLoadMore: ComputedRef<boolean>;
  // Stops the infinite scroll until the load is retried
  loadMoreFailed: Readonly<Ref<boolean>>;
  loadMore: () => Promise<void>;
  setOrder: (columnId: string, order: "asc" | "desc") => Promise<void>;
  setFilter: (columnId: string, value: string | string[]) => Promise<void>;
  addRow: (row: R) => void;
  replaceRow: (row: R) => void;
  removeRow: (row: R) => void;
}

export const useResourceTable = async <Q extends ResourceTableQuery, R extends { id: string }>(options: {
  // Unique in the application, as the tables with the same key share their first page
  key: string;
  query: Q;
  search: (query: Q) => Promise<{ rows: R[]; nextCursor?: Q["cursor"] }>;
}): Promise<ResourceTableState<Q, R>> => {
  const query = ref(options.query) as Ref<Q>;
  const rows = shallowRef<R[]>([]);
  const loading = ref<boolean>(false);
  const nextCursor = shallowRef<Q["cursor"]>();
  const loadMoreFailed = ref<boolean>(false);
  // Query of the rows shown, restored when a new query fails to load
  let loadedQuery = { ...options.query };
  let lastLoad = 0;

  const canLoadMore = computed(() => nextCursor.value != null && !loadMoreFailed.value && !loading.value);

  // Only the latest load applies its result or error
  const load = async (cursor?: Q["cursor"]): Promise<void> => {
    const current = ++lastLoad;
    const loadQuery = { ...query.value, cursor };
    try {
      loading.value = true;
      const result = await options.search(loadQuery);
      if (current !== lastLoad) {
        return;
      }
      if (cursor == null) {
        rows.value = result.rows;
        loadedQuery = loadQuery;
      } else {
        // A page can repeat rows that were created or updated after loading the previous ones
        const loaded = new Set(rows.value.map((row) => row.id));
        rows.value = rows.value.concat(result.rows.filter((row) => !loaded.has(row.id)));
      }
      nextCursor.value = result.nextCursor;
      loadMoreFailed.value = false;
    } catch (error) {
      if (current === lastLoad) {
        if (cursor == null) {
          query.value = { ...loadedQuery };
          throw error;
        }
        console.error("Failed to load the next rows of the table", error);
        loadMoreFailed.value = true;
      }
    } finally {
      if (current === lastLoad) {
        loading.value = false;
      }
    }
  };

  const loadMore = async (): Promise<void> => {
    if (nextCursor.value != null && !loading.value) {
      await load(nextCursor.value);
    }
  };

  const setOrder = (columnId: string, order: "asc" | "desc"): Promise<void> => {
    query.value.orderBy = columnId;
    query.value.order = order;
    return load();
  };

  const setFilter = (columnId: string, value: string | string[]): Promise<void> => {
    query.value.searchBy = columnId;
    query.value.search = value;
    return load();
  };

  const addRow = (row: R): void => {
    rows.value = [row, ...rows.value];
  };

  const replaceRow = (row: R): void => {
    rows.value = rows.value.map((r) => (r.id === row.id ? row : r));
  };

  const removeRow = (row: R): void => {
    rows.value = rows.value.filter((r) => r.id !== row.id);
  };

  const firstPage = await usePayloadData(`resource-table:${options.key}`, () => options.search({ ...query.value }));
  rows.value = firstPage?.rows ?? [];
  nextCursor.value = firstPage?.nextCursor;

  return {
    query,
    rows,
    loading,
    canLoadMore,
    loadMoreFailed,
    loadMore,
    setOrder,
    setFilter,
    addRow,
    replaceRow,
    removeRow,
  };
};
