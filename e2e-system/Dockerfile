# The e2e-system stack in Linux, for hosts where 127.0.0.2/.3/.5 don't route to loopback (macOS without
# aliases). launch.ts builds it with the Playwright and Bun versions the repo pins, then mounts the repo.
ARG PLAYWRIGHT_VERSION=1.63.0
# Ships Chromium and its system libraries for exactly this Playwright version.
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG BUN_VERSION=1.4.2
# As in CI: the workspace runs history/search with ripgrep; it commits its home with git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ripgrep git unzip ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
  && ln -s /root/.bun/bin/bunx /usr/local/bin/bunx \
  && bun --version
WORKDIR /repo
