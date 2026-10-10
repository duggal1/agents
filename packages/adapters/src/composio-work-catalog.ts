import type { ToolkitDirectoryEntry } from "./composio-catalog-cache.js";

/**
 * Curated professional-work integration catalog for Composio.
 *
 * The live Composio toolkit directory is the primary source, but it requires
 * a configured `COMPOSIO_API_KEY` and its contents vary over time. This
 * curated fallback guarantees at least 500 work/professional integrations are
 * always discoverable — sales, CRM, communication, project management,
 * developer tooling, data, finance, HR, marketing, and support — with
 * consumer/entertainment apps deliberately excluded.
 *
 * Apollo and Slack lead the catalog because sales prospecting and team
 * communication are the most-used professional workflows. Users bring their
 * own Composio key (BYOK); this file only describes the catalog, it never
 * carries credentials.
 */

export type WorkCatalogCategory =
  | "crm"
  | "sales"
  | "communication"
  | "email"
  | "calendar"
  | "project"
  | "docs"
  | "files"
  | "developer"
  | "devops"
  | "data"
  | "analytics"
  | "finance"
  | "hr"
  | "marketing"
  | "support"
  | "ecommerce"
  | "legal"
  | "automation"
  | "security";

export type WorkCatalogEntry = ToolkitDirectoryEntry & {
  category: WorkCatalogCategory;
};

type RawEntry = [slug: string, name: string, category: WorkCatalogCategory];

/**
 * 520 professional-work integrations. Slugs match Composio toolkit slugs
 * (uppercase) where the toolkit exists; otherwise they are the canonical
 * uppercase provider key used for display, search, and merge-dedup.
 */
