# Server Setup & First Deploy Runbook

Target: the production VM configured as `HOST_ADDRESS` in the repository variables, accessed as `HOST_USER`.

After the one-time setup below, **all subsequent deploys are fully automated** — pushing to `main` triggers the CI/CD pipeline, which writes the `.env`, copies the compose file, and restarts the container.

---

## 1. Create the Service Directory

```bash
ssh <user>@<server>
sudo mkdir -p /opt/services/amsat-discord-bot
sudo chown <user>:<user> /opt/services/amsat-discord-bot
```

---

## 2. Configure ACR Pull Access

The server needs credentials to pull images from `amsatorg.azurecr.io`. The recommended approach for an Azure VM is to use a **managed identity** with AcrPull role assigned to the registry. If a managed identity is not available, create a scoped ACR token:

```bash
# Option A — managed identity (preferred if the VM has one assigned)
az acr login --name amsatorg   # authenticates via the VM's managed identity

# Option B — long-lived pull token
az acr token create \
  --name amsat-discord-bot-pull \
  --registry amsatorg \
  --scope-map _repositories_pull \
  --output json
# Then: docker login amsatorg.azurecr.io -u amsat-discord-bot-pull -p <password>
```

Docker stores the credential in `~/.docker/config.json`; future `docker compose pull` calls use it automatically.

---

## 3. Configure GitHub for CD

See [CONTRIBUTING.md](../CONTRIBUTING.md#cicd-secrets-and-variables) for the full list. The minimum required before CD will work:

**Repo secret** (repo → Settings → Secrets and variables → Actions → **Secrets**):
- `HOST_DEPLOY_KEY` — ED25519 private key whose public half is in `~/.ssh/authorized_keys` on the server

**Repo variables** (repo → Settings → Secrets and variables → Actions → **Variables**):
- `HOST_ADDRESS` = the server's hostname or IP
- `HOST_USER` = the SSH user on the server
- All application variables (`DISCORD_CLIENT_ID`, `ROLE_MAP`, etc.)

**Repo secrets**:
- `DISCORD_TOKEN`, `WILDAPRICOT_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### Generating the deploy key

```bash
ssh-keygen -t ed25519 -C "github-actions-amsat-discord-bot" -f ~/.ssh/amsat_deploy_key -N ""
# Add the public key to the server:
ssh-copy-id -i ~/.ssh/amsat_deploy_key.pub <user>@<server>
# Add the private key to GitHub as the HOST_DEPLOY_KEY org secret.
cat ~/.ssh/amsat_deploy_key
```

---

## 4. First Manual Deploy

Once the directory exists and ACR pull auth is configured, trigger the first deploy by pushing to `main` (or re-running the last workflow run). The CD pipeline will:

1. Copy `deploy/docker-compose.yml` to `/opt/services/amsat-discord-bot/docker-compose.yml`
2. Generate `.env` from GitHub secrets/vars and copy it to `/opt/services/amsat-discord-bot/.env`
3. Run `docker compose pull && docker compose up -d --force-recreate`

To verify on the server:

```bash
cd /opt/services/amsat-discord-bot
docker compose logs -f
```

Watch for `Logged in as` and `Registered N commands` to confirm a clean start. Slash commands register automatically on startup.

---

## 5. Uptime Kuma Monitoring

The bot has no public HTTP endpoint. Options:

- **Docker container monitor** — works if Uptime Kuma runs on the same host (`amsat-discord-bot` container name)
- **HTTP health endpoint** — add a lightweight `GET /health → 200` Express endpoint to the bot, expose it on a local port, and monitor that
