-- CreateTable
CREATE TABLE "ai_data_consents" (
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "spaceId", "recipientKey"),
    CONSTRAINT "ai_data_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_data_consents_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_data_consents_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members" ("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "avatarStyle" TEXT NOT NULL DEFAULT 'robot'
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" DATETIME NOT NULL,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "action_approval_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_approval_rules_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_approval_rules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_auto_review_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "action_auto_review_preferences_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_auto_review_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletingAt" DATETIME,
    "deletionClaimId" TEXT,
    CONSTRAINT "spaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "spaces_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "space_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "space_members_spaceId_organizationId_fkey" FOREIGN KEY ("spaceId", "organizationId") REFERENCES "spaces" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "space_members_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "member" ("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,
    CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deployment_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "ownerUserId" TEXT,
    "signupsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "signupAllowlist" TEXT NOT NULL DEFAULT '',
    "signupPolicyInitialized" BOOLEAN NOT NULL DEFAULT false,
    "defaultModelProvider" TEXT,
    "defaultModelId" TEXT,
    "deploymentModelCredentialCipher" TEXT,
    "computerHost" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_model_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "supportsImages" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_model_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_voice_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_voice_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "space_model_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "modelId" TEXT,
    "thinkingLevel" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "space_model_preferences_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members" ("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "space_model_preferences_credentialId_userId_fkey" FOREIGN KEY ("credentialId", "userId") REFERENCES "user_model_credentials" ("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "space_voice_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL DEFAULT '',
    "speechModel" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "space_voice_preferences_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members" ("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "space_voice_preferences_credentialId_userId_fkey" FOREIGN KEY ("credentialId", "userId") REFERENCES "user_voice_credentials" ("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bots" (
    "screenGeneration" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL,
    "notifyOnFinish" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sectionId" TEXT,
    "archivedAt" DATETIME,
    "parentBotId" TEXT,
    "spawnKey" TEXT,
    "memoryScope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "computerId" TEXT,
    "computerSwitching" BOOLEAN NOT NULL DEFAULT false,
    "voiceId" TEXT,
    "autoSpeak" BOOLEAN NOT NULL DEFAULT false,
    "modelProvider" TEXT,
    "modelId" TEXT,
    "thinkingLevel" TEXT,
    "webhookSecretId" TEXT,
    "teamChatAmbientEnabled" BOOLEAN NOT NULL DEFAULT false,
    "teamChatRules" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "bots_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bots_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "bot_sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bots_parentBotId_fkey" FOREIGN KEY ("parentBotId") REFERENCES "bots" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bots_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_sections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bot_sections_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_sections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_deletions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "memoriesPreserved" BOOLEAN NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_deletions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sectionId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chat_groups_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_groups_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "bot_sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_group_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_group_members_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT,
    "groupId" TEXT,
    "externalConversationId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextEventSeq" INTEGER NOT NULL DEFAULT 0,
    "nextMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "historyCompactedUpToSeq" INTEGER,
    "historyCompactionSummary" TEXT,
    "historyCompactionGeneration" INTEGER NOT NULL DEFAULT 0,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "threads_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "threads_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "threads_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "threads_externalConversationId_fkey" FOREIGN KEY ("externalConversationId") REFERENCES "external_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "botId" TEXT,
    "replyToMessageId" TEXT,
    "replyQuote" TEXT,
    "runId" TEXT,
    "clientNonce" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "events_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "modelProvider" TEXT,
    "modelId" TEXT,
    "error" TEXT,
    "leaseOwner" TEXT,
    "leaseFence" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" DATETIME,
    "checkpoint" TEXT,
    "clientNonce" TEXT,
    "sourceMessageId" TEXT,
    "routineId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "botOutcomeReturnedAt" DATETIME,
    "messagingMirroredAt" DATETIME,
    "teamChatMirroredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "runs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "runs_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "steering_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "originTrigger" TEXT,
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "steering_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "steering_messages_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "steering_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "fence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "attempts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cloud_agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationKey" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "remoteId" TEXT,
    "latestRunId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "url" TEXT NOT NULL DEFAULT '',
    "branch" TEXT,
    "prUrl" TEXT,
    "launchRequest" JSONB NOT NULL,
    "launchDispatched" BOOLEAN NOT NULL DEFAULT false,
    "followup" JSONB,
    "followupDispatching" BOOLEAN NOT NULL DEFAULT false,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "wakeGeneration" INTEGER NOT NULL DEFAULT -1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "nextPollAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "external_effects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB,
    "reviewDecision" TEXT,
    "reviewReason" TEXT,
    "reviewModel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "external_effects_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_effects_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "routines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "crons" TEXT NOT NULL DEFAULT '[]',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "githubEnabled" BOOLEAN NOT NULL DEFAULT false,
    "messageProvider" TEXT,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "routines_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routines_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "routines_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scratchpad_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scratchpad_items_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "scratchpad_items_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "taught_skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "playbook" JSONB NOT NULL DEFAULT '{}',
    "recording" JSONB NOT NULL DEFAULT '{"events":[],"snapshots":[]}',
    "startedAt" DATETIME,
    "expiresAt" DATETIME,
    "stoppedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "taught_skills_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "taught_skills_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_skills_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL DEFAULT 'composio',
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "secretId" TEXT,
    "providerRef" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "capability_installs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT,
    "digest" TEXT,
    "secretId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_installs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memory_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "scope" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memory_documents_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memory_documents_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memory_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "sourceThreadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memory_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "memory_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_homes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'empty',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_homes_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_homes_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "browser_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "browser_profiles_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "browser_profiles_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "computer_updates" (
    "action" TEXT NOT NULL DEFAULT 'update',
    "id" TEXT NOT NULL PRIMARY KEY,
    "computerId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'preparing',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "computer_updates_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "computers" (
    "screenGeneration" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'team',
    "scopeKey" TEXT NOT NULL,
    "homeKey" TEXT NOT NULL,
    "homeRevision" TEXT NOT NULL DEFAULT 'empty',
    "kind" TEXT NOT NULL,
    "providerRef" TEXT,
    "state" TEXT NOT NULL DEFAULT 'stopped',
    "controlHolder" TEXT NOT NULL DEFAULT 'none',
    "controlLeaseId" TEXT,
    "controlLeaseExpiresAt" DATETIME,
    "controlBotId" TEXT,
    "controlRunId" TEXT,
    "controlFence" INTEGER NOT NULL DEFAULT 0,
    "executionRunId" TEXT,
    "executionBotId" TEXT,
    "executionLeaseExpiresAt" DATETIME,
    "executionFence" INTEGER NOT NULL DEFAULT 0,
    "screenUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "maintenanceId" TEXT,
    CONSTRAINT "computers_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "computer_execution_leases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "computerId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "computer_execution_leases_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT,
    "groupId" TEXT,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rootArtifactId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "artifacts_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "artifacts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_rootArtifactId_fkey" FOREIGN KEY ("rootArtifactId") REFERENCES "artifacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_records_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "finish" BOOLEAN NOT NULL DEFAULT true,
    "help" BOOLEAN NOT NULL DEFAULT true,
    "takeover" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "notification_preferences_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "space_memory_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "secretId" TEXT NOT NULL,
    "defaultMemoryScope" TEXT NOT NULL DEFAULT 'isolated',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "space_memory_configs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "space_memory_configs_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "secrets_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "transport" TEXT NOT NULL,
    "endpoint" TEXT,
    "command" TEXT,
    "args" JSONB NOT NULL DEFAULT '[]',
    "env" JSONB NOT NULL DEFAULT '{}',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "secretId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "mcp_servers_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mcp_servers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mcp_servers_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mcp_oauth_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "oauthCiphertext" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_sessions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mcp_oauth_sessions_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "mcp_servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bot_mcp_servers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allowAllTools" BOOLEAN NOT NULL DEFAULT true,
    "allowedTools" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bot_mcp_servers_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_mcp_servers_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_mcp_servers_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "mcp_servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messaging_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "dmThreadId" TEXT,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "verifiedAt" DATETIME,
    "lastInboundAt" DATETIME,
    "outboundSinceInbound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "messaging_identities_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messaging_channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "name" TEXT,
    "introPostedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "messaging_channel_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "identityId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "messaging_channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "messaging_channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messaging_link_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "messaging_outbound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identityId" TEXT,
    "threadId" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "providerHandle" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agent_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterBotId" TEXT NOT NULL,
    "targetBotId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "bot_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "auth" JSONB NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bot_secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_secrets_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_secrets_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "displayName" TEXT,
    "participantNames" TEXT NOT NULL DEFAULT '[]',
    "teamChatAmbientEnabled" BOOLEAN,
    "teamChatRules" TEXT,
    "automatedSenderPolicies" JSONB NOT NULL DEFAULT '{}',
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "external_conversations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_conversations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalConversationId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'direct',
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderIsBot" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "replyThreadId" TEXT,
    "batchContext" TEXT,
    "engagementReason" TEXT,
    "judgedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "runId" TEXT,
    "threadMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "providerReplyHandle" TEXT,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "external_messages_externalConversationId_fkey" FOREIGN KEY ("externalConversationId") REFERENCES "external_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "external_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "external_messages_threadMessageId_fkey" FOREIGN KEY ("threadMessageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_secrets_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_secrets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_secrets_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integration_provider_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "action_approval_rules_spaceId_createdByUserId_idx" ON "action_approval_rules"("spaceId", "createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "action_approval_rules_spaceId_createdByUserId_effect_matchKind_matchValue_key" ON "action_approval_rules"("spaceId", "createdByUserId", "effect", "matchKind", "matchValue");

-- CreateIndex
CREATE UNIQUE INDEX "action_auto_review_preferences_spaceId_userId_key" ON "action_auto_review_preferences"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_userId_key" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "spaces_organizationId_createdAt_idx" ON "spaces"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "spaces_createdByUserId_idx" ON "spaces"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_id_organizationId_key" ON "spaces"("id", "organizationId");

-- CreateIndex
CREATE INDEX "space_members_organizationId_userId_idx" ON "space_members"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "space_members_userId_createdAt_idx" ON "space_members"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "space_members_spaceId_userId_key" ON "space_members"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "user_model_credentials_userId_provider_updatedAt_idx" ON "user_model_credentials"("userId", "provider", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_model_credentials_id_userId_key" ON "user_model_credentials"("id", "userId");

-- CreateIndex
CREATE INDEX "user_voice_credentials_userId_provider_updatedAt_idx" ON "user_voice_credentials"("userId", "provider", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_voice_credentials_id_userId_key" ON "user_voice_credentials"("id", "userId");

-- CreateIndex
CREATE INDEX "space_model_preferences_spaceId_userId_isDefault_updatedAt_idx" ON "space_model_preferences"("spaceId", "userId", "isDefault", "updatedAt");

-- CreateIndex
CREATE INDEX "space_model_preferences_credentialId_idx" ON "space_model_preferences"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "space_model_preferences_spaceId_userId_credentialId_key" ON "space_model_preferences"("spaceId", "userId", "credentialId");

-- CreateIndex
CREATE INDEX "space_voice_preferences_spaceId_userId_isDefault_updatedAt_idx" ON "space_voice_preferences"("spaceId", "userId", "isDefault", "updatedAt");

-- CreateIndex
CREATE INDEX "space_voice_preferences_credentialId_idx" ON "space_voice_preferences"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "space_voice_preferences_spaceId_userId_credentialId_key" ON "space_voice_preferences"("spaceId", "userId", "credentialId");

-- CreateIndex
CREATE INDEX "bots_spaceId_userId_archivedAt_pinned_updatedAt_idx" ON "bots"("spaceId", "userId", "archivedAt", "pinned", "updatedAt");

-- CreateIndex
CREATE INDEX "bots_sectionId_idx" ON "bots"("sectionId");

-- CreateIndex
CREATE INDEX "bots_computerId_idx" ON "bots"("computerId");

-- CreateIndex
CREATE INDEX "bots_parentBotId_idx" ON "bots"("parentBotId");

-- CreateIndex
CREATE UNIQUE INDEX "bots_spaceId_spawnKey_key" ON "bots"("spaceId", "spawnKey");

-- CreateIndex
CREATE INDEX "bot_sections_spaceId_userId_position_createdAt_idx" ON "bot_sections"("spaceId", "userId", "position", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bot_sections_spaceId_userId_name_key" ON "bot_sections"("spaceId", "userId", "name");

-- CreateIndex
CREATE INDEX "bot_deletions_spaceId_deletedAt_idx" ON "bot_deletions"("spaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "chat_groups_spaceId_userId_archivedAt_pinned_updatedAt_idx" ON "chat_groups"("spaceId", "userId", "archivedAt", "pinned", "updatedAt");

-- CreateIndex
CREATE INDEX "chat_groups_sectionId_idx" ON "chat_groups"("sectionId");

-- CreateIndex
CREATE INDEX "chat_group_members_botId_idx" ON "chat_group_members"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_group_members_groupId_botId_key" ON "chat_group_members"("groupId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "threads_botId_key" ON "threads"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "threads_groupId_key" ON "threads"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "threads_externalConversationId_key" ON "threads"("externalConversationId");

-- CreateIndex
CREATE INDEX "threads_spaceId_idx" ON "threads"("spaceId");

-- CreateIndex
CREATE INDEX "messages_threadId_seq_idx" ON "messages"("threadId", "seq");

-- CreateIndex
CREATE INDEX "messages_replyToMessageId_idx" ON "messages"("replyToMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_threadId_seq_key" ON "messages"("threadId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_threadId_clientNonce_key" ON "messages"("threadId", "clientNonce");

-- CreateIndex
CREATE INDEX "events_spaceId_createdAt_idx" ON "events"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "events_threadId_seq_idx" ON "events"("threadId", "seq");

-- CreateIndex
CREATE INDEX "events_runId_type_seq_idx" ON "events"("runId", "type", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "events_threadId_seq_key" ON "events"("threadId", "seq");

-- CreateIndex
CREATE INDEX "tasks_spaceId_botId_idx" ON "tasks"("spaceId", "botId");

-- CreateIndex
CREATE INDEX "runs_status_leaseExpiresAt_idx" ON "runs"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "runs_status_updatedAt_id_idx" ON "runs"("status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "runs_botOutcomeReturnedAt_status_idx" ON "runs"("botOutcomeReturnedAt", "status");

-- CreateIndex
CREATE INDEX "runs_trigger_status_messagingMirroredAt_updatedAt_idx" ON "runs"("trigger", "status", "messagingMirroredAt", "updatedAt");

-- CreateIndex
CREATE INDEX "runs_trigger_status_teamChatMirroredAt_updatedAt_idx" ON "runs"("trigger", "status", "teamChatMirroredAt", "updatedAt");

-- CreateIndex
CREATE INDEX "runs_spaceId_botId_idx" ON "runs"("spaceId", "botId");

-- CreateIndex
CREATE INDEX "runs_sourceMessageId_idx" ON "runs"("sourceMessageId");

-- CreateIndex
CREATE INDEX "runs_threadId_status_createdAt_idx" ON "runs"("threadId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "runs_routineId_idx" ON "runs"("routineId");

-- CreateIndex
CREATE UNIQUE INDEX "runs_spaceId_clientNonce_key" ON "runs"("spaceId", "clientNonce");

-- CreateIndex
CREATE INDEX "steering_messages_botId_runId_createdAt_idx" ON "steering_messages"("botId", "runId", "createdAt");

-- CreateIndex
CREATE INDEX "steering_messages_runId_idx" ON "steering_messages"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "steering_messages_messageId_botId_key" ON "steering_messages"("messageId", "botId");

-- CreateIndex
CREATE INDEX "attempts_runId_idx" ON "attempts"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_agents_operationKey_key" ON "cloud_agents"("operationKey");

-- CreateIndex
CREATE INDEX "cloud_agents_providerKey_nextPollAt_idx" ON "cloud_agents"("providerKey", "nextPollAt");

-- CreateIndex
CREATE INDEX "cloud_agents_spaceId_userId_id_idx" ON "cloud_agents"("spaceId", "userId", "id");

-- CreateIndex
CREATE INDEX "external_effects_runId_status_idx" ON "external_effects"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_effects_idempotencyKey_key" ON "external_effects"("idempotencyKey");

-- CreateIndex
CREATE INDEX "routines_active_nextRunAt_idx" ON "routines"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "routines_spaceId_botId_idx" ON "routines"("spaceId", "botId");

-- CreateIndex
CREATE INDEX "scratchpad_items_spaceId_botId_status_idx" ON "scratchpad_items"("spaceId", "botId", "status");

-- CreateIndex
CREATE INDEX "scratchpad_items_spaceId_botId_updatedAt_idx" ON "scratchpad_items"("spaceId", "botId", "updatedAt");

-- CreateIndex
CREATE INDEX "taught_skills_spaceId_botId_idx" ON "taught_skills"("spaceId", "botId");

-- CreateIndex
CREATE INDEX "taught_skills_spaceId_botId_status_idx" ON "taught_skills"("spaceId", "botId", "status");

-- CreateIndex
CREATE INDEX "agent_skills_spaceId_userId_idx" ON "agent_skills"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "connections_spaceId_userId_connectorId_idx" ON "connections"("spaceId", "userId", "connectorId");

-- CreateIndex
CREATE INDEX "capability_installs_spaceId_userId_idx" ON "capability_installs"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "memory_documents_spaceId_userId_idx" ON "memory_documents"("spaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_documents_spaceId_scope_botId_path_key" ON "memory_documents"("spaceId", "scope", "botId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "memory_revisions_documentId_revision_key" ON "memory_revisions"("documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "agent_homes_botId_key" ON "agent_homes"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "browser_profiles_botId_key" ON "browser_profiles"("botId");

-- CreateIndex
CREATE INDEX "computer_updates_computerId_createdAt_idx" ON "computer_updates"("computerId", "createdAt");

-- CreateIndex
CREATE INDEX "computer_updates_status_updatedAt_idx" ON "computer_updates"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "computers_scopeKey_key" ON "computers"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "computers_homeKey_key" ON "computers"("homeKey");

-- CreateIndex
CREATE INDEX "computers_spaceId_scope_idx" ON "computers"("spaceId", "scope");

-- CreateIndex
CREATE INDEX "computer_execution_leases_runId_idx" ON "computer_execution_leases"("runId");

-- CreateIndex
CREATE INDEX "computer_execution_leases_computerId_expiresAt_idx" ON "computer_execution_leases"("computerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "computer_execution_leases_computerId_botId_key" ON "computer_execution_leases"("computerId", "botId");

-- CreateIndex
CREATE INDEX "artifacts_spaceId_botId_idx" ON "artifacts"("spaceId", "botId");

-- CreateIndex
CREATE INDEX "artifacts_groupId_idx" ON "artifacts"("groupId");

-- CreateIndex
CREATE INDEX "artifacts_rootArtifactId_idx" ON "artifacts"("rootArtifactId");

-- CreateIndex
CREATE INDEX "usage_records_spaceId_userId_createdAt_idx" ON "usage_records"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_spaceId_userId_key" ON "notification_preferences"("spaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "space_memory_configs_spaceId_key" ON "space_memory_configs"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "space_memory_configs_secretId_key" ON "space_memory_configs"("secretId");

-- CreateIndex
CREATE INDEX "secrets_userId_spaceId_idx" ON "secrets"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "mcp_servers_spaceId_userId_idx" ON "mcp_servers"("spaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_spaceId_userId_slug_key" ON "mcp_servers"("spaceId", "userId", "slug");

-- CreateIndex
CREATE INDEX "mcp_oauth_sessions_spaceId_userId_createdAt_idx" ON "mcp_oauth_sessions"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "bot_mcp_servers_spaceId_userId_botId_idx" ON "bot_mcp_servers"("spaceId", "userId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_mcp_servers_botId_serverId_key" ON "bot_mcp_servers"("botId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_identities_botId_key" ON "messaging_identities"("botId");

-- CreateIndex
CREATE INDEX "messaging_identities_userId_idx" ON "messaging_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_identities_provider_address_key" ON "messaging_identities"("provider", "address");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_threadId_key" ON "messaging_channels"("threadId");

-- CreateIndex
CREATE INDEX "messaging_channel_members_identityId_idx" ON "messaging_channel_members"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channel_members_channelId_address_key" ON "messaging_channel_members"("channelId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_link_codes_code_key" ON "messaging_link_codes"("code");

-- CreateIndex
CREATE INDEX "messaging_link_codes_userId_idx" ON "messaging_link_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_outbound_idempotencyKey_key" ON "messaging_outbound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "messaging_outbound_status_nextAttemptAt_idx" ON "messaging_outbound"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "agent_connections_targetBotId_status_idx" ON "agent_connections"("targetBotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_requesterBotId_targetBotId_key" ON "agent_connections"("requesterBotId", "targetBotId");

-- CreateIndex
CREATE INDEX "bot_secrets_botId_idx" ON "bot_secrets"("botId");

-- CreateIndex
CREATE INDEX "bot_secrets_spaceId_idx" ON "bot_secrets"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_secrets_userId_spaceId_botId_name_key" ON "bot_secrets"("userId", "spaceId", "botId", "name");

-- CreateIndex
CREATE INDEX "external_conversations_spaceId_botId_idx" ON "external_conversations"("spaceId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "external_conversations_provider_workspaceId_externalKey_key" ON "external_conversations"("provider", "workspaceId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_runId_key" ON "external_messages"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_threadMessageId_key" ON "external_messages"("threadMessageId");

-- CreateIndex
CREATE INDEX "external_messages_status_nextAttemptAt_idx" ON "external_messages"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_externalConversationId_providerEventId_key" ON "external_messages"("externalConversationId", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_secrets_secretId_key" ON "agent_secrets"("secretId");

-- CreateIndex
CREATE INDEX "agent_secrets_spaceId_updatedAt_idx" ON "agent_secrets"("spaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_secrets_spaceId_name_key" ON "agent_secrets"("spaceId", "name");
