import type { JobPublisher, JobWorkerHost } from "@sapphire/adapter-kit";
import { ComposioConnector, IntegrationProviderSettings } from "@sapphire/adapters";
import { loadRootEnv } from "@sapphire/core/node/load-root-env";

loadRootEnv();

import {
  ChatSdkMessagingSurface,
  CodexCatalogCache,
  createBackgroundJobHandlers,
  createCloudAgentConnection,
  createConnectorStack,
  createJobReconciler,
  createMessagingContextLoader,
  createRunExecutor,
  createRunSandbox,
  createRunSecretWriter,
  createWebProvider,
  EncryptedSecretStore,
  ExpoPushProvider,
  InMemoryJobQueue,
  InstalledConnectorProvider,
  isComposioEnabled,
  isMessagingSurfaceEnabled,
  isPipedreamEnabled,
  CodingCliRuntime,
  LocalAgentHomeStore,
  LocalArtifactStore,
  localRuntimeSettingsPath,
  McpConnector,
  McpOAuthBroker,
  messagingEnvFromProcess,
  messagingPlatformsFromEnv,
  OpencodeRuntime,
  PiAgentRuntime,
  PipedreamConnector,
  PollingRealtimeFanout,
  pipedreamConfigFromEnv,
  readLocalRuntimeSettingsFile,
  reconcileCloudAgents,
  reconcileComputerUpdates,
  resolveDeploymentModel,
  resolvePiSessionRoot,
  resolveSandboxProvider,
  ScriptedAgentRuntime,
  SpaceMemoryProviderResolver,
  sandboxProviderOptionsFromEnv,
  SqliteJobQueue,
} from "@sapphire/adapters";
import { resolveEncryptionKey, resolveSupervisorToken } from "@sapphire/core";
import {
  createDb,
  createThreadEvents,
  parsePositiveInteger,
  sqliteDbFileFromDatabaseUrl,
} from "@sapphire/db";
import { SERVICE_NAMES } from "@sapphire/logging";
import { createRootLogger } from "@sapphire/logging/axiom";
import { MarkdownMemoryStore } from "@sapphire/memory";

