# Founder Calendar — Remote MCP server

Lets any MCP client (Claude, etc.) act on a user's calendar through natural
language. It is an **OAuth-gated proxy** in front of the REST API: a tool
resolves the signed-in user from its access token, mints a short-lived internal
FC JWT for that user, and calls the real backend. The production routers stay the
single source of truth for access control, validation, recurrence and the
invite/reminder fan-out.

- Code: `app/mcp_server/` (+ `app/mcp_main.py` entrypoint).
- Transport: Streamable HTTP at `/mcp`. Auth: OAuth 2.1 (DCR, PKCE, refresh,
  revocation) via the MCP SDK, backed by three tables (`oauth_clients`,
  `oauth_grants`, `oauth_tokens`).
- 26 tools: calendar/agenda, meetings (+attendees/recurrence/reminders), notes,
  boards (+boxes), and read-only team/department lookups. No team/org admin
  writes in v1.

## Run locally

```
uvicorn app.mcp_main:app --host 0.0.0.0 --port 9000
```

Env: `MCP_ISSUER_URL` (public base URL, e.g. http://localhost:9000),
`MCP_BACKEND_URL` (where the REST API lives), `JWT_SECRET` (must match the API's),
`DATABASE_URL` (same DB as the API).

Connect a client to `http://localhost:9000/mcp`; it discovers OAuth from
`/.well-known/oauth-authorization-server`, registers itself, and opens the
`/login` page where the user signs in with their Founder Calendar account.

## Go live on the VPS (mcp.fc.socialeagle.ai)

The `mcp` service is already defined in `docker-compose.vps.yml` (container
`founder_cal_mcp`, bound to `127.0.0.1:9002`). Three host-side steps remain — they
need DNS and TLS that only exist on the box, so they are NOT automated here:

1. **DNS** — add an A record `mcp.fc.socialeagle.ai → 72.61.138.192`.
2. **nginx vhost** — `/etc/nginx/sites-available/mcp.fc.socialeagle.ai`:

   ```nginx
   server {
     server_name mcp.fc.socialeagle.ai;

     location / {
       proxy_pass http://127.0.0.1:9002;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

       # Streamable HTTP keeps a long-lived response stream open. Do not buffer
       # it, and give it room to stay open.
       proxy_buffering off;
       proxy_cache off;
       proxy_read_timeout 3600s;
       proxy_send_timeout 3600s;
       chunked_transfer_encoding on;
     }
     listen 80;
   }
   ```

   `ln -s` into `sites-enabled`, `nginx -t`, `systemctl reload nginx`.
3. **TLS** — `certbot --nginx -d mcp.fc.socialeagle.ai` (certbot rewrites the vhost
   to listen on 443). `MCP_ISSUER_URL` is already `https://mcp.fc.socialeagle.ai`,
   which must match the served hostname exactly.

Then, from the repo on the VPS:

```
docker compose -f docker-compose.vps.yml up -d --build mcp
```

This does NOT touch the co-hosted `microsaas` stack. `JWT_SECRET` comes from the
untracked `/root/Founder_Calendar/.env` (already present for the backend). No new
secrets are introduced.

## Add to a client

Point the client at `https://mcp.fc.socialeagle.ai/mcp`. In Claude, add it as a
custom connector; the OAuth login flow runs in the browser and the user signs in
with their Founder Calendar email + password.