const RAW_WORK_CATALOG: RawEntry[] = [
  // 1-10: sales prospecting leaders (Apollo first by request).
  ["APOLLO", "Apollo", "sales"],
  ["SLACK", "Slack", "communication"],
  ["SALESFORCE", "Salesforce", "crm"],
  ["HUBSPOT", "HubSpot", "crm"],
  ["ZOOMINFO", "ZoomInfo", "sales"],
  ["LUSHA", "Lusha", "sales"],
  ["CLEARBIT", "Clearbit", "sales"],
  ["HUNTER", "Hunter", "sales"],
  ["SNOVIO", "Snov.io", "sales"],
  ["ROCKETREACH", "RocketReach", "sales"],
  // 11-20: outbound sales.
  ["OUTREACH", "Outreach", "sales"],
  ["SALESLOFT", "Salesloft", "sales"],
  ["GROOVE", "Groove", "sales"],
  ["MIXMAX", "Mixmax", "sales"],
  ["YESWARE", "Yesware", "sales"],
  ["LEMLIST", "Lemlist", "sales"],
  ["REPLYIO", "Reply.io", "sales"],
  ["WOODPECKER", "Woodpecker", "sales"],
  ["MAILSHAKE", "Mailshake", "sales"],
  ["KLENTY", "Klenty", "sales"],
  // 21-30: more sales + lead data.
  ["SMARTLEAD", "Smartlead", "sales"],
  ["INSTANTLY", "Instantly", "sales"],
  ["PERSISTIQ", "PersistIQ", "sales"],
  ["LEADIQ", "LeadIQ", "sales"],
  ["COGNISM", "Cognism", "sales"],
  ["UPLEAD", "UpLead", "sales"],
  ["SEAMLESSAI", "Seamless.AI", "sales"],
  ["DEMANDBASE", "Demandbase", "sales"],
  ["SIXSENSE", "6sense", "sales"],
  ["ROLLWORKS", "RollWorks", "sales"],
  // 31-40: CRM core.
  ["PIPEDRIVE", "Pipedrive", "crm"],
  ["CLOSE", "Close", "crm"],
  ["ZOHOCRM", "Zoho CRM", "crm"],
  ["FRESHSALES", "Freshsales", "crm"],
  ["INSIGHTLY", "Insightly", "crm"],
  ["KEAP", "Keap", "crm"],
  ["ACTIVECAMPAIGN", "ActiveCampaign", "crm"],
  ["COPPER", "Copper", "crm"],
  ["NETHUNT", "NetHunt", "crm"],
  ["STREAK", "Streak", "crm"],
  // 41-50: CRM + CPQ.
  ["MICROSOFTDYNAMICS", "Microsoft Dynamics 365", "crm"],
  ["SUGARCRM", "SugarCRM", "crm"],
  ["SUITECRM", "SuiteCRM", "crm"],
  ["PANDADOC", "PandaDoc", "sales"],
  ["DOCUSIGN", "Docusign", "legal"],
  ["HELLOSIGN", "Dropbox Sign", "legal"],
  ["CONGA", "Conga", "sales"],
  ["DEALHUB", "DealHub", "sales"],
  ["PROPOSIFY", "Proposify", "sales"],
  ["BETTERPROPOSALS", "Better Proposals", "sales"],
  // 51-60: email leaders.
  ["GMAIL", "Gmail", "email"],
  ["OUTLOOK", "Outlook", "email"],
  ["SUPERHUMAN", "Superhuman", "email"],
  ["FRONT", "Front", "email"],
  ["MAILERSEND", "MailerSend", "email"],
  ["SENDGRID", "SendGrid", "email"],
  ["MAILGUN", "Mailgun", "email"],
  ["POSTMARK", "Postmark", "email"],
  ["AMAZONSES", "Amazon SES", "email"],
  ["RESEND", "Resend", "email"],
  // 61-70: email deliverability + verification.
  ["NEVERBOUNCE", "NeverBounce", "email"],
  ["ZEROBOUNCE", "ZeroBounce", "email"],
  ["BRITEVERIFY", "BriteVerify", "email"],
  ["MILLIONVERIFIER", "MillionVerifier", "email"],
  ["VOILANORBERT", "Voila Norbert", "sales"],
  ["FINDTHATLEAD", "FindThatLead", "sales"],
  ["ANYMAILFINDER", "Anymail Finder", "sales"],
  ["MAILJET", "Mailjet", "email"],
  ["BREVO", "Brevo", "email"],
  ["LOOPS", "Loops", "email"],
  // 71-80: communication leaders.
  ["MICROSOFTTEAMS", "Microsoft Teams", "communication"],
  ["ZOOM", "Zoom", "communication"],
  ["GOOGLEMEET", "Google Meet", "communication"],
  ["WEBEX", "Webex", "communication"],
  ["DISCORD", "Discord", "communication"],
  ["TELEGRAM", "Telegram", "communication"],
  ["WHATSAPP", "WhatsApp Business", "communication"],
  ["RINGCENTRAL", "RingCentral", "communication"],
  ["DIALPAD", "Dialpad", "communication"],
  ["AIRCALL", "Aircall", "communication"],
  // 81-90: voice + SMS for work.
  ["TWILIO", "Twilio", "communication"],
  ["VONAGE", "Vonage", "communication"],
  ["PLIVO", "Plivo", "communication"],
  ["TELNYX", "Telnyx", "communication"],
  ["SENDBLUE", "Sendblue", "communication"],
  ["CLICKATELL", "Clickatell", "communication"],
  ["MESSAGEBIRD", "MessageBird", "communication"],
  ["INTERCOM", "Intercom", "support"],
  ["DRIFT", "Drift", "support"],
  ["CRISP", "Crisp", "support"],
  // 91-100: calendar + scheduling.
  ["GOOGLECALENDAR", "Google Calendar", "calendar"],
  ["OUTLOOKCALENDAR", "Outlook Calendar", "calendar"],
  ["CALENDLY", "Calendly", "calendar"],
  ["CALCOM", "Cal.com", "calendar"],
  ["SAVVYCAL", "SavvyCal", "calendar"],
  ["CRON", "Cron", "calendar"],
  ["RECLAIM", "Reclaim", "calendar"],
  ["MOTION", "Motion", "calendar"],
  ["SUNSAMA", "Sunsama", "calendar"],
  ["AKIFLOW", "Akiflow", "calendar"],
  // 101-110: project management.
  ["ASANA", "Asana", "project"],
  ["JIRA", "Jira", "project"],
  ["LINEAR", "Linear", "project"],
  ["TRELLO", "Trello", "project"],
  ["CLICKUP", "ClickUp", "project"],
  ["MONDAY", "monday.com", "project"],
  ["WRIKE", "Wrike", "project"],
  ["SMARTSHEET", "Smartsheet", "project"],
  ["BASECAMP", "Basecamp", "project"],
  ["TEAMWORK", "Teamwork", "project"],
  // 111-120: more project + work tracking.
  ["SHORTCUT", "Shortcut", "project"],
  ["HEIGHT", "Height", "project"],
  ["PLANE", "Plane", "project"],
  ["TAIGA", "Taiga", "project"],
  ["OPENPROJECT", "OpenProject", "project"],
  ["REDMINE", "Redmine", "project"],
  ["YOUTRACK", "YouTrack", "project"],
  ["BACKLOG", "Backlog", "project"],
  ["MEISTERTASK", "MeisterTask", "project"],
  ["TODOIST", "Todoist", "project"],
  // 121-130: docs + knowledge.
  ["NOTION", "Notion", "docs"],
  ["CONFLUENCE", "Confluence", "docs"],
  ["GOOGLEDOCS", "Google Docs", "docs"],
  ["CODA", "Coda", "docs"],
  ["SLITE", "Slite", "docs"],
  ["GITBOOK", "GitBook", "docs"],
  ["OUTLINE", "Outline", "docs"],
  ["NUCLINO", "Nuclino", "docs"],
  ["CRAFT", "Craft", "docs"],
  ["OBSIDIAN_SYNC", "Obsidian Sync", "docs"],
  // 131-140: files + storage.
  ["GOOGLEDRIVE", "Google Drive", "files"],
  ["DROPBOX", "Dropbox", "files"],
  ["ONEDRIVE", "OneDrive", "files"],
  ["BOX", "Box", "files"],
  ["SHAREPOINT", "SharePoint", "files"],
  ["EGNYTE", "Egnyte", "files"],
  ["PCLOUD", "pCloud Business", "files"],
  ["SYNC", "Sync.com", "files"],
  ["NEXTCLOUD", "Nextcloud", "files"],
  ["WETRANSFER", "WeTransfer", "files"],
  // 141-150: developer platforms.
  ["GITHUB", "GitHub", "developer"],
  ["GITLAB", "GitLab", "developer"],
  ["BITBUCKET", "Bitbucket", "developer"],
  ["AZUREDEVOPS", "Azure DevOps", "developer"],
  ["SOURCEGRAPH", "Sourcegraph", "developer"],
  ["RAYGUN", "Raygun", "developer"],
  ["HONEYBADGER", "Honeybadger", "developer"],
  ["AIRBRAKE", "Airbrake", "developer"],
  ["BUGSNAG", "Bugsnag", "developer"],
  ["ROLLBAR", "Rollbar", "developer"],
  // 151-160: CI/CD.
  ["JENKINS", "Jenkins", "devops"],
  ["CIRCLECI", "CircleCI", "devops"],
  ["TRAVISCI", "Travis CI", "devops"],
  ["GITHUBACTIONS", "GitHub Actions", "devops"],
  ["GITLABCI", "GitLab CI", "devops"],
  ["BUILDKITE", "Buildkite", "devops"],
  ["TEAMCITY", "TeamCity", "devops"],
  ["BAMBOO", "Bamboo", "devops"],
  ["DRONE", "Drone", "devops"],
  ["SEMAPHORE", "Semaphore", "devops"],
  // 161-170: hosting + deploy.
  ["VERCEL", "Vercel", "devops"],
  ["NETLIFY", "Netlify", "devops"],
  ["HEROKU", "Heroku", "devops"],
  ["RENDER", "Render", "devops"],
  ["FLYIO", "Fly.io", "devops"],
  ["RAILWAY", "Railway", "devops"],
  ["DIGITALOCEAN", "DigitalOcean", "devops"],
  ["HETZNER", "Hetzner Cloud", "devops"],
  ["LINODE", "Linode", "devops"],
  ["VULTR", "Vultr", "devops"],
  // 171-180: cloud + containers.
  ["AWS", "Amazon Web Services", "devops"],
  ["GCP", "Google Cloud", "devops"],
  ["AZURE", "Microsoft Azure", "devops"],
  ["CLOUDFLARE", "Cloudflare", "devops"],
  ["FASTLY", "Fastly", "devops"],
  ["DOCKERHUB", "Docker Hub", "devops"],
  ["KUBERNETES", "Kubernetes", "devops"],
  ["TERRAFORMCLOUD", "Terraform Cloud", "devops"],
  ["ANSIBLE", "Ansible Tower", "devops"],
  ["PULUMI", "Pulumi", "devops"],
  // 181-190: observability.
  ["DATADOG", "Datadog", "devops"],
  ["NEWRELIC", "New Relic", "devops"],
  ["SENTRY", "Sentry", "developer"],
  ["PAGERDUTY", "PagerDuty", "devops"],
  ["OPSGENIE", "Opsgenie", "devops"],
  ["HONEYCOMB", "Honeycomb", "devops"],
  ["GRAFANA", "Grafana", "devops"],
  ["PROMETHEUS", "Prometheus", "devops"],
  ["ELASTIC", "Elastic", "devops"],
  ["SPLUNK", "Splunk", "devops"],
  // 191-200: incident + status.
  ["STATUSPAGE", "Statuspage", "devops"],
  ["INCIDENTIO", "incident.io", "devops"],
  ["ROOTLY", "Rootly", "devops"],
  ["FIREHYDRA", "FireHydrant", "devops"],
  ["BLAMLESS", "Blameless", "devops"],
  ["VICTOROPS", "Splunk On-Call", "devops"],
  ["XMATTERS", "xMatters", "devops"],
  ["PINGDOM", "Pingdom", "devops"],
  ["UPTIMEROBOT", "UptimeRobot", "devops"],
  ["BETTERUPTIME", "Better Stack", "devops"],
  // 201-210: code quality + security.
  ["SONARQUBE", "SonarQube", "developer"],
  ["SONARCLOUD", "SonarCloud", "developer"],
  ["CODECOV", "Codecov", "developer"],
  ["COVERALLS", "Coveralls", "developer"],
  ["SNYK", "Snyk", "security"],
  ["DEPENDABOT", "Dependabot", "developer"],
  ["RENOVATE", "Renovate", "developer"],
  ["VAULT", "HashiCorp Vault", "security"],
  ["ONEPASSWORD", "1Password", "security"],
  ["DOPPLER", "Doppler", "security"],
  // 211-220: issue + code review.
  ["SWARMIA", "Swarmia", "developer"],
  ["GRAPHITE", "Graphite", "developer"],
  ["REVIEWABLE", "Reviewable", "developer"],
  ["CODACY", "Codacy", "developer"],
  ["DEEPSOURCE", "DeepSource", "developer"],
  ["QODO", "Qodo", "developer"],
  ["CODERABBIT", "CodeRabbit", "developer"],
  ["SWEEP", "Sweep", "developer"],
  ["BIONIC", "Bionic", "developer"],
  ["STEPSIZE", "Stepsize", "developer"],
  // 221-230: databases + warehouses.
  ["POSTGRES", "PostgreSQL", "data"],
  ["MYSQL", "MySQL", "data"],
  ["MONGODB", "MongoDB", "data"],
  ["REDIS", "Redis", "data"],
  ["SNOWFLAKE", "Snowflake", "data"],
  ["BIGQUERY", "BigQuery", "data"],
  ["REDSHIFT", "Redshift", "data"],
  ["DATABRICKS", "Databricks", "data"],
  ["CLICKHOUSE", "ClickHouse", "data"],
  ["PLANETSCALE", "PlanetScale", "data"],
  // 231-240: more data stores.
  ["SUPABASE", "Supabase", "data"],
  ["FIRESTORE", "Firestore", "data"],
  ["AIRTABLE", "Airtable", "data"],
  ["BASEROW", "Baserow", "data"],
  ["NOCODB", "NocoDB", "data"],
  ["SMARTSUITE", "Smartsuite", "data"],
  ["KNACK", "Knack", "data"],
  ["QUICKBASE", "Quickbase", "data"],
  ["KINTONE", "Kintone", "data"],
  ["ZOHOCREATOR", "Zoho Creator", "data"],
  // 241-250: analytics + BI.
  ["MIXPANEL", "Mixpanel", "analytics"],
  ["AMPLITUDE", "Amplitude", "analytics"],
  ["POSTHOG", "PostHog", "analytics"],
  ["SEGMENT", "Segment", "analytics"],
  ["RUDDERSTACK", "RudderStack", "analytics"],
  ["TABLEAU", "Tableau", "analytics"],
  ["LOOKER", "Looker", "analytics"],
  ["METABASE", "Metabase", "analytics"],
  ["MODE", "Mode", "analytics"],
  ["HEX", "Hex", "analytics"],
  // 251-260: more analytics.
  ["GOOGLEANALYTICS", "Google Analytics", "analytics"],
  ["ADOBEANALYTICS", "Adobe Analytics", "analytics"],
  ["HOTJAR", "Hotjar", "analytics"],
  ["FULLSTORY", "FullStory", "analytics"],
  ["CRAZYEGG", "Crazy Egg", "analytics"],
  ["MATOMO", "Matomo", "analytics"],
  ["PLAUSIBLE", "Plausible", "analytics"],
  ["FATHOM", "Fathom", "analytics"],
  ["JUNE", "June", "analytics"],
  ["HEAP", "Heap", "analytics"],
  // 261-270: ETL + pipelines.
  ["FIVETRAN", "Fivetran", "data"],
  ["STITCH", "Stitch", "data"],
  ["AIRBYTE", "Airbyte", "data"],
  ["MATILLION", "Matillion", "data"],
  ["DBT", "dbt", "data"],
  ["DAGSTER", "Dagster", "data"],
  ["AIRFLOW", "Airflow", "data"],
  ["PREFECT", "Prefect", "data"],
  ["KEBOOLA", "Keboola", "data"],
  ["HEVO", "Hevo", "data"],
  // 271-280: finance + accounting.
  ["QUICKBOOKS", "QuickBooks", "finance"],
  ["XERO", "Xero", "finance"],
  ["FRESHBOOKS", "FreshBooks", "finance"],
  ["WAVE", "Wave", "finance"],
  ["SAGE", "Sage", "finance"],
  ["NETSUITE", "NetSuite", "finance"],
  ["RAMP", "Ramp", "finance"],
  ["BREX", "Brex", "finance"],
  ["MERCURY", "Mercury", "finance"],
  ["WISE", "Wise Business", "finance"],
  // 281-290: billing + payments (work).
  ["STRIPE", "Stripe", "finance"],
  ["CHARGEBEE", "Chargebee", "finance"],
  ["RECURLY", "Recurly", "finance"],
  ["PADDLE", "Paddle", "finance"],
  ["LEMONSQUEEZY", "Lemon Squeezy", "finance"],
  ["GUMROAD_BIZ", "Gumroad", "ecommerce"],
  ["PAYPALBIZ", "PayPal Business", "finance"],
  ["ADYEN", "Adyen", "finance"],
  ["BRAINTREE", "Braintree", "finance"],
  ["CHECKOUTCOM", "Checkout.com", "finance"],
  // 291-300: expenses + payroll.
  ["EXPENSIFY", "Expensify", "finance"],
  ["DIVVY", "Divvy", "finance"],
  ["FLOAT", "Float", "finance"],
  ["GUSTO", "Gusto", "hr"],
  ["RIPPLING", "Rippling", "hr"],
  ["DEEL", "Deel", "hr"],
  ["REMOTE", "Remote", "hr"],
  ["BREEZYHR", "Breezy HR", "hr"],
  ["WORKDAY", "Workday", "hr"],
  ["BAMBOOHR", "BambooHR", "hr"],
  // 301-310: hiring + ATS.
  ["GREENHOUSE", "Greenhouse", "hr"],
  ["LEVER", "Lever", "hr"],
  ["WORKABLE", "Workable", "hr"],
  ["ASHBY", "Ashby", "hr"],
  ["JAZZHR", "JazzHR", "hr"],
  ["SMARTRECRUITERS", "SmartRecruiters", "hr"],
  ["ICIMS", "iCIMS", "hr"],
  ["JOBVITE", "Jobvite", "hr"],
  ["WELLFOUND", "Wellfound", "hr"],
  ["LINKEDIN_TALENT", "LinkedIn Talent", "hr"],
  // 311-320: HR ops.
  ["LATTICE", "Lattice", "hr"],
  ["CULTUREAMP", "Culture Amp", "hr"],
  ["15FIVE", "15Five", "hr"],
  ["CHARTHOP", "ChartHop", "hr"],
  ["SAPLING", "Sapling", "hr"],
  ["ENBOARDA", "Enboarder", "hr"],
  ["TRAINUAL", "Trainual", "hr"],
  ["LESSONLY", "Lessonly", "hr"],
  ["DOCEBO", "Docebo", "hr"],
  ["WORKRAMP", "WorkRamp", "hr"],
  // 321-330: marketing automation.
  ["MAILCHIMP", "Mailchimp", "marketing"],
  ["HUBSPOTMKTG", "HubSpot Marketing", "marketing"],
  ["MARKETO", "Marketo", "marketing"],
  ["PARDOT", "Pardot", "marketing"],
  ["KLAVIYO", "Klaviyo", "marketing"],
  ["CUSTOMERIO", "Customer.io", "marketing"],
  ["ITERABLE", "Iterable", "marketing"],
  ["BRAZE", "Braze", "marketing"],
  ["ONESIGNAL", "OneSignal", "marketing"],
  ["PUSHWOOSH", "Pushwoosh", "marketing"],
  // 331-340: SEO + content marketing.
  ["AHREFS", "Ahrefs", "marketing"],
  ["SEMRUSH", "Semrush", "marketing"],
  ["MOZ", "Moz", "marketing"],
  ["SCREAMINGFROG", "Screaming Frog", "marketing"],
  ["SURFER", "Surfer", "marketing"],
  ["CLEARSCOPE", "Clearscope", "marketing"],
  ["CONTENTLY", "Contently", "marketing"],
  ["STORYCHIEF", "StoryChief", "marketing"],
  ["BUFFER", "Buffer", "marketing"],
  ["HOOTSUITE", "Hootsuite", "marketing"],
  // 341-350: social + ads (work).
  ["LINKEDINADS", "LinkedIn Ads", "marketing"],
  ["GOOGLEADS", "Google Ads", "marketing"],
  ["METAADS", "Meta Ads", "marketing"],
  ["TWITTERADS", "X Ads", "marketing"],
  ["TIKTOKADS", "TikTok Ads", "marketing"],
  ["SPROUT", "Sprout Social", "marketing"],
  ["LATTER", "Later", "marketing"],
  ["PLANOLY", "Planoly", "marketing"],
  ["SENDIBLE", "Sendible", "marketing"],
  ["AGORAPULSE", "Agorapulse", "marketing"],
  // 351-360: support + helpdesk.
  ["ZENDESK", "Zendesk", "support"],
  ["FRESHDESK", "Freshdesk", "support"],
  ["HELPSCOUT", "Help Scout", "support"],
  ["SOLARWINDS", "SolarWinds Service Desk", "support"],
  ["HIVER", "Hiver", "support"],
  ["KAYAKO", "Kayako", "support"],
  ["KUSTOMER", "Kustomer", "support"],
  ["GLADLY", "Gladly", "support"],
  ["ADA", "Ada", "support"],
  ["FORTHOUGHT", "Forethought", "support"],
  // 361-370: knowledge + forums (work).
  ["STACKOVERFLOWTEAMS", "Stack Overflow Teams", "docs"],
  ["DISCOURSE", "Discourse", "communication"],
  ["SLAB", "Slab", "docs"],
  ["BLOOMFIRE", "Bloomfire", "docs"],
  ["KNOWLEDGEOWL", "KnowledgeOwl", "docs"],
  ["DOCUMENT360", "Document360", "docs"],
  ["HELPDOCS", "HelpDocs", "support"],
  ["PROPROFS", "ProProfs KB", "support"],
  ["ARCHBEE", "Archbee", "support"],
  ["HELPJUICE", "Helpjuice", "support"],
  // 371-380: ecommerce operations.
  ["SHOPIFY", "Shopify", "ecommerce"],
  ["WOOCOMMERCE", "WooCommerce", "ecommerce"],
  ["BIGCOMMERCE", "BigCommerce", "ecommerce"],
  ["MAGENTO", "Magento", "ecommerce"],
  ["SQUARESPACE", "Squarespace Commerce", "ecommerce"],
  ["WIXSTORES", "Wix Stores", "ecommerce"],
  ["ETSYBIZ", "Etsy", "ecommerce"],
  ["AMAZONSELLER", "Amazon Seller", "ecommerce"],
  ["EBAYBIZ", "eBay Business", "ecommerce"],
  ["PRINTFUL", "Printful", "ecommerce"],
  // 381-390: inventory + logistics (work).
  ["SHIPSTATION", "ShipStation", "ecommerce"],
  ["SHIPPO", "Shippo", "ecommerce"],
  ["EASYPOST", "EasyPost", "ecommerce"],
  ["FLEXPORT", "Flexport", "ecommerce"],
  ["TRADEGECKO", "TradeGecko", "ecommerce"],
  ["CIN7", "Cin7", "ecommerce"],
  ["SKUVAULT", "SkuVault", "ecommerce"],
  ["SHIPBOB", "ShipBob", "ecommerce"],
  ["DELIVERR", "Deliverr", "ecommerce"],
  ["LOOPRETURNS", "Loop Returns", "ecommerce"],
  // 391-400: legal + contracts.
  ["IRONCLAD", "Ironclad", "legal"],
  ["CLIO", "Clio", "legal"],
  ["JURO", "Juro", "legal"],
  ["SPOTDRAFT", "SpotDraft", "legal"],
  ["CONTRACTBOOK", "Contractbook", "legal"],
  ["SIGNABLE", "Signable", "legal"],
  ["NOTARIZE", "Notarize", "legal"],
  ["CLERKY", "Clerky", "legal"],
  ["FIRSTBASE", "Firstbase", "legal"],
  ["GUST", "Gust", "legal"],
  // 401-410: automation + iPaaS (work).
  ["ZAPIER", "Zapier", "automation"],
  ["MAKE", "Make", "automation"],
  ["N8N", "n8n", "automation"],
  ["WORKATO", "Workato", "automation"],
  ["TRAYIO", "Tray.io", "automation"],
  ["CELIGO", "Celigo", "automation"],
  ["BOOMI", "Boomi", "automation"],
  ["MULESOFT", "MuleSoft", "automation"],
  ["JITTERBIT", "Jitterbit", "automation"],
  ["PIPEDREAMHQ", "Pipedream", "automation"],
  // 411-420: forms + surveys (work).
  ["TYPEFORM", "Typeform", "marketing"],
  ["JOTFORM", "Jotform", "automation"],
  ["GOOGLEFORMS", "Google Forms", "automation"],
  ["FORMSTACK", "Formstack", "automation"],
  ["SURVEYMONKEY", "SurveyMonkey", "analytics"],
  ["QUALTRICS", "Qualtrics", "analytics"],
  ["DELIGHTED", "Delighted", "analytics"],
  ["WOTNOT", "WotNot", "support"],
  ["TALLY", "Tally", "automation"],
  ["FEEDBACKLY", "Feedbackly", "analytics"],
  // 421-430: design + prototyping (work).
  ["FIGMA", "Figma", "developer"],
  ["SKETCH", "Sketch", "developer"],
  ["INVISION", "InVision", "developer"],
  ["FRAMER", "Framer", "developer"],
  ["WEBFLOW", "Webflow", "developer"],
  ["STORYBOOK", "Storybook", "developer"],
  ["ZEPLIN", "Zeplin", "developer"],
  ["ABSTRACT", "Abstract", "developer"],
  ["PENPOT", "Penpot", "developer"],
  ["LOTTIE", "LottieFiles", "developer"],
  // 431-440: video + webinars (work).
  ["LOOM", "Loom", "communication"],
  ["VIDYARD", "Vidyard", "marketing"],
  ["WISTIA", "Wistia", "marketing"],
  ["VIMEO_BIZ", "Vimeo Business", "marketing"],
  ["GOTOWEBINAR", "GoToWebinar", "marketing"],
  ["ZOOMWEBINAR", "Zoom Webinars", "marketing"],
  ["LIVESTORM", "Livestorm", "marketing"],
  ["DEMMIO", "Demio", "marketing"],
  ["BIGMARKER", "BigMarker", "marketing"],
  ["ON24", "ON24", "marketing"],
  // 441-450: security + compliance (work).
  ["OKTA", "Okta", "security"],
  ["AUTH0", "Auth0", "security"],
  ["ONELOGIN", "OneLogin", "security"],
  ["JUMPCLOUD", "JumpCloud", "security"],
  ["DUO", "Duo", "security"],
  ["DRATA", "Drata", "security"],
  ["VANTA", "Vanta", "security"],
  ["SECUREFRAME", "SecureFrame", "security"],
  ["TUGBOAT", "Tugboat", "security"],
  ["WIZ", "Wiz", "security"],
  // 451-460: IT + device (work).
  ["JAMF", "Jamf", "security"],
  ["KANDEJI", "Kandji", "security"],
  ["FLEETSMITH", "Fleet", "security"],
  ["MOSYLE", "Mosyle", "security"],
  ["HEXNODE", "Hexnode", "security"],
  ["ADDIGY", "Addigy", "security"],
  ["KASEYA", "Kaseya", "security"],
  ["DATTO", "Datto", "security"],
  ["NINJAONE", "NinjaOne", "security"],
  ["SYNCRO", "Syncro", "security"],
  // 461-470: password + secrets (work).
  ["BITWARDEN", "Bitwarden", "security"],
  ["KEEPER", "Keeper", "security"],
  ["DASHLANE_BIZ", "Dashlane Business", "security"],
  ["LASTPASS_BIZ", "LastPass Business", "security"],
  ["INFISICAL", "Infisical", "security"],
  ["AWSSECRETS", "AWS Secrets Manager", "security"],
  ["AZUREKEYVAULT", "Azure Key Vault", "security"],
  ["GCPSECRETS", "GCP Secret Manager", "security"],
  ["CLOUDFLAREZERO", "Cloudflare Zero Trust", "security"],
  ["TAILSCALE", "Tailscale", "security"],
  // 471-480: data enrichment + intent.
  ["APOLLO_ENRICH", "Apollo Enrich", "sales"],
  ["CLEARBIT_ENRICH", "Clearbit Enrich", "sales"],
  ["FULLCONTACT", "FullContact", "sales"],
  ["PEOPLE_DATA", "People Data Labs", "sales"],
  ["PROSPEO", "Prospecto", "sales"],
  ["EVABOT", "Evaboot", "sales"],
  ["PHANTOMBUSTER", "Phantombuster", "sales"],
  ["TEXAU", "TexAu", "sales"],
  ["CAPTAINDATA", "Captain Data", "sales"],
  ["CLAY", "Clay", "sales"],
  // 481-490: RevOps + forecasting.
  ["CLARI", "Clari", "sales"],
  ["GONG", "Gong", "sales"],
  ["CHORUS", "Chorus", "sales"],
  ["WINGMAN", "Wingman", "sales"],
  ["AVOMA", "Avoma", "sales"],
  ["FIREFLIES", "Fireflies", "communication"],
  ["OTTER", "Otter.ai", "communication"],
  ["VELOXY", "Veloxy", "sales"],
  ["PEOPLEAI", "People.ai", "sales"],
  ["EBSTA", "Ebsta", "sales"],
  // 491-500: proposal + e-sign + billing ops.
  ["EVERSIGN", "Eversign", "legal"],
  ["SIGNNOW", "SignNow", "legal"],
  ["SIGNEASY", "Signeasy", "legal"],
  ["FORMSTACK_SIGN", "Formstack Sign", "legal"],
  ["QUOTIENT", "Quotient", "finance"],
  ["CHARGIFY", "Chargify", "finance"],
  ["MAXIO", "Maxio", "finance"],
  ["ORDWAY", "Ordway", "finance"],
  ["SUBSCRIPTION_BI", "Baremetrics", "analytics"],
  ["CHARTMOGUL", "ChartMogul", "analytics"],
  // 501-510: support QA + workforce (work).
  ["MAESTROQA", "MaestroQA", "support"],
  ["KLAUS", "Klaus", "support"],
  ["PLAYVOX", "Playvox", "support"],
  ["ASSEMBL", "Assembled", "support"],
  ["CALABRIO", "Calabrio", "support"],
  ["NICEREPLY", "Nicereply", "support"],
  ["STELLA", "Stella Connect", "support"],
  ["HAPPYFOX", "HappyFox", "support"],
  ["FRESHSERVICE", "Freshservice", "support"],
  ["JIRASERVICE", "Jira Service Management", "support"],
  // 511-520: ITSM + procurement (work).
  ["SERVICENOW", "ServiceNow", "support"],
  ["BMC", "BMC Helix", "support"],
  ["IVANTI", "Ivanti", "support"],
  ["MANAGEENGINE", "ManageEngine", "support"],
  ["TOPDESK", "TOPdesk", "support"],
  ["HALOITSM", "HaloITSM", "support"],
  ["SYSAID", "SysAid", "support"],
  ["FRESHPROCURE", "Zip Procurement", "finance"],
  ["RAMP_PROCURE", "Ramp Procurement", "finance"],
  ["AIRBASE", "Airbase", "finance"],
];

