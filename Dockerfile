##################################################
## "build" stage
##################################################

FROM mirror.gcr.io/node:24.22.2-trixie@sha256:5c6e2e57d7dd6652ce6f087ba0328312059d7c77f93baa8751865dbf103f1acb AS build

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NITRO_PRESET=node_cluster

RUN npm install --global corepack@latest
RUN corepack enable

WORKDIR /src/

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /src/

RUN --mount=type=cache,id=pnpm,dst=/pnpm/store/ \
	pnpm install --frozen-lockfile --ignore-scripts

COPY ./ /src/

RUN --network=none \
	--mount=type=cache,id=pnpm,dst=/pnpm/store/ \
	pnpm exec nuxt prepare && pnpm run build

##################################################
## "main" stage
##################################################

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cc66d222f0a7ec996b78a99fe76a969bc80b539a5016ad866c14d1949bc6d0ab AS main

ENV NUXT_DATABASE_URL=file:///tmp/pglite

COPY --from=build --chown=0:0 /usr/local/bin/node /node
COPY --from=build --chown=0:0 /src/.output/ /capek/
COPY --from=build --chown=0:0 /src/bin/ /capek/server/bin/

WORKDIR /capek/server/

HEALTHCHECK --start-period=60s --start-interval=5s --interval=30s --timeout=5s --retries=2 \
	CMD ["/node", "/capek/server/bin/healthcheck.mjs", "http://localhost:3000"]

ENTRYPOINT ["/node", "/capek/server/bin/entrypoint.mjs", "/capek/server/index.mjs"]
