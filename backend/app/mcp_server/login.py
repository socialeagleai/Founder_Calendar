"""The interactive login + consent page.

`provider.authorize()` redirects the browser here with a signed `req` describing
the pending authorization. The user signs in with their Founder Calendar account;
on success we mint a one-time authorization code and redirect back to the client's
`redirect_uri` with `code` + `state`, completing the OAuth handshake.

Deliberately minimal and self-contained (no frontend build, no external assets)
so it works from the MCP container alone.
"""

import html

import anyio
from mcp.server.auth.provider import construct_redirect_uri
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from . import store
from .provider import verify_login_request

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Founder Calendar</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font-family: Inter, system-ui, sans-serif; margin: 0; min-height: 100vh;
    display: grid; place-items: center; background: #f6f7f9; color: #16181d; }}
  @media (prefers-color-scheme: dark) {{ body {{ background: #0d0e11; color: #e8e9ec; }} }}
  .card {{ width: 340px; padding: 32px; border-radius: 16px; background: Canvas;
    box-shadow: 0 10px 40px rgba(0,0,0,.12); }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  p.sub {{ font-size: 13px; opacity: .7; margin: 0 0 20px; }}
  label {{ font-size: 12px; font-weight: 600; display: block; margin: 14px 0 6px; }}
  input {{ width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
    border: 1px solid #d5d7dd; background: Field; color: inherit; font-size: 14px; }}
  button {{ width: 100%; margin-top: 20px; padding: 11px; border: 0; border-radius: 8px;
    background: #C4162A; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }}
  .err {{ color: #C4162A; font-size: 13px; margin-top: 12px; }}
  .app {{ font-weight: 600; }}
</style></head>
<body><form class="card" method="post" action="/login">
  <h1>Authorize access</h1>
  <p class="sub"><span class="app">{app}</span> wants to access your Founder Calendar
     workspace on your behalf.</p>
  <input type="hidden" name="req" value="{req}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  {error}
  <button type="submit">Sign in &amp; allow</button>
</form></body></html>"""


def _render(req_token: str, app_name: str, error: str = "") -> str:
    err_html = f'<div class="err">{html.escape(error)}</div>' if error else ""
    return _PAGE.format(
        req=html.escape(req_token, quote=True),
        app=html.escape(app_name or "An application"),
        error=err_html,
    )


async def _app_name(client_id: str) -> str:
    row = await anyio.to_thread.run_sync(store.load_client, client_id)
    return (row.client_name if row and row.client_name else "An MCP client")


async def login_get(request: Request) -> Response:
    req_token = request.query_params.get("req", "")
    payload = verify_login_request(req_token)
    if not payload:
        return HTMLResponse("<h1>This sign-in link has expired.</h1>", status_code=400)
    return HTMLResponse(_render(req_token, await _app_name(payload["client_id"])))


async def login_post(request: Request) -> Response:
    form = await request.form()
    req_token = str(form.get("req", ""))
    payload = verify_login_request(req_token)
    if not payload:
        return HTMLResponse("<h1>This sign-in link has expired.</h1>", status_code=400)

    email = str(form.get("email", "")).strip().lower()
    password = str(form.get("password", ""))
    user = await anyio.to_thread.run_sync(store.authenticate_user, email, password)
    if not user:
        app_name = await _app_name(payload["client_id"])
        return HTMLResponse(
            _render(req_token, app_name, "Wrong email or password."), status_code=401
        )

    raw_code = await anyio.to_thread.run_sync(
        lambda: store.create_grant(
            client_id=payload["client_id"],
            user_id=user.id,
            redirect_uri=payload["redirect_uri"],
            redirect_uri_provided=payload["redirect_uri_provided"],
            code_challenge=payload["code_challenge"],
            scopes=payload["scopes"],
        )
    )
    location = construct_redirect_uri(
        payload["redirect_uri"], code=raw_code, state=payload.get("state")
    )
    return RedirectResponse(url=location, status_code=302)


routes = [
    Route("/login", login_get, methods=["GET"]),
    Route("/login", login_post, methods=["POST"]),
]
