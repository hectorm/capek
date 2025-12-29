import pako from "pako";

import type { AuthUser } from "~~/server/lib/authn/strategies";
import type { VFSSnapshot, VirtualFileSystem } from "~~/server/lib/code/vfs";
import { withUserTransaction } from "~~/server/lib/database";
import { useLogger } from "~~/server/lib/logger";

const logger = useLogger();

export async function loadSessionWorkspace(vfs: VirtualFileSystem, sessionId: string, user: AuthUser): Promise<void> {
  try {
    await withUserTransaction(user, async (trx) => {
      const row = await trx
        .selectFrom("chatSessionVfs")
        .select(["data"])
        .where("sessionId", "=", sessionId)
        .executeTakeFirst();

      if (!row) {
        return;
      }

      const decompressed = pako.inflate(row.data, { to: "string" });
      const snapshot = JSON.parse(decompressed) as VFSSnapshot;

      for (const [path, file] of Object.entries(snapshot.files)) {
        vfs.writeFile(path, file.content, { readonly: file.readonly });
      }

      logger.debug({ sessionId, fileCount: Object.keys(snapshot.files).length }, "Session workspace loaded");
    });
  } catch (error) {
    logger.warn({ sessionId, error }, "Failed to load session workspace, continuing with empty workspace");
  }
}

export async function saveSessionWorkspace(vfs: VirtualFileSystem, sessionId: string, user: AuthUser): Promise<void> {
  try {
    const snapshot = vfs.getWorkspaceFiles();

    if (Object.keys(snapshot.files).length === 0) {
      return;
    }

    const json = JSON.stringify(snapshot);
    const compressed = Buffer.from(pako.deflate(json));

    await withUserTransaction(user, async (trx) => {
      await trx
        .insertInto("chatSessionVfs")
        .values({
          sessionId,
          data: compressed,
          updatedAt: new Date(),
        })
        .onConflict((oc) =>
          oc.column("sessionId").doUpdateSet({
            data: compressed,
            updatedAt: new Date(),
          }),
        )
        .execute();
    });

    logger.debug({ sessionId, fileCount: Object.keys(snapshot.files).length }, "Session workspace saved");
  } catch (error) {
    logger.warn({ sessionId, error }, "Failed to save session workspace, continuing without persistence");
  }
}
