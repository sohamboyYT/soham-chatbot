from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ResolveAI"
    database_url: str = "sqlite:///./resolveai.db"
    cors_origins: str = "http://localhost:5173"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    crm_provider: str = "mock"
    crm_webhook_url: str | None = None
    crm_api_token: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
