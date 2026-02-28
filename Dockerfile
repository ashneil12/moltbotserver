FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

# Pre-download pnpm via corepack with retries (npm registry returns 403 transiently on GH Actions)
RUN for i in 1 2 3 4 5; do corepack prepare pnpm@10.23.0 --activate && break || echo "Retry $i..." && sleep $((i * 5)); done

WORKDIR /app
RUN chown node:node /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
  apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
  fi

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node ui/package.json ./ui/package.json
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts

USER node
# Reduce OOM risk on low-memory hosts during dependency installation.
# Docker builds on small VMs may otherwise fail with "Killed" (exit 137).
# Retry loop guards against transient npm registry 403s on GH Actions.
RUN for i in 1 2 3 4 5; do NODE_OPTIONS=--max-old-space-size=2048 pnpm install --frozen-lockfile && break || echo "pnpm install retry $i..." && sleep $((i * 10)); done

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
USER root
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
  apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
  mkdir -p /home/node/.cache/ms-playwright && \
  PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
  node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
  chown -R node:node /home/node/.cache/ms-playwright && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
  fi

USER node
COPY --chown=node:node . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Expose the CLI binary without requiring npm global writes as non-root.
USER root
RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw \
  && chmod 755 /app/openclaw.mjs

ENV NODE_ENV=production

# Make our custom entrypoint executable
RUN chmod +x /app/docker-entrypoint.sh

# Pre-bake Honcho memory plugin into the image.
# Installing at build time (as root) ensures correct uid=0 ownership.
# The entrypoint copies it to the data volume on startup, avoiding the
# runtime npm install that creates files with uid=1000 (rejected by the
# plugin scanner as "suspicious ownership").
RUN mkdir -p /app/prebaked-plugins \
  && cd /tmp \
  && npm pack @honcho-ai/openclaw-honcho 2>/dev/null \
  && tar xzf honcho-ai-openclaw-honcho-*.tgz \
  && mv package /app/prebaked-plugins/openclaw-honcho \
  && cd /app/prebaked-plugins/openclaw-honcho \
  && npm install --omit=dev --ignore-scripts 2>/dev/null \
  && rm -rf /tmp/honcho-ai-openclaw-honcho-*.tgz /tmp/package

# Run entrypoint as root — the gateway process stays root for Docker socket access,
# npm global installs, and Honcho plugin ownership (uid=0 required by plugin scanner).
USER root

# Our custom entrypoint handles config generation, onboarding, model
# enforcement, security file deployment, and permission fixes.
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Start gateway server with default config.
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
