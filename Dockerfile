FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

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

# Ensure devDependencies are installed during build (ignore any NODE_ENV=production from build args)
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Set production mode for runtime
ENV NODE_ENV=production

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install memory plugins (disabled by default, enabled via dashboard)
RUN pnpm exec openclaw plugins install @supermemory/openclaw-supermemory || echo "Supermemory plugin install skipped"
RUN pnpm exec openclaw plugins install @honcho-ai/openclaw-honcho || echo "Honcho plugin install skipped"

# Install sudo and grant passwordless sudo to node user
# This allows the agent to install packages at runtime while still running as non-root
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sudo jq && \
  echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/node && \
  chmod 0440 /etc/sudoers.d/node && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Create persistent data directories with correct ownership BEFORE declaring VOLUMEs
# This ensures the volume mount inherits the node user ownership
RUN mkdir -p /home/node/data /home/node/workspace && \
  chown -R node:node /home/node/data /home/node/workspace

# Declare persistent volumes for data and workspace
# Docker will create anonymous volumes that survive container recreation
VOLUME /home/node/data
VOLUME /home/node/workspace

# Add the pnpm bin directory to PATH so 'openclaw' command is available
# This allows the entrypoint script to run 'openclaw onboard' for auto-setup
ENV PATH="/app/node_modules/.bin:${PATH}"

# Security note: Run as non-root user with sudo access
# The node user (uid 1000) can escalate to root via sudo when needed
# This is a trade-off: more agent capability vs. increased attack surface within the container
USER node

# Use entrypoint for config generation (SaaS mode support)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command runs the gateway on port 18789
# --allow-unconfigured lets it start without pre-existing config
CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789", "--allow-unconfigured"]
