import os
import json
import logging
from fastapi import APIRouter, Request
from aiogram.types import Update

logger = logging.getLogger(__name__)

def create_webhook_router(bot, dp):
    """
    Factory that returns an APIRouter with all webhook endpoints.
    Requires bot and dp instances to be passed in.
    """
    router = APIRouter(prefix="/api")

    @router.post("/telegram-webhook")
    async def handle_webhook(request: Request):
        try:
            body = await request.body()
            body_str = body.decode('utf-8')
            logger.info(f"Webhook raw (first 200): {body_str[:200]}...")
            data = json.loads(body_str)
            update = Update(**data)
            await dp.feed_update(bot, update)
            return {"ok": True}
        except Exception as e:
            logger.error(f"Webhook error: {e}", exc_info=True)
            return {"ok": False, "error": str(e)}

    @router.get("/set-webhook")
    async def set_webhook(request: Request):
        try:
            render_url = os.getenv("RENDER_EXTERNAL_URL")
            if render_url:
                base_url = render_url.rstrip('/')
            else:
                host = request.headers.get("host")
                if not host:
                    return {"status": "error", "message": "Cannot determine host"}
                base_url = f"https://{host}"
            webhook_url = f"{base_url}/api/telegram-webhook"
            await bot.set_webhook(url=webhook_url, drop_pending_updates=True)
            logger.info(f"Webhook set to {webhook_url}")
            return {"status": "Webhook updated", "new_url": webhook_url}
        except Exception as e:
            logger.error(f"Failed to set webhook: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    @router.get("/webhook-status")
    async def webhook_status():
        try:
            info = await bot.get_webhook_info()
            return {
                "url": info.url,
                "has_custom_certificate": info.has_custom_certificate,
                "pending_update_count": info.pending_update_count,
                "last_error_date": info.last_error_date,
                "last_error_message": info.last_error_message,
                "max_connections": info.max_connections,
                "allowed_updates": info.allowed_updates
            }
        except Exception as e:
            logger.error(f"Failed to get webhook info: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    return router
    
