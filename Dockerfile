# The web app (SvelteKit static build); only the gateway image serves it.
# Static assets are architecture-independent; build once natively, including for arm64 images.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS web-build
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
# No commit SHA here: it would change the web version (and re-prompt "Update ready") on server-only deploys.
# Without APP_VERSION the build versions itself from a hash of web/'s inputs.
ARG APP_VERSION
RUN APP_VERSION="${APP_VERSION}" bun run build

FROM oven/bun:1 AS tools

# git + openssh-client: simple-git's clone/fetch/push and the agent's own git use. Neither ships in the base image.
# poppler-utils: pdftotext/pdftoppm for the workspace documents skill.
# ripgrep: the workspace's history and session search.
# ffmpeg: bounded local decoding and silence-aware chunks for speech transcription.
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client git curl poppler-utils ripgrep ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# gh: the GitHub CLI, so a coding agent can open PRs itself (git push + gh pr create), authenticated
# by a GH_TOKEN in its shell. Static binary; TARGETARCH is set by Docker buildx.
ARG GH_VERSION=2.63.2
ARG TARGETARCH
RUN set -eu; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh"

# Headless browser for agents: Debian's chromium (built for both amd64 and arm64, unlike
# Chrome for Testing) driven by the agent-browser CLI. Static binary + its version-matched skill
# docs taken from the npm tarball, same TARGETARCH pattern as above.
ARG AGENT_BROWSER_VERSION=0.38.1
RUN set -eu; \
    apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH}" in \
      amd64) AB_ARCH=linux-x64 ;; \
      arm64) AB_ARCH=linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/agent-browser; \
    curl -fsSL "https://registry.npmjs.org/agent-browser/-/agent-browser-${AGENT_BROWSER_VERSION}.tgz" \
      | tar -xz -C /opt/agent-browser --strip-components=1 "package/bin/agent-browser-${AB_ARCH}" package/skill-data; \
    chmod 755 "/opt/agent-browser/bin/agent-browser-${AB_ARCH}"; \
    ln -s "/opt/agent-browser/bin/agent-browser-${AB_ARCH}" /usr/local/bin/agent-browser
# Containers need --no-sandbox (no user namespaces, root or not); Docker's 64MB /dev/shm crashes Chromium without the shm flag.
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    AGENT_BROWSER_SKILLS_DIR=/opt/agent-browser/skill-data \
    AGENT_BROWSER_ARGS="--no-sandbox,--disable-dev-shm-usage"

# Browser assets are versioned and downloaded during the build, never at first login.
ARG UBOL_VERSION=2026.1012.1545
ARG UBO_VERSION=1.75.0
ARG CAMOUFOX_VERSION=156.0.1-beta.36
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv unzip libgtk-3-0 libdbus-glib-1-2 libasound2 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/camoufox \
    && /opt/camoufox/bin/pip install --no-cache-dir camoufox==0.5.8 playwright==1.62.0 Pillow==12.2.0
RUN set -eu; \
    curl -fsSL -o /tmp/ubol.zip "https://github.com/uBlockOrigin/uBOL-home/releases/download/${UBOL_VERSION}/uBOLite_${UBOL_VERSION}.chromium.zip"; \
    echo '73909c8f26d608b00a99f446192630868bea4f947ba293c29bbd18ae948d903b  /tmp/ubol.zip' | sha256sum -c -; \
    unzip -q /tmp/ubol.zip -d /opt/ublock-lite; \
    curl -fsSL -o /tmp/ubo.zip "https://github.com/gorhill/uBlock/releases/download/${UBO_VERSION}/uBlock0_${UBO_VERSION}.firefox.signed.xpi"; \
    echo '5b74415860456370644bd80f16125e865b0e6c356bb5dfcfb84069967eaa5287  /tmp/ubo.zip' | sha256sum -c -; \
    unzip -q /tmp/ubo.zip -d /opt/ublock-origin; \
    case "${TARGETARCH}" in \
      amd64) CF_ARCH=x86_64; CF_SHA=72637885ee67c93466ad377831c647192f8f08fb5c6fd9279de1320b49dd2b53 ;; \
      arm64) CF_ARCH=arm64; CF_SHA=8b5fd083721c807ee2a752265683482477105052fa0e21739388b527ae067c15 ;; \
      *) exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/camoufox.zip "https://github.com/daijro/camoufox/releases/download/v${CAMOUFOX_VERSION}/camoufox-${CAMOUFOX_VERSION}-lin.${CF_ARCH}.zip"; \
    echo "$CF_SHA  /tmp/camoufox.zip" | sha256sum -c -; \
    unzip -q /tmp/camoufox.zip -d /opt/camoufox-browser -x 'fonts/M/*' 'fonts/W/*'; \
    chmod -R a+rX /opt/camoufox-browser /opt/ublock-lite /opt/ublock-origin; \
    chmod a+x /opt/camoufox-browser/camoufox; \
    rm /tmp/ubol.zip /tmp/ubo.zip /tmp/camoufox.zip
ENV AGENT_BROWSER_EXTENSIONS=/opt/ublock-lite
# Chromium compiles unpacked DNR rules into the extension's _metadata directory.
# Keep extension code read-only while allowing the workspace uid to build that cache.
RUN mkdir -p /opt/ublock-lite/_metadata \
    && chown -R 1000:1000 /opt/ublock-lite/_metadata
