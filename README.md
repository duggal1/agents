# SAPPHIRE/AGENTS

 AI teammates with their own computers.

Sapphire lets you build a company of AI teammates.

Start with a **CEO Bot**. Give it a goal, and it can spawn the teammates needed to get the work done: Marketing, Sales, Research, Operations, Recruiting, Finance, and more.

Each teammate can then spawn its own **sub-agents** for specific jobs. Those sub-agents get their own virtual computers and can actually use them to do the work.

They can browse the web, sign into software, use terminals, work with files, operate desktop apps, research companies, update systems, run workflows, and execute tasks from start to finish.

You talk to the CEO. The CEO runs the team.

The result is not one chatbot answering prompts. It is a hierarchy of AI teammates and sub-agents working together on real tasks.

## How it works

```text
You
  ↓
CEO Bot
  ├── Marketing Teammate
  │     ├── Research Sub-agent → virtual computer
  │     ├── Content Sub-agent → virtual computer
  │     └── Campaign Sub-agent → virtual computer
  │
  ├── Sales Teammate
  │     ├── Prospecting Sub-agent → virtual computer
  │     ├── Research Sub-agent → virtual computer
  │     └── Outreach Sub-agent → virtual computer
  │
  ├── Operations Teammate
  │     ├── Data Sub-agent → virtual computer
  │     ├── Admin Sub-agent → virtual computer
  │     └── Workflow Sub-agent → virtual computer
  │
  └── Recruiting Teammate
        ├── Sourcing Sub-agent → virtual computer
        ├── Research Sub-agent → virtual computer
        └── Scheduling Sub-agent → virtual computer
```

The CEO delegates.

The teammates manage their own work.

The sub-agents execute it.

Every computer is usable.

## Here are a few use cases

### Run your sales organization

Tell the CEO:

> Build pipeline for our new market and have the team work it overnight.

The CEO can spin up a Sales teammate.

The Sales teammate can spawn sub-agents to research target accounts, find decision-makers, inspect your CRM, check company websites, analyze buying signals, build prospect lists, and prepare personalized outreach.

Each sub-agent can operate its own virtual computer and work across the tools required to complete the task.

By morning, you have researched accounts, qualified contacts, prepared outreach, and a review queue waiting for you.

### Run your marketing team

Tell the CEO:

> Launch a campaign for our new product targeting dental groups in California.

The CEO creates a Marketing teammate.

Marketing can spawn sub-agents to research the market, analyze competitors, find audiences, collect examples, prepare copy, build campaign assets, and work inside the tools used to launch the campaign.

One teammate manages the work. Multiple sub-agents execute it.

### Run research like a real team

Tell the CEO:

> Figure out whether we should enter the European market.

The CEO can create a Research teammate.

That teammate can split the project across sub-agents researching competitors, pricing, companies, regulations, market signals, customer segments, and distribution.

The work happens in parallel across independent virtual computers, then gets brought back together into one result.

### Run operations

Tell the CEO:

> Clean up our customer data and make sure every account is updated.

The CEO can delegate the project to Operations.

Operations can spawn sub-agents to work through spreadsheets, CRMs, dashboards, websites, internal tools, files, and other software.

They can update records, verify information, reconcile data, and report what changed.

### Run recruiting

Tell the CEO:

> Build us a pipeline of senior infrastructure engineers.

The Recruiting teammate can spawn sub-agents to source candidates, research backgrounds, identify relevant companies, organize candidates, prepare outreach, and manage the recruiting workflow.

The work gets split across multiple computers instead of forcing one agent to do everything sequentially.

### Run the company

Give the CEO a larger objective:

> Grow revenue 30% this quarter.

The CEO can decide what work needs to happen and create the teammates to handle it.

Marketing can work on demand generation.

Sales can build pipeline.

Research can analyze competitors and markets.

Operations can handle execution.

Recruiting can find the people required to scale.

