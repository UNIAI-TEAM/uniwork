FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /repo

# packages/office-upstream runs its prepare script during pnpm install, and the
# vendored patch series is applied with `git apply` (build-upstream.mjs).
RUN apk add --no-cache git

# Next inlines NEXT_PUBLIC_* into the client bundle by literal substitution at
# BUILD time. Passing them as runtime `environment:` reaches the server render
# but never the browser, so the client would keep calling localhost. They have
# to be present here, before `next build` runs.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8080
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# The genoffice web builds pinned in apps/web/platform/office-frame/<module>.pin.json
# (docs/office/docs-web-frame.md). The build below runs with NODE_ENV=production, and
# apps/web/scripts/office-frame-sync.mjs --ensure installs all six modules (docs, pdf,
# markdown, html, slides, sheets) from the committed source.json (the public release
# tarball of the fork's dist-web root, sha256-checked) and fails the build when one
# is missing, so an image never ships without the editing UI. It needs no credential.
# OFFICE_FRAME_SOURCE is an optional override (an https URL or a .tar.gz); it is
# declared just before the build, after `pnpm install`, so it stays out of the install layer.

COPY . .
RUN pnpm install --frozen-lockfile
ARG OFFICE_FRAME_SOURCE=
# NODE_ENV only on this command: set earlier it would make `pnpm install` skip devDependencies.
RUN NODE_ENV=production pnpm --filter @uniwork/web build

FROM node:22-alpine
# Prepare pnpm as root so runtime (uid 1001) does not need to write /.cache.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /repo
COPY --from=build /repo .
# Belt-and-suspenders for any tool that still respects HOME.
ENV HOME=/tmp \
    COREPACK_HOME=/tmp/corepack \
    XDG_CACHE_HOME=/tmp/cache
EXPOSE 3000
CMD ["pnpm", "--filter", "@uniwork/web", "start"]
