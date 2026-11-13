import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

import type { ResourceAccessTable } from "#layers/core/shared/schema";

export interface SourcesTable {
  id: ColumnType<string, string | undefined, never>;
  name: string;
  description: string;
  documentation: string | null;
  type: string;
  config: string;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export type Source = Selectable<SourcesTable>;
export type NewSource = Insertable<SourcesTable>;
export type SourceUpdate = Updateable<SourcesTable>;

export type SourceAccessTable = ResourceAccessTable<"sourceId">;
