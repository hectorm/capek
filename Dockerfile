##################################################
## "build" stage
##################################################

FROM docker.io/node:26.13.1-trixie@sha256:e18c3ccdf7d71619990b0e85639f506e2028a95410999cab24cc373cbd10e0ac AS build

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

ARG FEATURES=
RUN --network=none \
	--mount=type=cache,id=pnpm,dst=/pnpm/store/ \
	pnpm exec nuxt prepare && pnpm run build

##################################################
## "main" stage
##################################################

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS main

ENV NUXT_DATABASE_URL=file:///tmp/pglite

COPY --from=build --chown=0:0 /usr/local/bin/node /node
COPY --from=build --chown=0:0 /usr/lib/*-linux-gnu/libatomic.so.1 /usr/lib/
COPY --from=build --chown=0:0 /src/.output/ /app/
COPY --from=build --chown=0:0 /src/bin/ /app/server/bin/

WORKDIR /app/server/

HEALTHCHECK --start-period=60s --start-interval=5s --interval=30s --timeout=5s --retries=2 \
	CMD ["/node", "/app/server/bin/healthcheck.mjs", "http://localhost:3000"]

ENTRYPOINT ["/node", "/app/server/bin/entrypoint.mjs", "/app/server/index.mjs"]