Each teammate can create its own sub-agents and give them real computers to work with.

You manage the company at the top.

Sapphire handles the work underneath.

## Your teammates can

- Spawn specialized sub-agents for complex work
- Give every sub-agent its own virtual computer
- Run multiple teammates and sub-agents in parallel
- Browse websites and operate web applications
- Sign into and work inside software
- Use terminals, files, and desktop applications
- Research companies, people, markets, and competitors
- Work across CRMs, spreadsheets, email, and other business tools
- Execute sales, marketing, research, operations, and recruiting workflows
- Delegate work between teammates
- Keep context, memory, and work history
- Run scheduled and continuous tasks
- Talk to you through the web or Slack
- Run locally or on your own server
- Connect your own models and computer providers

## Every sub-agent gets a computer

A sub-agent does not just return text.

It gets a virtual computer it can actually use.

Open a website.

Sign into a tool.

Search a CRM.

Work through a spreadsheet.

Run a terminal command.

Download and organize files.

Navigate a complicated web application.

Complete the workflow.

When something requires your credentials or approval, the computer can be handed back to you.

Then the work continues.

## Multiple companies. Multiple teams. One system.

You can run multiple CEO Bots for different companies, projects, or business functions.

Each CEO can build its own team.

Each team can create its own sub-agents.

Every layer can work independently and in parallel.

Sapphire gives you the system to run all of it.

## Demo

[https://github.com/user-attachments/assets/dccdeddb-2134-4a56-8eed-b2e591736b1c](https://github.com/user-attachments/assets/dccdeddb-2134-4a56-8eed-b2e591736b1c)

## Stack

- TypeScript
- React 19, Vite, Tailwind CSS
- Electron and Expo
- Hono and oRPC
- PostgreSQL and Prisma
- Better Auth
- Graphile Worker
- Pi
- Docker, E2B, Daytona, CreateOS, and Box
- MCP, OpenAPI, Composio, and Pipedream

## Quick start

You need Docker Engine, Docker Compose, `curl`, OpenSSL, and Bun.

```bash
mkdir -p sapphire-agents && cd sapphire-agents

curl -fsSLO https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/infra/compose/install-images.sh

bash install-images.sh
```

Then open:

```text
http://127.0.0.1:5173
```

Create an account, connect a model, and create your first CEO Bot.

## Run it on a server

Run Sapphire/Agents on a VPS or your own machine and keep your teams working continuously.

```bash
bash install-images.sh --prepare-only
```

Configure `.env`, add your domain and sandbox provider, then start the stack.

Put HTTPS in front of port `5173`.

See the self-hosting documentation for production deployment, backups, upgrades, and security.

## Local development

Requirements:

- Bun
- Docker

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO

cp .env.example .env

bun install
bun db:generate
bun db:migrate
bun sandbox:build
bun dev
```

Then open:

```text
http://127.0.0.1:5173
```

## Desktop and mobile

The desktop and mobile apps use the same Sapphire/Agents backend as the web app.

```bash
bun --filter @sapphire/desktop dev
```

## Development

```text
apps/
  web
  api
  worker
  desktop
  mobile
  www

packages/
  domain
  contracts
  persistence
  adapters
  ui
  tooling

infra/
docs/
```

Run the standard checks:

```bash
bun lint
bun check
bun test
bun test:integration
bun test:e2e
```

## Documentation

- [Self-hosting](https://chatgpt.com/c/docs/self-host.md)
- [Computer runtime](https://chatgpt.com/c/docs/computer-runtime.md)
- [Desktop releases](https://chatgpt.com/c/docs/desktop-release.md)
- [Mobile releases](https://chatgpt.com/c/docs/mobile-release.md)
- [Performance](https://chatgpt.com/c/docs/performance.md)
- [Contributing](https://chatgpt.com/c/CONTRIBUTING.md)

## License

Sapphire/Agents is licensed under the Apache License 2.0.
