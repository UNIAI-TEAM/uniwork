# Cursor Cloud Agent base image: the toolchain and services that
# .github/workflows/ci.yml provides, so a cloud agent can run the same checks.
# Versions follow ci.yml (NODE_VERSION, GO_VERSION, PNPM_VERSION, service
# images); bump them together. Services run as plain processes started by
# .cursor/cloud/start.sh, not as nested Docker containers.

# MinIO has no Docker Hub image any more (minio/minio was removed); take the
# static server and client binaries from the same frozen build CI uses.
FROM bitnamilegacy/minio:2025.7.23 AS minio

FROM ubuntu:24.04

ARG GO_VERSION=1.27.0
ARG NODE_MAJOR=22
ARG PNPM_VERSION=10.28.2
ARG PLAYWRIGHT_VERSION=1.62.1

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    TZ=Asia/Ho_Chi_Minh

# Postgres 16 and Redis 7 are the noble packages, matching CI's
# postgres:16-alpine and redis:7-alpine. postgresql-contrib carries pg_trgm
# (migration 134).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg sudo make jq unzip xz-utils \
      build-essential tzdata procps lsof \
      postgresql-16 postgresql-contrib-16 redis-server \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz

RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g "pnpm@${PNPM_VERSION}" \
 && rm -rf /var/lib/apt/lists/*

# Chromium's system libraries for the Playwright suite; the browser itself is
# downloaded per user by .cursor/cloud/install.sh.
RUN npx -y "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=minio /opt/bitnami/minio/bin/minio /usr/local/bin/minio
COPY --from=minio /opt/bitnami/minio-client/bin/mc /usr/local/bin/mc

# The agent works as the image's stock non-root user with passwordless sudo,
# so start.sh can start the system services.
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
 && chmod 0440 /etc/sudoers.d/ubuntu \
 && mkdir -p /var/lib/minio && chown ubuntu:ubuntu /var/lib/minio

USER ubuntu
ENV PATH=/usr/local/go/bin:/home/ubuntu/go/bin:$PATH
WORKDIR /home/ubuntu
