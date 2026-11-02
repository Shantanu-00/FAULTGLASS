import uvicorn

from ..env import optional

if __name__ == "__main__":
    uvicorn.run(
        "app.api.main:create_app_from_env",
        factory=True,
        host=optional("API_HOST", "127.0.0.1"),
        port=int(optional("API_PORT", "8000")),
    )
