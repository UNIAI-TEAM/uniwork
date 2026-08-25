FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @uniwork/web build

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo .
EXPOSE 3000
CMD ["pnpm", "--filter", "@uniwork/web", "start"]
