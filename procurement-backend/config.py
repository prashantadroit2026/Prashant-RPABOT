from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_service_account_json: str = "./service-account.json"
    google_sheet_id: str = ""
    host: str = "0.0.0.0"
    port: int = 8080
    debug: bool = True
    seed_on_start: bool = True
    # CORS – restrict in production; "*" + credentials is invalid per spec.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]
    cors_allow_credentials: bool = False

    @property
    def credentials_path(self) -> Path:
        return Path(self.google_service_account_json).expanduser().resolve()


settings = Settings()
