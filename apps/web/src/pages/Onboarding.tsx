import { CheckIcon as Check, CopyIcon as Copy } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  type CodingCliStatus,
  cloudflareGatewayRouting,
  type IntegrationSetupState,
  isCodingCliProviderId,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  type ThinkingLevel,
} from "@sapphire/contracts";
import { clampCatalogThinkingLevel, pickCatalogModelId } from "@sapphire/core";
import {
  Button,
  Input,
  RakazoMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sapphire/ui-web";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";
import { CodingAgentPicker } from "../components/models/CodingAgentPicker";
import { useCopyText } from "../lib/copy-text";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";
import { WindowChrome } from "./WindowChrome";

const DEFAULT_THINKING_LEVEL_OPTION = "__rakazo_default_thinking__";
const FIRST_BOT_NAME = "Chief";
const FIRST_BOT_SPAWN_KEY = "onboarding:first";
const FIRST_BOT_LOCK = "rakazo:onboarding-first-bot";

/** Survives StrictMode remounts; concurrent first-bot creates share one in-flight attempt. */
let firstBotEnsure: Promise<{ id: string }> | null = null;

function findFirstBot(
  bots: Array<{ id: string; name: string; spawnKey: string | null }>,
): { id: string } | undefined {
  const bySpawnKey = bots.find((bot) => bot.spawnKey === FIRST_BOT_SPAWN_KEY);
  if (bySpawnKey) return { id: bySpawnKey.id };
  // Legacy first-run Chief created before spawnKey was set.
  const byName = bots.find((bot) => bot.name === FIRST_BOT_NAME);
  return byName ? { id: byName.id } : undefined;
}

async function createOrReuseFirstBot(): Promise<{ id: string }> {
  const existing = await rpc.bots.list();
  const reuse = findFirstBot(existing);
  if (reuse) return reuse;
  try {
    const created = await rpc.bots.create({
      name: FIRST_BOT_NAME,
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
      spawnKey: FIRST_BOT_SPAWN_KEY,
    });
    return { id: created.id };
  } catch (error) {
    // Another tab won the unique (spaceId, spawnKey) race; reuse that bot only.
    const afterConflict = await rpc.bots.list();
    const winner = afterConflict.find((bot) => bot.spawnKey === FIRST_BOT_SPAWN_KEY);
    if (winner) return { id: winner.id };
    throw error;
  }
}

async function withFirstBotLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request(FIRST_BOT_LOCK, run);
}

async function ensureFirstBot(): Promise<{ id: string }> {
  if (firstBotEnsure) return firstBotEnsure;
  // Web Lock serializes cross-tab creates; module promise covers same-tab StrictMode.
  // spawnKey makes create idempotent when locks are unavailable.
  // Clear after settle so a later empty-space visit re-lists instead of reusing a deleted id.
  firstBotEnsure = withFirstBotLock(createOrReuseFirstBot).finally(() => {
    firstBotEnsure = null;
  });
  return firstBotEnsure;
}

function providerLabel(entry: ModelCatalogEntry): string {
  return entry.provider === "openai-codex" ? "ChatGPT" : (entry.providerName ?? entry.provider);
}

