import os
import time
import requests
import logging

logger = logging.getLogger(__name__)

def run_pinger(interval=None):
    url = os.environ.get("RENDER_EXTERNAL_URL")
    if not url:
        logger.error("RENDER_EXTERNAL_URL not set")
        return
    interval = interval or int(os.environ.get("PING_INTERVAL", 300))
    while True:
        try:
            resp = requests.get(f"{url}/", timeout=10)
            logger.info(f"Ping status: {resp.status_code}")
        except Exception as e:
            logger.error(f"Ping failed: {e}")
        time.sleep(interval)
