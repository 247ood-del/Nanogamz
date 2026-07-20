import os
import logging
import asyncio
import time
import fcntl
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client
import requests
import sync_games
from typing import Optional

# Import the webhook router factory
from webhook import create_webhook_router

# --- Logging ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Config ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x]
WEBAPP_URL = os.getenv("WEBAPP_URL")
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")  # automatically set by Render

# --- Supabase & Bot ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- FastAPI app ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include webhook router (pass bot and dp) ---
app.include_router(create_webhook_router(bot, dp))

# --- Root & Health ---
@app.get("/")
async def root():
    return {"status": "Nanogamz Bot is running"}

@app.get("/health")
async def health():
    return {"status": "ok"}

# --- API for frontend ---
@app.get("/games")
async def get_games(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 20,
    offset: int = 0
):
    try:
        query = supabase.table("games").select("*").order("id").range(offset, offset + limit - 1)
        if category and category != "🔥 Discover":
            clean_cat = ''.join(ch for ch in category if ch.isalpha() or ch == ' ').strip()
            query = query.eq("category", clean_cat)
        if search:
            query = query.ilike("title", f"%{search}%")
        result = query.execute()
        return result.data
    except Exception as e:
        return {"error": str(e)}, 500

# --- Bot Handlers ---
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    logger.info(f"/start from user {message.from_user.id}")
    user = message.from_user
    user_data = {"telegram_id": user.id, "username": user.username or ""}
    supabase.table("users").upsert(user_data).execute()
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Play Nanogamz", web_app=WebAppInfo(url=WEBAPP_URL))],
        [InlineKeyboardButton(text="📢 Channel", url="https://t.me/nanogamz")]
    ])
    await message.answer(
        "🎮 **Welcome to Nanogamz!**\n\nYour go‑to hub for instant HTML5 games.\nClick the button below to start playing!",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )

@dp.message(Command("admin"), F.from_user.id.in_(ADMIN_IDS))
async def cmd_admin(message: types.Message):
    logger.info(f"/admin from admin user {message.from_user.id}")
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔍 Check Broken Links", callback_data="admin_check_broken")],
        [InlineKeyboardButton(text="🔄 Sync Games Now", callback_data="admin_sync_games")]
    ])
    await message.answer("🛠 Admin Panel", reply_markup=keyboard)

@dp.callback_query(F.data == "admin_check_broken")
async def admin_check_broken(callback: types.CallbackQuery):
    await callback.answer("Checking...")
    games = supabase.table("games").select("id, playable_url").execute()
    broken = []
    for game in games.data:
        try:
            resp = requests.head(game["playable_url"], timeout=5)
            if resp.status_code >= 400:
                broken.append(game["id"])
        except:
            broken.append(game["id"])
    if broken:
        for gid in broken:
            supabase.table("games").delete().eq("id", gid).execute()
        await callback.message.edit_text(f"🗑 Deleted {len(broken)} broken games.")
    else:
        await callback.message.edit_text("✅ All games are reachable.")

@dp.callback_query(F.data == "admin_sync_games")
async def admin_sync_games(callback: types.CallbackQuery):
    await callback.answer("Syncing...")
    games = sync_games.fetch_gamepix_games()
    if games:
        sync_games.upsert_games(supabase, games)
        await callback.message.edit_text(f"✅ Synced {len(games)} games from GamePix.")
    else:
        await callback.message.edit_text("❌ Sync failed or no games found.")

# ========== WEBHOOK SETUP WITH LOCK ==========
WEBHOOK_LOCK_FILE = "/tmp/webhook.lock"

def set_webhook_once():
    """Set the webhook only once using a file lock."""
    if not RENDER_EXTERNAL_URL:
        logger.warning("RENDER_EXTERNAL_URL not set; webhook will not be set.")
        return

    expected_url = f"{RENDER_EXTERNAL_URL.rstrip('/')}/api/telegram-webhook"

    try:
        # Try to acquire an exclusive lock (non‑blocking)
        with open(WEBHOOK_LOCK_FILE, "w") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)

            # Check current webhook status
            try:
                current = bot.get_webhook_info()
                if current.url == expected_url:
                    logger.info("Webhook already correctly set, skipping.")
                    return
            except Exception:
                pass  # if we can't get info, proceed to set

            # Set the webhook
            bot.set_webhook(url=expected_url, drop_pending_updates=True)
            logger.info(f"Webhook set to {expected_url}")

    except BlockingIOError:
        # Another worker is already setting the webhook – wait and then do nothing
        logger.info("Another worker is setting the webhook; waiting 2 seconds...")
        time.sleep(2)
        # Optionally verify it was set
        try:
            current = bot.get_webhook_info()
            if current.url == expected_url:
                logger.info("Webhook was set by another worker, ready.")
            else:
                logger.warning("Webhook not set after waiting; you may need to set it manually via /api/set-webhook.")
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Failed to set webhook: {e}")

# --- Startup event ---
@app.on_event("startup")
async def startup():
    # Run the webhook setup in a separate thread to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, set_webhook_once)

# --- For local testing ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
    
