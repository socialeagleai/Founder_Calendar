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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
