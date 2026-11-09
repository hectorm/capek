import { groupRouter } from "#layers/core/server/trpc/routers/group";
import { roleRouter } from "#layers/core/server/trpc/routers/role";
import { settingsRouter } from "#layers/core/server/trpc/routers/settings";
import { userRouter } from "#layers/core/server/trpc/routers/user";

export const routers = {
  user: userRouter,
  group: groupRouter,
  role: roleRouter,
  settings: settingsRouter,
};
