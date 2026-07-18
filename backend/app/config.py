from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, loaded from environment / .env file."""

    database_url: str = (
        "postgresql+psycopg2://founder:founder_pass@localhost:5432/founder_calendar"
    )

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    google_client_id: str = ""

    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://localhost:8080"

    # Base URL of the frontend - used to build password-reset links.
    app_base_url: str = "http://localhost:8080"

    # Password reset token lifetime.
    reset_token_expire_minutes: int = 60

    # SMTP for outbound email. When smtp_host is empty, reset links are logged
    # to the server instead of emailed (so the flow works without a provider).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    # The in-process thread that sends daily agenda digests. Off in tests and any
    # environment where a background loop would be surprising.
    digest_enabled: bool = True

    # Web Push (VAPID). Generate a pair with:
    #   python -m py_vapid --gen  (or see backend/README.md)
    # The private key belongs in the untracked /root/Founder_Calendar/.env, never
    # in git. With these empty, push is simply off - the bell and email are
    # unaffected. The PUBLIC key is served from /api/push/vapid-public-key rather
    # than baked into the frontend: VITE_* vars are inlined at build time, so a
    # backend-only env change would leave the browser with an empty key and push
    # would silently no-op.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    # "mailto:..." identifying us to the push service, per the VAPID spec.
    vapid_subject: str = "mailto:support@socialeagle.ai"

    # ---- Remote MCP server ----
    # Public base URL of the MCP server itself. This is the OAuth issuer and the
    # resource identifier, so it MUST match what clients reach (scheme + host, no
    # trailing slash), e.g. https://mcp.fc.socialeagle.ai. Metadata, /authorize
    # and /token URLs are all built from it.
    mcp_issuer_url: str = "http://localhost:9000"
    # Where the MCP server reaches the REST API internally. In the compose network
    # this is the backend service; locally it's the dev server. Tool calls proxy
    # here with a minted internal FC JWT.
    mcp_backend_url: str = "http://localhost:8000"
    # Access / refresh token lifetimes for MCP clients.
    mcp_access_token_ttl_minutes: int = 60
    mcp_refresh_token_ttl_days: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
