FROM node:22-bookworm

# Install Bun (required for build scripts and QMD)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install QMD (local hybrid search: BM25 + vector + reranking for memory)
# GGUF models (~2GB) are auto-downloaded at runtime on first query, not at build time
RUN bun install -g github:tobi/qmd
# Copy the FULL QMD package + Bun binary to shared locations so the non-root
# 'node' user can execute them.  The old approach only copied the `qmd` bash
# wrapper which then couldn't find its src/qmd.ts or the bun runtime.
RUN QMD_SRC="/root/.bun/install/global/node_modules/@tobilu/qmd" \
  && if [ ! -d "$QMD_SRC" ]; then QMD_SRC="/root/.bun/install/global/node_modules/qmd"; fi \
  && cp -r "$QMD_SRC" /opt/qmd \
  && cd /opt/qmd && bun install sqlite-vec-linux-x64 \
  && npm install --no-save tsx @types/node \
  && npx tsc -p tsconfig.build.json || true \
  && chmod -R a+rX /opt/qmd \
  && ln -sf /opt/qmd/qmd /usr/local/bin/qmd \
  && cp /root/.bun/bin/bun /usr/local/bin/bun \
  && chmod 755 /usr/local/bin/bun /usr/local/bin/qmd

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
  apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
  fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts
COPY SOUL.md ./SOUL.md
COPY OPERATIONS.md ./OPERATIONS.md
COPY PRACTICAL.md ./PRACTICAL.md
COPY memory-hygiene.md ./memory-hygiene.md
COPY ACIP_SECURITY.md ./ACIP_SECURITY.md
COPY HEARTBEAT.md ./HEARTBEAT.md
COPY IDENTITY.md ./IDENTITY.md
COPY BOOTSTRAP.md ./BOOTSTRAP.md
COPY WORKING.md ./WORKING.md
COPY templates/ ./templates/

# Ensure devDependencies are installed during build (ignore any NODE_ENV=production from build args)
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build



# Set production mode for runtime
ENV NODE_ENV=production

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install jq (needed by entrypoint config patching)
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Create persistent data directories
RUN mkdir -p /home/node/data /home/node/workspace

# Declare persistent volumes for data and workspace
# Docker will create anonymous volumes that survive container recreation
VOLUME /home/node/data
VOLUME /home/node/workspace

# Add pnpm bin to PATH so 'openclaw' command is available
# qmd + bun are in /usr/local/bin (copied during build), accessible to all users
ENV PATH="/app/node_modules/.bin:${PATH}"

# Create a stable symlink for the openclaw CLI in /usr/local/bin
# The ENV PATH above gets reset by login shells (sh -lc) which the agent's exec
# tool uses, so /app/node_modules/.bin isn't reliably in PATH at runtime.
# /usr/local/bin is always in PATH regardless of shell type.
RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw

# Pre-install ClawdHub CLI so the agent doesn't need to install at runtime
RUN npm i -g clawdhub

# Honcho memory plugin is installed at runtime by the entrypoint when HONCHO_API_KEY
# is set. Build-time install was removed because the plugin installs to /root/.clawdbot/
# during build, but runtime discovery uses OPENCLAW_STATE_DIR (/home/node/data/),
# creating a path mismatch that causes gateway crash loops.

# Run as root — each instance is isolated on its own Hetzner VM,
# so root only increases blast radius within the container itself.
# This eliminates permission issues for package installs, file access, etc.

# Use entrypoint for config generation (SaaS mode support)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command runs the gateway on port 18789
# --allow-unconfigured lets it start without pre-existing config
CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789", "--allow-unconfigured"]
