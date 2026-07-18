import os
import logging
import asyncio
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
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
    allow_origins=["*"],  # In production, replace with your GitHub Pages URL
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Bot Handlers ---

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """
    /start handler – no referral logic.
    Just saves the user (if not exists) and sends the welcome message.
    """
    user = message.from_user
    user_id = user.id
    username = user.username or ""

    # Insert or update user (no referred_by, no points)
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

# --- API endpoint for frontend ---
@app.get("/games")
async def get_games(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 20,
    offset: int = 0
):
    """
    Returns games from Supabase with optional filters.
    Used by the frontend (app.js) to fetch games securely.
    """
    try:
        query = supabase.table("games").select("*").order("id").range(offset, offset + limit - 1)
        if category and category != "🔥 Discover":
            # Remove emojis and trim to match DB category
            clean_cat = ''.join(ch for ch in category if ch.isalpha() or ch == ' ').strip()
            query = query.eq("category", clean_cat)
        if search:
            query = query.ilike("title", f"%{search}%")
        result = query.execute()
        return result.data
    except Exception as e:
        return {"error": str(e)}, 500

# --- Webhook endpoint ---
@app.post("/webhook")
async def webhook(request: Request):
    data = await request.json()
    update = types.Update(**data)
    await dp.feed_update(bot, update)
    return {"ok": True}

# --- Startup with retry logic for webhook ---
@app.on_event("startup")
async def startup():
    webhook_url = os.getenv("RENDER_EXTERNAL_URL")
    if not webhook_url:
        logging.error("RENDER_EXTERNAL_URL not set; webhook cannot be configured.")
        return
    webhook_url += "/webhook"
    
    # Retry up to 3 times with exponential backoff
    for attempt in range(3):
        try:
            await bot.set_webhook(webhook_url)
            logging.info(f"Webhook set successfully to {webhook_url}")
            break
        except Exception as e:
            logging.warning(f"Attempt {attempt+1} to set webhook failed: {e}")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)  # 1s, 2s
            else:
                logging.error("Failed to set webhook after 3 attempts. Bot may not receive updates.")

# For local testing
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
    
