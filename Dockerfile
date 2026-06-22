##################################################
## "build" stage
##################################################

FROM mirror.gcr.io/node:24.17.0-trixie@sha256:45da69d4ea0231f68ffde2056f47044538a3658235118cecad8cdfcc6dc126a0 AS build

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
	pnpm run prepare && pnpm run build

##################################################
## "main" stage
##################################################

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:d3cda6e91129130d7229a1806b6a73d292ef245ab032da7851907798024cefba AS main

ENV NUXT_DATABASE_URL=file:///tmp/pglite

COPY --from=build --chown=0:0 /usr/local/bin/node /node
COPY --from=build --chown=0:0 /src/.output/ /capek/
COPY --from=build --chown=0:0 /src/bin/ /capek/server/bin/

WORKDIR /capek/server/

HEALTHCHECK --start-period=60s --start-interval=5s --interval=30s --timeout=5s --retries=2 \
	CMD ["/node", "/capek/server/bin/healthcheck.mjs", "http://localhost:3000"]

ENTRYPOINT ["/node", "/capek/server/bin/entrypoint.mjs", "/capek/server/index.mjs"]
