import os

timeout = int(os.environ.get("GUNICORN_TIMEOUT", 120))
worker_class = "uvicorn.workers.UvicornWorker"
# You can also add other settings like bind, workers, etc.
