# UniWork Office engine service (G2-02). Build from the repository root:
#   docker build -f apps/office-engine/Dockerfile -t uniwork-office-engine .
# The image carries everything the service runs: the bundled service, the
# worker entry and (when G2-04/G2-05 land) the native sidecars those lanes add
# to the runtime stage. It never reaches an external Office/OCR service: a
# failed job is a typed error, not a fallback call.

FROM node:22.23.2-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /repo
# Manifests first so the dependency layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/office-engine/package.json apps/office-engine/
COPY packages/office-contracts/package.json packages/office-contracts/
COPY packages/office-engine/package.json packages/office-engine/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@uniwork/office-engine-app..." --filter uniwork
COPY packages/office-contracts packages/office-contracts
COPY packages/office-engine/src packages/office-engine/src
COPY packages/tsconfig packages/tsconfig
COPY apps/office-engine/src apps/office-engine/src
COPY apps/office-engine/scripts apps/office-engine/scripts
RUN node apps/office-engine/scripts/build.mjs

FROM node:22.23.2-bookworm-slim
ENV NODE_ENV=production \
    OFFICE_ENGINE_HOST=0.0.0.0 \
    OFFICE_ENGINE_PORT=8090 \
    OFFICE_ENGINE_TEMP_DIR=/tmp/uniwork-office-engine
WORKDIR /app
COPY --from=build /repo/apps/office-engine/dist/ ./
# The service runs unprivileged; its only writable place is the job temp root.
USER node
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.OFFICE_ENGINE_PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Exec form so SIGTERM reaches main.mjs, which drains and kills every worker
# tree before exiting. Run with an init (compose: init: true) to reap orphans.
CMD ["node", "main.mjs"]