function nextStepAfterModel(needsIntegrationSetup: boolean): "integrations" | "bot" {
  return needsIntegrationSetup ? "integrations" : "bot";
}

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  const [step, setStep] = useState<"loading" | "model" | "integrations" | "bot">("loading");
  const [integrationSetup, setIntegrationSetup] = useState<IntegrationSetupState | null>(null);
  const needsIntegrationSetup = integrationSetup?.needsSetup ?? false;
  const [integrationServers, setIntegrationServers] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | null>(null);
  const [mode, setMode] = useState<"agents" | "catalog">("agents");
  const [agentStatuses, setAgentStatuses] = useState<CodingCliStatus[] | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const createStartedRef = useRef(false);
  const deploymentDefaultModelRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [codeCopied, copyOAuthCode] = useCopyText();

  const {
    oauth,
    pasteCode,
    setPasteCode,
    oauthPending,
    popupBlocked,
    cancelOAuthAttempt,
    startSubscriptionSignIn,
    submitOAuthCode,
  } = useModelOAuthSignIn({
    onClearError: () => setError(null),
    onError: setError,
    onFinished: async () => {
      // OAuth connect ignores thinkingLevel; persist the staged catalog choice.
      const level = clampCatalogThinkingLevel(
        thinkingLevel,
        catalog.find((entry) => entry.provider === provider && entry.id === modelId)
          ?.thinkingLevels,
      );
      if (level && provider !== OPENAI_COMPATIBLE_PROVIDER_ID && modelId) {
        try {
          await rpc.models.setDefault({ provider, modelId, thinkingLevel: level as ThinkingLevel });
        } catch {
          // The connection itself succeeded; the effort stays adjustable in Models.
        }
      }
      setStep(nextStepAfterModel(needsIntegrationSetup));
    },
  });

  useEffect(() => {
    void Promise.all([
      rpc.me(),
      rpc.models.list().catch(() => []),
      rpc.integrationSetup.get().catch(() => null),
    ])
      .then(([me, models, integrations]) => {
        setIntegrationSetup(integrations);
        setCatalog(models);
        deploymentDefaultModelRef.current = me.defaultModel;
        const preferred =
          models.find(
            (entry) => entry.provider === me.defaultProvider && entry.id === me.defaultModel,
          ) ??
          models.find((entry) => entry.provider === me.defaultProvider) ??
          models[0];
        if (preferred) {
          setProvider(preferred.provider);
          setModelId(preferred.provider === OPENAI_COMPATIBLE_PROVIDER_ID ? "" : preferred.id);
        }
        setStep(me.needsModel ? "model" : integrations?.needsSetup ? "integrations" : "bot");
      })
      .catch(() => setStep("bot"));
  }, []);

  // Coding-agent availability loads with the model step.
  useEffect(() => {
    if (step !== "model") return;
    rpc.models
      .codingCliStatus()
      .then(setAgentStatuses)
      .catch(() => setAgentStatuses([]));
  }, [step]);

  const providers = useMemo(() => {
    const seen = new Map<string, ModelCatalogEntry>();
    for (const entry of catalog) {
      // Coding agents and custom servers live outside the API catalog view.
      if (isCodingCliProviderId(entry.provider)) continue;
      if (entry.provider === OPENAI_COMPATIBLE_PROVIDER_ID) continue;
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry);
    }
    return [...seen.values()];
  }, [catalog]);

  const modelsForProvider = useMemo(
    () => catalog.filter((entry) => entry.provider === provider),
    [catalog, provider],
  );

  const selected = modelsForProvider.find((entry) => entry.id === modelId) ?? modelsForProvider[0];
  const isCloudflareGateway = provider === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID;
  const cloudflareRoutingReady =
    !isCloudflareGateway || cloudflareGatewayRouting({ accountId, gatewayId }) !== undefined;
  // Effort levels for the staged catalog model — "off" stays out, matching the
  // model settings and per-bot Thinking pickers.
  const catalogThinkingLevels = selected
    ? (selected.thinkingLevels ?? []).filter((level) => level !== "off")
    : [];
  const subscriptionSignIn = selected?.signIn !== undefined;
  const acceptsKey = selected?.auth !== "oauth";
  const signInLabel = selected?.oauthLabel ?? t`Sign in`;
  const canSaveModel = Boolean(
    selected &&
      modelId.trim() &&
      !oauthPending &&
      cloudflareRoutingReady &&
      acceptsKey &&
      apiKey.trim(),
  );
  const selectedAgentStatus = agentStatuses?.find((entry) => entry.provider === selectedAgent);
  const canContinueAgent =
    Boolean(selectedAgentStatus?.installed && selectedAgentStatus?.signedIn) && !agentBusy;
  // Base UI Select.Value only resolves labels when Root gets `items`.
  const providerItems = useMemo(
    () => providers.map((entry) => ({ value: entry.provider, label: providerLabel(entry) })),
    [providers],
  );
  const modelItems = useMemo(
    () => modelsForProvider.map((entry) => ({ value: entry.id, label: entry.label })),
    [modelsForProvider],
  );
  const thinkingLevelItems = useMemo(
    () => [
      {
        value: DEFAULT_THINKING_LEVEL_OPTION,
        label: t`Default (${thinkingLevelLabel("medium")})`,
      },
      ...catalogThinkingLevels.map((level) => ({ value: level, label: thinkingLevelLabel(level) })),
    ],
    [catalogThinkingLevels, t],
  );
  function updateApiKey(nextApiKey: string) {
    setApiKey(nextApiKey);
  }

  function selectProvider(nextProvider: string) {
    if (nextProvider === provider) return;
    cancelOAuthAttempt();
    setProvider(nextProvider);
    setApiKey("");
    setAccountId("");
    setGatewayId("");
    setModelId(pickCatalogModelId(catalog, nextProvider, deploymentDefaultModelRef.current));
    setThinkingLevel(null);
    setError(null);
    setNotice(null);
  }

  function stagedThinkingLevel(): ThinkingLevel | null {
    return clampCatalogThinkingLevel(
      thinkingLevel,
      selected?.thinkingLevels,
    ) as ThinkingLevel | null;
  }

  async function connectCodingAgent(agentProvider: string) {
    setAgentBusy(true);
    setError(null);
    try {
      await rpc.models.connect({ provider: agentProvider, modelId: "default" });
      setStep(nextStepAfterModel(needsIntegrationSetup));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not connect this coding agent`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function saveModel() {
    if (!canSaveModel) return;
    setError(null);
    try {
      if (apiKey) {
        await rpc.models.connect({
          provider,
          apiKey,
          ...(isCloudflareGateway
            ? { accountId: accountId.trim(), gatewayId: gatewayId.trim() }
            : {}),
          modelId,
          thinkingLevel: stagedThinkingLevel(),
          label: selected?.providerName ?? provider,
        });
      }
      // Catalog providers keep the staged effort on the saved model preference.
      const level = stagedThinkingLevel();
      if (level && modelId) {
        await rpc.models.setDefault({ provider, modelId, thinkingLevel: level });
      }
      setStep(nextStepAfterModel(needsIntegrationSetup));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save model`);
    }
  }

  function beginSelectedSubscriptionSignIn() {
    if (!selected?.id) return;
    void startSubscriptionSignIn({
      provider: selected.provider,
      modelId: selected.id,
      thinkingLevel: clampCatalogThinkingLevel(
        thinkingLevel,
        selected.thinkingLevels,
      ) as ThinkingLevel | null,
      label: selected.providerName ?? selected.provider,
    });
  }

  async function createFirstBot() {
    if (createStartedRef.current) return;
    createStartedRef.current = true;
    setError(null);
    try {
      const bot = await ensureFirstBot();
      for (const serverId of integrationServers) {
        await rpc.mcp.assignments.approve({ botId: bot.id, serverId });
      }
      // Onboarding continues conversationally in the thread: greeting first,
      // then the focus choice (immediate for the first bot).
      const started = await rpc.onboarding
        .start({ botId: bot.id })
        .then(() => true)
        .catch(() => false);
      if (started) {
        await rpc.onboarding.promptFocus({ botId: bot.id }).catch(() => undefined);
      }
      navigate(`/app/${bot.id}`);
    } catch (err) {
      createStartedRef.current = false;
      setError(err instanceof Error ? err.message : t`Could not create your bot`);
    }
  }

  useEffect(() => {
    if (step !== "bot") return;
    void createFirstBot();
  }, [step]);

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="app-drag flex items-center gap-3 px-5 py-[18px]">
        <WindowChrome />
        <RakazoMark className="app-no-drag text-foreground" size={20} />
      </div>
      <div className="mx-auto w-full max-w-[560px] px-6 pb-12">
        {step === "loading" ? (
          <p className="text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : null}
        {step === "model" ? (
          <div>
            <h1 className="text-[32px] font-normal text-foreground">
              <Trans>Connect a model</Trans>
            </h1>
            {mode === "agents" ? (
              <>
                <div className="mt-8">
                  <CodingAgentPicker
                    statuses={agentStatuses}
                    connectedProviders={[]}
                    selected={selectedAgent}
                    onSelect={setSelectedAgent}
                  />
                </div>
                {selectedAgentStatus?.installed && !selectedAgentStatus.signedIn ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {selectedAgentStatus.loginHint}
                  </p>
                ) : null}
                <div className="mt-6 flex gap-3">
                  <Button
                    disabled={!canContinueAgent}
                    onClick={() => {
                      if (selectedAgent) void connectCodingAgent(selectedAgent);
                    }}
                  >
                    {agentBusy ? <Trans>Connecting…</Trans> : <Trans>Continue</Trans>}
                  </Button>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-4 px-0 text-muted-foreground"
                  onClick={() => setMode("catalog")}
                >
                  <Trans>Use subscription or API models instead</Trans>
                </Button>
              </>
            ) : (
              <>
                <div className="mt-8 block text-sm font-normal text-foreground">
                  <span>
                    <Trans>Provider</Trans>
                  </span>
                  <Select
                    value={provider}
                    onValueChange={(value) => {
                      if (typeof value !== "string" || !value) return;
                      selectProvider(value);
                    }}
                    items={providerItems}
                  >
                    <SelectTrigger aria-label={t`Provider`} className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((entry) => (
                        <SelectItem key={entry.provider} value={entry.provider}>
                          {providerLabel(entry)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-6 block text-sm text-foreground">
                  <span className="font-normal">
                    <Trans>Model</Trans>
                  </span>
                  <Select
                    value={selected?.id ?? modelId}
                    onValueChange={(value) => {
                      if (typeof value !== "string" || !value) return;
                      if (value === modelId) return;
                      cancelOAuthAttempt();
                      setModelId(value);
                      setThinkingLevel(null);
                    }}
                    items={modelItems}
                  >
                    <SelectTrigger aria-label={t`Model`} className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsForProvider.map((entry) => (
                        <SelectItem key={`${entry.provider}:${entry.id}`} value={entry.id}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {catalogThinkingLevels.length ? (
                    <div className="mt-4 block">
                      <span className="font-normal">
                        <Trans>Thinking</Trans>
                      </span>
                      <Select
                        value={thinkingLevel ?? DEFAULT_THINKING_LEVEL_OPTION}
                        onValueChange={(value) => {
                          const next = String(value);
                          setThinkingLevel(
                            next === DEFAULT_THINKING_LEVEL_OPTION ? null : (next as ThinkingLevel),
                          );
                        }}
                        items={thinkingLevelItems}
                      >
                        <SelectTrigger aria-label={t`Thinking`} className="mt-2 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_THINKING_LEVEL_OPTION}>
                            {t`Default (${thinkingLevelLabel("medium")})`}
                          </SelectItem>
                          {catalogThinkingLevels.map((level) => (
                            <SelectItem key={level} value={level}>
                              {thinkingLevelLabel(level)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
                {subscriptionSignIn ? (
                  <div className="mt-4">
                    {oauth ? (
                      <div className="rounded-lg border border-border px-3.5 py-3">
                        {oauth.mode === "auth-url" ? (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {popupBlocked ? (
                                <Trans>
                                  Open{" "}
                                  <a
                                    href={oauth.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-foreground underline"
                                  >
                                    {new URL(oauth.verificationUri).hostname}
                                  </a>{" "}
                                  to finish signing in.
                                </Trans>
                              ) : (
                                <Trans>
                                  Finish signing in at{" "}
                                  <a
                                    href={oauth.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-foreground underline"
                                  >
                                    {new URL(oauth.verificationUri).hostname}
                                  </a>
                                  . The final page may not load; paste its URL or code here.
                                </Trans>
                              )}
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <Input
                                value={pasteCode}
                                onChange={(e) => setPasteCode(e.target.value)}
                                aria-label={t`Authorization code or callback URL`}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="http://localhost:53692/callback?code=…"
                              />
                              <Button
                                disabled={!pasteCode.trim()}
                                onClick={() => void submitOAuthCode()}
                              >
                                <Trans>Submit</Trans>
                              </Button>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              <Plural
                                value={Math.ceil(oauth.expiresInSeconds / 60)}
                                one="Waiting for sign-in — the link expires in about # minute."
                                other="Waiting for sign-in — the link expires in about # minutes."
                              />
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {popupBlocked ? (
                                <Trans>
                                  Open{" "}
                                  <a
                                    href={oauth.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-foreground underline"
                                  >
                                    {oauth.verificationUri.replace(/^https:\/\//, "")}
                                  </a>{" "}
                                  and enter this code:
                                </Trans>
                              ) : (
                                <Trans>
                                  A sign-in tab opened at{" "}
                                  <a
                                    href={oauth.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-foreground underline"
                                  >
                                    {oauth.verificationUri.replace(/^https:\/\//, "")}
                                  </a>
                                  . Enter this code there — this window keeps waiting:
                                </Trans>
                              )}
                            </p>
                            <div className="mt-2 flex items-center gap-3">
                              <p className="font-mono text-[22px] tracking-[0.2em] text-foreground">
                                {oauth.userCode}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => copyOAuthCode(oauth.userCode)}
                              >
                                {codeCopied ? (
                                  <HugeiconsIcon
                                    icon={Check}
                                    size={14}
                                    strokeWidth={1.8}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <HugeiconsIcon
                                    icon={Copy}
                                    size={14}
                                    strokeWidth={1.8}
                                    aria-hidden="true"
                                  />
                                )}
                                {codeCopied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
                              </Button>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              <Plural
                                value={Math.ceil(oauth.expiresInSeconds / 60)}
                                one="Waiting for sign-in — the code expires in about # minute."
                                other="Waiting for sign-in — the code expires in about # minutes."
                              />
                            </p>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 -ml-2 text-muted-foreground"
                          onClick={() => cancelOAuthAttempt()}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      </div>
                    ) : (
                      <Button
                        disabled={oauthPending}
                        onClick={() => beginSelectedSubscriptionSignIn()}
                      >
                        {oauthPending ? <Trans>Starting…</Trans> : signInLabel}
                      </Button>
                    )}
                  </div>
                ) : null}
                {isCloudflareGateway && acceptsKey ? (
                  <div className="mt-4 grid gap-4">
                    <label
                      htmlFor={`${fieldId}-account-id`}
                      className="block text-sm font-normal text-foreground"
                    >
                      <Trans>Account ID</Trans>
                      <Input
                        id={`${fieldId}-account-id`}
                        value={accountId}
                        onChange={(event) => setAccountId(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2"
                      />
                    </label>
                    <label
                      htmlFor={`${fieldId}-gateway-id`}
                      className="block text-sm font-normal text-foreground"
                    >
                      <Trans>Gateway ID</Trans>
                      <Input
                        id={`${fieldId}-gateway-id`}
                        value={gatewayId}
                        onChange={(event) => setGatewayId(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2"
                      />
                    </label>
                  </div>
                ) : null}
                {acceptsKey ? (
                  <label
                    htmlFor={`${fieldId}-api-key`}
                    className="mt-4 block text-sm font-normal text-foreground"
                  >
                    {subscriptionSignIn ? (
                      <Trans>Or paste an API key</Trans>
                    ) : (
                      <Trans>API key</Trans>
                    )}
                    <Input
                      id={`${fieldId}-api-key`}
                      value={apiKey}
                      onChange={(e) => updateApiKey(e.target.value)}
                      placeholder="sk-…"
                      type="password"
                      autoComplete="new-password"
                      className="mt-2"
                    />
                  </label>
                ) : null}
                {notice ? <p className="mt-3 text-sm text-success">{notice}</p> : null}
                {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
                <div className="mt-6 flex gap-3">
                  <Button disabled={!canSaveModel} onClick={() => void saveModel()}>
                    <Trans>Continue</Trans>
                  </Button>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-4 px-0 text-muted-foreground"
                  onClick={() => setMode("agents")}
                >
                  <Trans>Use coding agents instead</Trans>
                </Button>
              </>
            )}
          </div>
        ) : null}
        {step === "integrations" ? (
          <IntegrationSetup
            serverSetup
            initialState={integrationSetup}
            onDone={() => setStep("bot")}
            onServerConnected={(id) =>
              setIntegrationServers((current) => [...new Set([...current, id])])
            }
          />
        ) : null}
        {step === "bot" ? (
          <div>
            {error ? (
              <div>
                <p className="text-sm text-destructive">{error}</p>
                <Button className="mt-4" onClick={() => void createFirstBot()}>
                  <Trans>Try again</Trans>
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                <Trans>Opening chat…</Trans>
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