/** Non-work slugs that must never appear in the professional catalog. */
export const NON_WORK_TOOLKIT_DENYLIST = [
  "fortnite",
  "minecraft",
  "roblox",
  "tinder",
  "bumble",
  "hinge",
  "netflix",
  "hulu",
  "disneyplus",
  "spotify",
  "tiktok",
  "instagram",
  "snapchat",
  "candy-crush",
  "pokemongo",
  "steam",
  "xbox",
  "playstation",
  "twitch",
  "onlyfans",
] as const;

function slugKey(slug: string): string {
  return slug.trim().toLowerCase();
}

function stripInlineEnvComment(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "#" && (i === 0 || value[i - 1] !== "\\")) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

export const WORK_CATALOG: WorkCatalogEntry[] = RAW_WORK_CATALOG.map(([slug, name, category]) => ({
  slug: slug.trim().toUpperCase(),
  name,
  category,
  logo: null,
  noAuth: false,
}));

export const WORK_CATALOG_SIZE = WORK_CATALOG.length;

export const WORK_TOOLKIT_SLUGS = new Set(WORK_CATALOG.map((entry) => slugKey(entry.slug)));

const WORK_BY_SLUG = new Map(WORK_CATALOG.map((entry) => [slugKey(entry.slug), entry]));

/** True when the slug is part of the curated professional-work catalog. */
export function isWorkToolkitSlug(slug: string): boolean {
  return WORK_TOOLKIT_SLUGS.has(slugKey(slug));
}

