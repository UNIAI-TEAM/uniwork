FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /repo

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

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @uniwork/web build

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
