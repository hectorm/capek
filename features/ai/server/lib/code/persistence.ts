import { promisify } from "node:util";
import { deflate, inflate } from "node:zlib";

import type { VFSSnapshot, VirtualFileSystem } from "#layers/ai/server/lib/code/vfs";
import type { AuthUser } from "#layers/core/server/lib/authn/strategies";
import { withUserTransaction } from "#layers/core/server/lib/database";
import { useLogger } from "#layers/core/server/lib/logger";

const logger = useLogger();

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const stored = new WeakMap<VirtualFileSystem, string>();

export async function loadSessionWorkspace(vfs: VirtualFileSystem, sessionId: string, user: AuthUser): Promise<void> {
  await withUserTransaction(user, async (trx) => {
    const row = await trx
      .selectFrom("aiChatSessionVfs")
      .select(["data"])
      .where("sessionId", "=", sessionId)
      .executeTakeFirst();

    if (!row) {
      return;
    }

    const decompressed = (await inflateAsync(row.data)).toString("utf8");
    const snapshot = JSON.parse(decompressed) as VFSSnapshot;

    for (const [path, file] of Object.entries(snapshot.files)) {
      vfs.writeFile(path, file.content, { readonly: file.readonly });
    }

    logger.debug({ sessionId, fileCount: Object.keys(snapshot.files).length }, "Session workspace loaded");
  });
  stored.set(vfs, JSON.stringify(vfs.getWorkspaceFiles()));
}

export async function saveSessionWorkspace(vfs: VirtualFileSystem, sessionId: string, user: AuthUser): Promise<void> {
  try {
    const snapshot = vfs.getWorkspaceFiles();
    const json = JSON.stringify(snapshot);
    if (json === stored.get(vfs)) {
      return;
    }

    if (Object.keys(snapshot.files).length === 0) {
      await withUserTransaction(user, async (trx) => {
        await trx.deleteFrom("aiChatSessionVfs").where("sessionId", "=", sessionId).execute();
      });
      stored.set(vfs, json);
      return;
    }

    const compressed = await deflateAsync(json);

    await withUserTransaction(user, async (trx) => {
      await trx
        .insertInto("aiChatSessionVfs")
        .values({
          sessionId,
          data: compressed,
          updatedAt: new Date(),
        })
        .onConflict((oc) => {
          return oc.column("sessionId").doUpdateSet({
            data: compressed,
            updatedAt: new Date(),
          });
        })
        .execute();
    });
    stored.set(vfs, json);

    logger.debug({ sessionId, fileCount: Object.keys(snapshot.files).length }, "Session workspace saved");
  } catch (error) {
    logger.warn({ sessionId, error }, "Failed to save session workspace, continuing without persistence");
  }
}
