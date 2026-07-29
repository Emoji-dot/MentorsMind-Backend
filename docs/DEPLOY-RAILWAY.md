# MentorsMind — Railway Deployment Guide

## Architecture on Railway

```
Railway Project: MentorsMind
├── Service: mentorminds-api      → HTTP API + Socket.IO  (Dockerfile CMD: node dist/bootstrap.js)
├── Service: mentorminds-worker   → BullMQ Workers        (Custom CMD: node dist/worker-bootstrap.js)
├── Plugin:  PostgreSQL           → Managed database
└── Plugin:  Redis                → Queue + cache backend
```

> **Elasticsearch** is external — use [Elastic Cloud](https://cloud.elastic.co) free tier or [Bonsai.io](https://bonsai.io).

---

## Step 1 — Push Your Code to GitHub

Make sure your repo is on GitHub. The `.github/workflows/deploy.yml` pipeline will handle all future deploys automatically.

---

## Step 2 — Create a Railway Project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **"Deploy from GitHub repo"** → select `MentorsMind-Backend`
3. Railway detects the `Dockerfile` automatically

---

## Step 3 — Add Plugins (Managed Services)

Inside your Railway project dashboard:

### PostgreSQL
1. Click **"+ New"** → **Database** → **PostgreSQL**
2. Railway injects `DATABASE_URL` automatically into all services

### Redis
1. Click **"+ New"** → **Database** → **Redis**
2. Railway injects `REDIS_URL` automatically

---

## Step 4 — Configure the API Service

In the **mentorminds-api** service settings:

| Setting | Value |
|---|---|
| **Start Command** | `node dist/bootstrap.js` |
| **Health Check Path** | `/health/ready` |
| **Health Check Timeout** | `300` |
| **Port** | `5000` (Railway auto-detects via `EXPOSE 5000`) |

---

## Step 5 — Add the Worker Service

1. Click **"+ New"** → **GitHub Repo** → select same repo
2. Rename it to `mentorminds-worker`
3. Set **Start Command** to: `node dist/worker-bootstrap.js`
4. **No health check** needed (not an HTTP service)
5. Copy all environment variables from the API service (workers need the same env)

---

## Step 6 — Set Environment Variables

In both services → **Variables**, add the following. Values marked `AUTO` are injected by Railway plugins.

### Core
```
NODE_ENV=production
PORT=5000
API_VERSION=v1
LOG_LEVEL=info
SECRETS_PROVIDER=env
```

### Database
```
DATABASE_URL=AUTO (injected by PostgreSQL plugin)
DB_HOST=AUTO
DB_PORT=AUTO
DB_NAME=AUTO
DB_USER=AUTO
DB_PASSWORD=AUTO
DB_POOL_MAX=20
DB_POOL_MIN=4
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=2000
DB_STATEMENT_TIMEOUT_MS=10000
DB_POOL_EXHAUSTION_THRESHOLD=90
```

### Redis
```
REDIS_URL=AUTO (injected by Redis plugin)
REDIS_CLUSTER_ENABLED=false
REDIS_TLS_ENABLED=false
```

### Auth & Security
```
JWT_SECRET=<generate: openssl rand -base64 48>
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=<generate: openssl rand -base64 48>
JWT_REFRESH_EXPIRES_IN=30d
FILE_SIGNING_SECRET=<generate: openssl rand -base64 48>
ENCRYPTION_KEY=<generate: openssl rand -base64 32>
BCRYPT_ROUNDS=10
```

### CORS & Frontend
```
CORS_ORIGIN=https://your-frontend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
GOOGLE_CALLBACK_URL=https://your-railway-domain.railway.app/api/v1/auth/google/callback
GITHUB_CALLBACK_URL=https://your-railway-domain.railway.app/api/v1/auth/github/callback
```

### Stellar
```
STELLAR_NETWORK=mainnet
STELLAR_HORIZON_URL=https://horizon.stellar.org
PLATFORM_PUBLIC_KEY=<your_stellar_public_key>
PLATFORM_SECRET_KEY=<your_stellar_secret_key>
STELLAR_FUNDING_SECRET=<your_funding_secret>
```

### AWS
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your_key>
AWS_SECRET_ACCESS_KEY=<your_secret>
AWS_S3_BUCKET=<your_bucket>
AWS_IVS_REGION=us-east-1
```

### Email
```
EMAIL_PROVIDER=sendgrid        # or smtp / mailgun
SENDGRID_API_KEY=<your_key>
FROM_EMAIL=noreply@mentorminds.com
```

### Firebase (Push Notifications)
```
FIREBASE_PROJECT_ID=<your_project_id>
FIREBASE_PRIVATE_KEY=<paste multi-line key — wrap in quotes>
FIREBASE_CLIENT_EMAIL=<your_client_email>
```

### OAuth (Social Login)
```
GOOGLE_CLIENT_ID=<your_id>
GOOGLE_CLIENT_SECRET=<your_secret>
GITHUB_CLIENT_ID=<your_id>
GITHUB_CLIENT_SECRET=<your_secret>
```

### Elasticsearch
```
ELASTICSEARCH_URL=https://your-cluster.bonsai.io   # or Elastic Cloud URL
ELASTICSEARCH_USERNAME=<user>
ELASTICSEARCH_PASSWORD=<pass>
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_INDEX_PREFIX=mentorminds
```

### Monitoring (Optional)
```
SENTRY_DSN=<your_sentry_dsn>
```

### AI Services (Optional)
```
OPENAI_API_KEY=<your_key>
ANTHROPIC_API_KEY=<your_key>
```

---

## Step 7 — Run Migrations

Before the API goes live, run your database migrations via Railway CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run migrations against the Railway PostgreSQL instance
railway run pnpm run migrate:up
```

---

## Step 8 — Add `RAILWAY_TOKEN` to GitHub Secrets

This allows the GitHub Actions pipeline to deploy automatically:

1. Railway Dashboard → **Account Settings** → **Tokens** → **Create Token**
2. GitHub Repo → **Settings** → **Secrets and variables** → **Actions** → **New secret**
3. Name: `RAILWAY_TOKEN`, Value: paste your Railway token

Every push to `main` will now:
1. ✅ Type-check with `tsc --noEmit`
2. ✅ Lint with ESLint
3. ✅ Build `dist/`
4. 🚀 Deploy `mentorminds-api` to Railway
5. 🚀 Deploy `mentorminds-worker` to Railway

---

## Step 9 — Custom Domain (Optional)

In the `mentorminds-api` service → **Settings** → **Domains** → **Add Custom Domain**.

Update your DNS to point to the Railway-provided CNAME.

---

## Health Check Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Liveness — is the process up? |
| `GET /health/ready` | Readiness — are DB + Redis connected? |
| `GET /health` | Redirects to `/health/ready` |

Railway uses `/health/ready` before routing traffic to new deployments.

---

## Useful Railway CLI Commands

```bash
# View live logs
railway logs --service mentorminds-api

# Open a shell in the running container
railway shell --service mentorminds-api

# Redeploy manually
railway up --service mentorminds-api

# View all environment variables
railway variables --service mentorminds-api
```

---

## Cost Estimate

| Service | Est. Monthly |
|---|---|
| API container (512MB RAM) | ~$5–10 |
| Worker container (256MB RAM) | ~$3–5 |
| PostgreSQL | ~$5 |
| Redis | ~$5 |
| **Total** | **~$18–25/mo** |

Scales automatically with usage. No charges when idle below the free tier limit.
