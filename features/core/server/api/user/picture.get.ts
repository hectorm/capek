import { createError, defineEventHandler, setHeader } from "h3";

import { fetchUserPicture, userPicturePath } from "#layers/core/server/lib/authn/picture";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({
      statusCode: 401,
      message: "Authentication required",
    });
  }

  if (!user.picture || !userPicturePath(user.picture)) {
    throw createError({
      statusCode: 404,
      message: "Not Found",
    });
  }

  try {
    const picture = await fetchUserPicture(user.picture);

    setHeader(event, "Content-Type", picture.mimeType);
    setHeader(event, "Cache-Control", "private, max-age=86400");

    return picture.data;
  } catch (error) {
    event.context.logger.warn({ userId: user.id, error }, "Failed to load the picture of the user");
    throw createError({
      statusCode: 502,
      message: "The picture could not be loaded",
    });
  }
});
