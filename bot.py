import os
import logging
from fastapi import FastAPI, Request, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.types import Update
from supabase import create_client, Client
import requests
import sync_games  # for manual sync
from typing import Optional

# --- Config ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")   # service role key
ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x]
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-username.github.io/nanogamz/")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- FastAPI app with CORS ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your GitHub Pages URL
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------ WEBHOOK ROUTER ------------------------
router = APIRouter(prefix="/api")

@router.post("/telegram-webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        data = await request.json()
        # Log update type for debugging
        update_type = "unknown"
        if "pre_checkout_query" in data:
            update_type = "pre_checkout_query"
        elif "message" in data:
            update_type = "message"
        elif "callback_query" in data:
            update_type = "callback_query"
        logging.info(f"Webhook received: update_id={data.get('update_id')}, type={update_type}")

        update = Update(**data)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook Error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}

@router.get("/set-webhook")
async def set_webhook(request: Request):
    """Manually set the webhook URL to the current host + /api/telegram-webhook"""
    try:
        host = request.headers.get("host")
        url = f"https://{host}/api/telegram-webhook"
        await bot.set_webhook(url=url, drop_pending_updates=True)
        logging.info(f"Webhook manually set to {url}")
        return {"status": "Webhook updated", "new_url": url}
    except Exception as e:
        logging.error(f"Failed to set webhook: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

# Include the router
app.include_router(router)

# ------------------------ BOT HANDLERS ------------------------

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    user = message.from_user
    user_id = user.id
    username = user.username or ""

    # Insert or update user (no referral, no points)
    user_data = {
        "telegram_id": user_id,
        "username": username,
    }
    supabase.table("users").upsert(user_data).execute()

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Play Nanogamz", web_app=WebAppInfo(url=WEBAPP_URL))],
        [InlineKeyboardButton(text="📢 Channel", url="https://t.me/your_channel")]
    ])
    await message.answer(
        "🎮 **Welcome to Nanogamz!**\n\nYour go‑to hub for instant HTML5 games.\nClick the button below to start playing!",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )

# --- Admin commands ---
@dp.message(Command("admin"), F.from_user.id.in_(ADMIN_IDS))
async def cmd_admin(message: types.Message):
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

# ------------------------ API ENDPOINT FOR FRONTEND ------------------------
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

# --- No automatic webhook on startup – you set it manually via /api/set-webhook ---

# For local testing
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
    