export function workCatalogEntry(slug: string): WorkCatalogEntry | undefined {
  return WORK_BY_SLUG.get(slugKey(slug));
}

/**
 * Merge a live Composio directory with the curated work catalog. Live entries
 * win on slug conflicts; curated entries fill every gap so the catalog never
 * drops below 500 professional integrations, even with no API key.
 */
export function mergeWithWorkCatalog(
  live: ToolkitDirectoryEntry[],
  curated: WorkCatalogEntry[] = WORK_CATALOG,
): ToolkitDirectoryEntry[] {
  const seen = new Set<string>();
  const merged: ToolkitDirectoryEntry[] = [];
  for (const item of [...live, ...curated]) {
    const key = slugKey(item.slug);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ slug: item.slug, name: item.name, logo: item.logo, noAuth: item.noAuth });
  }
  // Priority order: Apollo and Slack first, then the rest of the curated
  // catalog, then any live-only extras.
  const priority = new Map<string, number>();
  curated.forEach((item, index) => {
    if (!priority.has(slugKey(item.slug))) priority.set(slugKey(item.slug), index);
  });
  return merged.sort((a, b) => {
    const left = priority.get(slugKey(a.slug)) ?? Number.MAX_SAFE_INTEGER;
    const right = priority.get(slugKey(b.slug)) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Extract `COMPOSIO_API_KEY` from pasted `.env` text (or a bare key) so the
 * Integrations screen can save it immediately without a round-trip through
 * shell config. Returns undefined when no key is present.
 *
 * Accepts `KEY=value`, `export KEY=value`, single/double-quoted values, and
 * ignores `#` comments and surrounding whitespace.
 */
export function extractComposioApiKey(envText: string): string | undefined {
  const lines = envText.split(/\r?\n/);
  // Bare key paste (no KEY= prefix): accept a single plausible token line.
  if (lines.length === 1) {
    const bare = lines[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
    if (
      /^[A-Za-z0-9_-]{8,512}$/.test(bare) &&
      !bare.includes("=") &&
      !/^(true|false|1|0)$/i.test(bare)
    ) {
      return bare;
    }
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?COMPOSIO_API_KEY\s*=\s*(.*)$/);
    if (!match) continue;
    let value = (match[1] ?? "").trim();
    const first = value[0];
    if (first === '"' || first === "'") {
      const close = value.indexOf(first, 1);
      value = (close === -1 ? value.slice(1) : value.slice(1, close)).trim();
    } else {
      value = stripInlineEnvComment(value);
    }
    if (value) return value;
  }
  return undefined;
}
