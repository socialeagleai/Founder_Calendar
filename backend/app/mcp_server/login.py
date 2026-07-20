"""The interactive login + consent page.

`provider.authorize()` redirects the browser here with a signed `req` describing
the pending authorization. The user signs in with their Founder Calendar account;
on success we mint a one-time authorization code and redirect back to the client's
`redirect_uri` with `code` + `state`, completing the OAuth handshake.

Deliberately minimal (no frontend build). The one external asset is Google's
Identity Services script, loaded only when GOOGLE_CLIENT_ID is configured -
without it, accounts created via "Sign in with Google" have hashed_password
NULL and so could never complete this flow at all.
"""

import html

import anyio
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from mcp.server.auth.provider import construct_redirect_uri
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from ..config import settings
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
  form {{ margin: 0; }}
  .or {{ display: flex; align-items: center; gap: 10px; margin: 18px 0 14px;
    font-size: 12px; opacity: .55; }}
  .or::before, .or::after {{ content: ""; flex: 1; height: 1px; background: #d5d7dd; }}
  .gwrap {{ display: flex; justify-content: center; }}
</style></head>
<body><div class="card">
  <h1>Authorize access</h1>
  <p class="sub"><span class="app">{app}</span> wants to access your Founder Calendar
     workspace on your behalf.</p>
  <form method="post" action="/login">
    <input type="hidden" name="req" value="{req}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    {error}
    <button type="submit">Sign in &amp; allow</button>
  </form>
  {google}
</div></body></html>"""

# Rendered only when GOOGLE_CLIENT_ID is set. The GSI button posts the ID token
# back through a hidden form so the signed `req` stays bound to the credential;
# nothing about the pending authorization is held in JS state.
_GOOGLE_BLOCK = """
  <div class="or"><span>or</span></div>
  <div class="gwrap">
    <div id="g_id_onload"
         data-client_id="{client_id}"
         data-callback="onGoogleCredential"
         data-ux_mode="popup"
         data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard" data-theme="outline"
         data-text="signin_with" data-shape="rectangular" data-width="276"></div>
  </div>
  <form id="gform" method="post" action="/login/google">
    <input type="hidden" name="req" value="{req}">
    <input type="hidden" name="credential" id="gcred">
  </form>
  <script>
    function onGoogleCredential(resp) {{
      document.getElementById('gcred').value = resp.credential;
      document.getElementById('gform').submit();
    }}
  </script>
  <script src="https://accounts.google.com/gsi/client" async defer></script>"""


def _render(req_token: str, app_name: str, error: str = "") -> str:
    err_html = f'<div class="err">{html.escape(error)}</div>' if error else ""
    safe_req = html.escape(req_token, quote=True)
    google_html = ""
    if settings.google_client_id:
        google_html = _GOOGLE_BLOCK.format(
            client_id=html.escape(settings.google_client_id, quote=True), req=safe_req
        )
    return _PAGE.format(
        req=safe_req,
        app=html.escape(app_name or "An application"),
        error=err_html,
        google=google_html,
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

    return await _complete(payload, user)


async def _complete(payload: dict, user) -> Response:
    """Mint the one-time code and hand the browser back to the client."""
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


def _verify_google(credential: str) -> dict:
    """Blocking - verifies signature, audience and expiry, fetching Google's certs."""
    return google_id_token.verify_oauth2_token(
        credential, google_requests.Request(), settings.google_client_id
    )


async def login_google(request: Request) -> Response:
    form = await request.form()
    req_token = str(form.get("req", ""))
    payload = verify_login_request(req_token)
    if not payload:
        return HTMLResponse("<h1>This sign-in link has expired.</h1>", status_code=400)

    app_name = await _app_name(payload["client_id"])

    def fail(msg: str, code: int = 401) -> Response:
        return HTMLResponse(_render(req_token, app_name, msg), status_code=code)

    if not settings.google_client_id:
        return fail("Google sign-in is not configured on this server.", 400)

    credential = str(form.get("credential", ""))
    if not credential:
        return fail("Google sign-in did not return a credential.")

    try:
        info = await anyio.to_thread.run_sync(_verify_google, credential)
    except ValueError:
        # Malformed token, wrong audience, or expired.
        return fail("Could not verify that Google account.")
    except GoogleAuthError:
        # Could not reach Google to fetch signing certs.
        return fail("Could not reach Google to verify - try again.", 503)

    email = (info.get("email") or "").strip().lower()
    if not email:
        return fail("That Google account has no email address.")
    # Without this an unverified Google account bearing someone else's address
    # would take over their Founder Calendar workspace.
    if not info.get("email_verified"):
        return fail("That Google account's email address is not verified.")

    name = info.get("name") or email.split("@")[0]
    user = await anyio.to_thread.run_sync(store.find_or_create_google_user, email, name)
    return await _complete(payload, user)


routes = [
    Route("/login", login_get, methods=["GET"]),
    Route("/login", login_post, methods=["POST"]),
    Route("/login/google", login_google, methods=["POST"]),
]