RUN apt-get update && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

# fpgen stores its model beside the package; fetch it before dropping root.
RUN /opt/camoufox/bin/python -c "from camoufox.fingerprints import generate_fingerprint; generate_fingerprint(os='linux')" \
    && chmod -R a+rX /opt/camoufox/lib/python*/site-packages/fpgen/data

WORKDIR /app

# Workspace: same toolchain, run as uid 1000 with user-space installs under HOME
# (apt stays root-only). Deployed as its own compose project, independent of the gateway.
# Tools and user setup come before the source copy, so a code-only change rebuilds just the app layers.
FROM tools AS workspace
RUN usermod -l agent -d /data/home bun && groupmod -n agent bun \
    && mkdir -p /data/home && chown -R agent:agent /data
ENV HOME=/data/home \
    BUN_INSTALL=/data/home/.bun \
    BUN_INSTALL_BIN=/data/home/.bun/bin \
    NPM_CONFIG_PREFIX=/data/home/.npm-global \
    PATH=/data/home/.bun/bin:/data/home/.local/bin:/data/home/.npm-global/bin:${PATH}
# `pi` CLI: the fallback `/login openai` path (the usual one is `!login chatgpt` from chat); it shares auth.json with the workspace via PI_CODING_AGENT_DIR.
# OPENAI_API_KEY is the OpenRouter key: Pi's openai provider would send it to api.openai.com.
RUN printf '%s\n' '#!/bin/sh' 'exec env -u OPENAI_API_KEY bun /app/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js "$@"' > /usr/local/bin/pi \
    && chmod 755 /usr/local/bin/pi
# `ws-runs`: the agent's read path to its own run index and session transcripts (redacted).
RUN printf '%s\n' '#!/bin/sh' 'exec bun /app/bin/ws-runs.ts "$@"' > /usr/local/bin/ws-runs \
    && chmod 755 /usr/local/bin/ws-runs
# `ws-consolidate`: queues a memory consolidation for the workspace's scheduler, or shows the last run.
RUN printf '%s\n' '#!/bin/sh' 'exec bun /app/bin/ws-consolidate.ts "$@"' > /usr/local/bin/ws-consolidate \
    && chmod 755 /usr/local/bin/ws-consolidate
# `ws-schedule`: lists the scheduled jobs, or queues a run of one for the workspace's scheduler.
RUN printf '%s\n' '#!/bin/sh' 'exec bun /app/bin/ws-schedule.ts "$@"' > /usr/local/bin/ws-schedule \
    && chmod 755 /usr/local/bin/ws-schedule
# Maps uses the workspace's private RPC bridge; the Google key stays on the gateway.
RUN printf '%s\n' '#!/bin/sh' 'exec bun /app/bin/maps.ts "$@"' > /usr/local/bin/maps \
    && chmod 755 /usr/local/bin/maps
# External file access uses the workspace's private RPC bridge; no NAS credentials in the CLI.
RUN printf '%s\n' '#!/bin/sh' 'exec bun /app/bin/external-files.ts "$@"' > /usr/local/bin/external-files \
    && chmod 755 /usr/local/bin/external-files
# Document extraction for the documents skill (PDF is poppler-utils, in base). pandoc: docx/odt/pptx/epub
# → markdown; upstream static build because Debian's is larger and can't read pptx. xlsx2csv: pandoc's
# xlsx reader fails or drops text cells on common files (e.g. openpyxl output).
RUN apt-get update && apt-get install -y --no-install-recommends xlsx2csv \
    && rm -rf /var/lib/apt/lists/*
ARG PANDOC_VERSION=3.11
ARG PANDOC_SHA256_amd64=37edb3bbcf722f921a009941bf5874e2e0c09263226c9b4a2d980788cb062ab6
ARG PANDOC_SHA256_arm64=56ed5566ec41d22ec9ee0704e6ac0b98ba102e92384efd5306173a22d314c79a
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) sum="$PANDOC_SHA256_amd64" ;; \
      arm64) sum="$PANDOC_SHA256_arm64" ;; \
      *) echo "unsupported TARGETARCH: '$TARGETARCH'" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/pandoc.tgz "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${TARGETARCH}.tar.gz"; \
    echo "$sum  /tmp/pandoc.tgz" | sha256sum -c -; \
    tar -xz -f /tmp/pandoc.tgz -C /usr/local/bin --strip-components=2 "pandoc-${PANDOC_VERSION}/bin/pandoc"; \
    rm /tmp/pandoc.tgz
COPY package.json bun.lock* ./
# Root's HOME, not the agent's: an install as root would leave root-owned dirs in /data/home.
RUN HOME=/root BUN_INSTALL=/root/.bun bun install --production --frozen-lockfile
COPY . .
USER agent
ENTRYPOINT ["./scripts/workspace-entrypoint.sh"]
CMD ["bun", "run", "workspace"]

# Default target: the gateway (web app server and workspace control plane).
FROM tools AS gateway
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile
COPY . .
RUN mkdir -p /data
# WEB_DEV_LOGIN is honoured only outside production, so the image must never default to dev.
ENV NODE_ENV=production
COPY --from=web-build /web/build /app/web/build
# Documentation only: the ORCH_PORT and WEB_PORT defaults.
EXPOSE 8788 8790
CMD ["bun", "src/personal.ts"]
