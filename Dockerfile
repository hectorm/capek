##################################################
## "build" stage
##################################################

FROM mirror.gcr.io/node:24.22.2-trixie@sha256:8c761eca2bf7eec965f946cf47b8090143cb41f45f2f8699af0cc0298d2d2d19 AS build

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

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1 AS main

ENV NUXT_DATABASE_URL=file:///tmp/pglite

COPY --from=build --chown=0:0 /usr/local/bin/node /node
COPY --from=build --chown=0:0 /src/.output/ /capek/
COPY --from=build --chown=0:0 /src/bin/ /capek/server/bin/

WORKDIR /capek/server/

HEALTHCHECK --start-period=60s --start-interval=5s --interval=30s --timeout=5s --retries=2 \
	CMD ["/node", "/capek/server/bin/healthcheck.mjs", "http://localhost:3000"]

ENTRYPOINT ["/node", "/capek/server/bin/entrypoint.mjs", "/capek/server/index.mjs"]