const logger = createRootLogger(SERVICE_NAMES.worker);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  // SQLite: DATABASE_URL is a `file:` URL (or bare path) to the same db the API
  // opens. Prisma, the job queue and the realtime fanout all share that file.
  const dbFile = sqliteDbFileFromDatabaseUrl(databaseUrl) ?? databaseUrl;
  const { prisma } = createDb(dbFile);
  const realtime = new PollingRealtimeFanout({ path: dbFile });
  const secrets = new EncryptedSecretStore(resolveEncryptionKey(process.env));
  const events = createThreadEvents(prisma, realtime, {
    runSecretWriter: createRunSecretWriter(secrets),
  });
  const dataDir = process.env.DATA_DIR ?? "./data";
  const runtime =
    process.env.AGENT_RUNTIME === "scripted"
      ? new ScriptedAgentRuntime()
      : process.env.AGENT_RUNTIME === "opencode"
        ? new OpencodeRuntime({
            baseUrl: process.env.OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4096",
          })
        : new CodingCliRuntime({
            delegate: new PiAgentRuntime({ sessionRoot: resolvePiSessionRoot(dataDir) }),
          });
  // Same resolver the API uses, so both processes agree on provider, model and key.
  const { key: deploymentModelKey } = resolveDeploymentModel();
  // Electron-owned policy both processes read from the same schema; corrupt or
  // missing files fail closed to defaults (Docker fallback disabled).
  const runtimeSettingsPath = localRuntimeSettingsPath(process.env);
  const localRuntimeSettings = readLocalRuntimeSettingsFile(runtimeSettingsPath);
  const sandboxProvider = resolveSandboxProvider(process.env);
  logger.info("worker sandbox policy", {
    provider: sandboxProvider,
    packagedLocal: runtimeSettingsPath !== undefined,
    dockerFallback: localRuntimeSettings.allowDockerComputerFallback,
  });
  const sandbox = createRunSandbox(sandboxProvider, {
    ...sandboxProviderOptionsFromEnv(process.env),
    supervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    supervisorToken: sandboxProvider === "docker" ? resolveSupervisorToken(process.env) : undefined,
    requireExplicitSupervisorToken: runtimeSettingsPath !== undefined,
    dataDir,
    prisma,
  });
  const allowPrivateEndpoint = process.env.MCP_ALLOW_PRIVATE_ENDPOINT === "true";
  const mcpOAuth = new McpOAuthBroker(prisma, secrets, {}, allowPrivateEndpoint);
  const mcp = new McpConnector(
    prisma,
    secrets,
    {
      stdioEnabled: process.env.MCP_STDIO_ENABLED === "true",
      allowedCommands: (process.env.MCP_STDIO_ALLOWED_COMMANDS ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      events,
      allowPrivateEndpoint,
    },
    mcpOAuth,
  );
  const pipedreamConfig = pipedreamConfigFromEnv({
    pipedreamClientId: process.env.PIPEDREAM_CLIENT_ID,
    pipedreamClientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
    pipedreamProjectId: process.env.PIPEDREAM_PROJECT_ID,
    pipedreamEnvironment: process.env.PIPEDREAM_ENVIRONMENT,
    encryptionKey: resolveEncryptionKey(process.env),
  });
  const pipedream = isPipedreamEnabled(pipedreamConfig)
    ? new PipedreamConnector(pipedreamConfig)
    : undefined;
  // pollInboundMessages stays false (the default) here: this process
  // only ever sends outbound (messaging.deliver jobs). It must never poll
  // Telegram — that would steal the single getUpdates slot away from the
  // API process, which is the one with the inbound sink actually wired up.
  const messagingPlatforms = messagingPlatformsFromEnv(messagingEnvFromProcess(process.env));
  const messaging = isMessagingSurfaceEnabled(messagingPlatforms, {
    deploymentModelKey,
    openSignup: process.env.MESSAGING_OPEN_SIGNUP === "true",
  })
    ? new ChatSdkMessagingSurface(messagingPlatforms)
    : undefined;
  const integrationSettings = new IntegrationProviderSettings(
    prisma,
    secrets,
    resolveEncryptionKey(process.env),
    {
      composio: isComposioEnabled(process.env.COMPOSIO_API_KEY)
        ? new ComposioConnector(process.env.COMPOSIO_API_KEY)
        : undefined,
      pipedream,
    },
  );
  const stack = createConnectorStack(false, undefined, [
    new InstalledConnectorProvider(prisma, secrets, {}, allowPrivateEndpoint),
    ...integrationSettings.providers(),
    mcp,
  ]);
  const connector = stack.destination;
  await connector.start();
  integrationSettings.warmDirectories();
  const memoryProviders = new SpaceMemoryProviderResolver(prisma, secrets);
  const home = new LocalAgentHomeStore(dataDir);
  const artifacts = new LocalArtifactStore(dataDir);
  const inMemoryJobs = process.env.WAKEUP_DRIVER === "memory" ? new InMemoryJobQueue() : undefined;
  const jobs: JobPublisher & JobWorkerHost =
    inMemoryJobs ??
    new SqliteJobQueue({
      path: dbFile,
      concurrency: parsePositiveInteger(process.env.WAKEUP_CONCURRENCY, 4),
    });
  const jobHost: JobWorkerHost = jobs;
  // One provider instance so emulator launches and polls share the same Map.
  const cloudAgent = createCloudAgentConnection();
  // Shared with the reconciler so a stuck wait uses the same push path as a finish notice.
  const notifications = new ExpoPushProvider(dataDir);
  const executor = createRunExecutor({
    prisma,
    runtime,
    // Live per-account Codex catalog; never refreshes or writes credentials.
    codexCatalog: new CodexCatalogCache(),
    sandbox,
    memory: new MarkdownMemoryStore(prisma),
    memoryProviders,
    home,
    artifacts,
    connector: stack.connector,
    connectors: stack.connector,
    listConnectedPluginSlugs: async (userId) => {
      const provider = await integrationSettings.resolve("composio");
      if (!provider) return [];
      return provider.listConnectedExternalIds({
        userId,
        spaceId: "",
        operationId: "connections.sync",
        traceId: "connections.sync",
        signal: AbortSignal.timeout(15_000),
      });
    },
    secrets: [
      deploymentModelKey ?? "",
      process.env.COMPOSIO_API_KEY ?? "",
      process.env.CURSOR_API_KEY ?? "",
      process.env.TYPESAFE_API_KEY ?? "",
      process.env.E2B_API_KEY ?? "",
    ].filter(Boolean),
    secretStore: secrets,
    mcpAllowPrivateEndpoint: process.env.MCP_ALLOW_PRIVATE_ENDPOINT === "true",
    deploymentModelKey,
    dataDir,
    notifications,
    jobs,
    events,
    messaging: messaging ? createMessagingContextLoader(prisma) : undefined,
    web: createWebProvider(),
    cloudAgent,
  });

  const jobHandlers = createBackgroundJobHandlers({
    executor,
    prisma,
    sandbox,
    home,
    jobs,
    events,
    workerId: process.pid.toString(),
    runtime,
    secretStore: secrets,
    memoryProviders,
    deploymentModelKey,
    messaging,
    cloudAgent,
  });
  await jobHost.start(jobHandlers);
  const reconciler = createJobReconciler({
    prisma,
    jobs,
    events,
    notifications,
    reconcileCloudAgents: () => reconcileCloudAgents({ prisma, jobs, cloudAgent }),
    reconcileComputerUpdates: () => reconcileComputerUpdates({ prisma, jobs }),
  });
  reconciler.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await reconciler.stop();
      await jobHost.stop();
      await jobs.close();
      await realtime.close();
      await connector.stop();
      await mcp.close();
      await prisma.$disconnect().catch(() => undefined);
    } finally {
      await logger.flush({ timeoutMs: 2_000 });
    }
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  process.on("uncaughtException", (error) => {
    logger.error("uncaughtException", error);
    void stop().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", reason);
    void stop().finally(() => process.exit(1));
  });

  logger.info("worker ready");
}

main().catch(async (error) => {
  logger.error("worker startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
});
