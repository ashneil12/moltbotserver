import fs from 'node:fs';
import path from 'node:path';

/**
 * Generates the default openclaw.json configuration for fresh deployments.
 * This was extracted from docker-entrypoint.sh to prevent bash quoting errors
 * and allow for easier cherry-picking from upstream.
 */
function generateConfig() {
  const env = process.env;
  
  const configDir = env.OPENCLAW_STATE_DIR || env.MOLTBOT_STATE_DIR || env.CLAWDBOT_STATE_DIR || '/home/node/.clawdbot';
  const workspaceDir = env.OPENCLAW_WORKSPACE_DIR || env.CLAWDBOT_WORKSPACE_DIR || '/home/node/workspace';
  const gatewayToken = env.OPENCLAW_GATEWAY_TOKEN || env.CLAWDBOT_GATEWAY_TOKEN || '';
  const gatewayBind = env.OPENCLAW_BIND || env.CLAWDBOT_BIND || 'lan';
  const gatewayPort = parseInt(env.OPENCLAW_GATEWAY_PORT || env.CLAWDBOT_GATEWAY_PORT || env.PORT || '18789', 10);
  
  const defaultModel = env.OPENCLAW_DEFAULT_MODEL || env.OPENCLAW_ONBOARD_MODEL || env.MOLTBOT_DEFAULT_MODEL || '';
  const subagentModel = env.OPENCLAW_SUBAGENT_MODEL || 'deepseek/deepseek-reasoner';
  const heartbeatModel = env.OPENCLAW_HEARTBEAT_MODEL || env.HEARTBEAT_MODEL || defaultModel;
  const heartbeatInterval = env.OPENCLAW_HEARTBEAT_INTERVAL || '15m';
  
  const maxConcurrent = parseInt(env.OPENCLAW_MAX_CONCURRENT || '4', 10);
  const subagentMaxConcurrent = parseInt(env.OPENCLAW_SUBAGENT_MAX_CONCURRENT || '8', 10);
  
  const aiGatewayUrl = env.OPENCLAW_AI_GATEWAY_URL || '';
  
  const fallbackModelsRaw = env.OPENCLAW_FALLBACK_MODELS || '';
  const fallbackModels = fallbackModelsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  let allowedOrigins = ['http://localhost:3000'];
  const originsEnv = env.OPENCLAW_ALLOW_IFRAME_ORIGINS || '';
  if (originsEnv) {
    const origins = new Set(allowedOrigins);
    for (const o of originsEnv.split(',').map(s => s.trim()).filter(Boolean)) {
      origins.add(o);
    }
    allowedOrigins = [...origins];
  }

  const config = {
    gateway: {
      mode: 'local',
      port: gatewayPort,
      bind: gatewayBind,
      trustedProxies: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'],
      controlUi: {
        enabled: true,
        dangerouslyDisableDeviceAuth: true,
        dangerouslyAllowHostHeaderOriginFallback: true,
        allowedOrigins,
      },
      auth: {
        mode: 'token',
        token: gatewayToken,
      },
    },
    logging: { redactSensitive: 'tools' },
    memory: {
      backend: 'builtin',
      citations: 'auto',
    },
    agents: {
      defaults: {
        workspace: workspaceDir,
        model: {
          primary: defaultModel,
          fallbacks: fallbackModels,
        },
        compaction: {
          memoryFlush: {
            enabled: true,
            softThresholdTokens: 4000,
            systemPrompt: 'Session nearing compaction. Write any important context to WORKING.md and memory files now.',
            prompt: 'Before context compaction, update WORKING.md with current task state and write any lasting notes to memory/YYYY-MM-DD.md. Reply with NO_REPLY if nothing to store.',
          },
        },
        contextPruning: {
          mode: 'cache-ttl',
          ttl: '30m',
          keepLastAssistants: 3,
        },
        memorySearch: {
          provider: 'gemini',
          model: 'gemini-embedding-2-preview',
          experimental: { sessionMemory: true },
          sources: ['memory', 'sessions'],
        },
        subagents: {
          model: subagentModel,
          maxConcurrent: subagentMaxConcurrent,
        },
        heartbeat: {
          every: heartbeatInterval,
          prompt: 'HEARTBEAT CHECK — You MUST complete ALL steps below. DO NOT SKIP ANY STEP.\n\nMANDATORY FILE READS (use the read tool for EACH of these, every single heartbeat):\n\nSTEP 1: READ ~/workspace/WORKING.md — In-progress task? Continue it. Stalled/blocked?\nSTEP 2: READ ~/workspace/memory/self-review.md — Check last 7 days for MISS tags. If match: counter-check protocol.\nSTEP 3: READ ~/workspace/HEARTBEAT.md — Scheduled tasks due? Errors? Urgent items?\n\nCRITICAL: Even if a file was empty last time, you MUST read it again. Files change between heartbeats. Skipping reads means missing information. You are REQUIRED to make 3 separate read calls before responding.\n\nSTEP 4: RESPONSE (only after steps 1-3): Nothing → HEARTBEAT_OK. User attention needed → brief message (one line max).\n\nNEVER message for: routine status, still running, low-priority completions.',
          model: heartbeatModel,
        },
        maxConcurrent,
        bootstrapTotalMaxChars: 155000,
      },
      messages: {
        queue: {
          mode: 'collect',
        },
      },
    },
  };

  if (aiGatewayUrl) {
    console.log(`[generate-config] Credits mode detected - configuring vercel-ai-gateway provider via: ${aiGatewayUrl}`);
    config.models = {
      mode: 'merge',
      providers: {
        'vercel-ai-gateway': {
          baseUrl: `${aiGatewayUrl}/api/gateway`,
          apiKey: gatewayToken,
          models: [],
        },
      },
    };
  }

  const configFile = path.join(configDir, 'openclaw.json');
  console.log(`[generate-config] Generating openclaw.json configuration at ${configFile}...`);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  
  // Enforce security permissions
  try {
    fs.chmodSync(configDir, 0o700);
    fs.chmodSync(configFile, 0o600);
  } catch (err) {
    console.warn(`[generate-config] Warning: could not set permissions on config file/dir: ${err.message}`);
  }
}

generateConfig();
