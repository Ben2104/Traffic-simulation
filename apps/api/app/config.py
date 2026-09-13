from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SIM_")

    sumo_binary: str = "sumo"
    sumo_net_file: str = "networks/soma/soma.net.xml"
    sumo_route_file: str = "networks/soma/soma.rou.xml"
    tick_interval: float = 0.25


@lru_cache
def get_settings() -> Settings:
    return Settings()
