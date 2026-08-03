import os
import json
import logging
import asyncio
import threading
import random
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from supabase import create_client, Client
import requests
import sync_games
import ping
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
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")

# CPAGrip feed URL (from environment)
CPAGRIP_FEED_URL = os.getenv(
    "CPAGRIP_FEED_URL",
    "https://www.cpagrip.com/common/offer_feed_json.php?user_id=YOUR_ID&pubkey=YOUR_KEY"
)

# --- Native / House Ads Configuration (from file or fallback) ---
NATIVE_ADS_FILE = os.path.join(os.path.dirname(__file__), "native_ads.json")

def load_native_ads():
    """Load native ads from JSON file – expects each item to have 'image' and 'link'.
       'title' is optional; falls back to 'Featured' if missing.
       Invalid entries (missing image/link) are skipped.
    """
    try:
        with open(NATIVE_ADS_FILE, "r", encoding="utf-8") as f:
            raw_ads = json.load(f)
            if not isinstance(raw_ads, list):
                raise ValueError("Expected a list")
            ads = []
            for item in raw_ads:
                image = item.get("image")
                link = item.get("link")
                if not image or not link:
                    logger.warning(f"Skipping ad: missing image or link - {item}")
                    continue
                ads.append({
                    "id": item.get("id", f"native_{len(ads)}"),
                    "title": item.get("title", "Featured"),
                    "image": image,
                    "link": link,
                    "description": item.get("description", "")
                })
            if ads:
                return ads
    except Exception as e:
        logger.warning(f"Could not load native_ads.json: {e}. Using fallback.")
    
    # Fallback hardcoded ads (simplified)
    return [
        {
            "id": "native_1",
            "title": "Join Nanogamz VIP Club!",
            "image": "ads/VIP.png",
            "link": "https://t.me/nanogamz",
            "description": ""
        },
        {
            "id": "native_2",
            "title": "Promote Your Game Here",
            "image": "https://placehold.co/600x200/00b894/ffffff.png?text=Promote+Your+App",
            "link": "https://t.me/nanogamz",
            "description": ""
        }
    ]

# --- Helper function to extract image URL from offer dict adaptively ---
def extract_adaptive_image(offer: dict) -> str:
    """Recursively checks for common image key names or any URL ending in standard image extensions."""
    # 1. Preferred keys list in order of priority
    preferred_keys = [
        "offerphoto", "creative", "mobile_icon", "image", 
        "image_url", "anchor_image", "picture", "banner", "thumbnail"
    ]
    
    for key in preferred_keys:
        val = offer.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val

    # 2. Dynamic Fallback: Loop through all keys to find any key with 'img'/'photo'/'icon'
    # or any value pointing to an image file format
    for k, v in offer.items():
        if isinstance(v, str) and v.startswith("http"):
            key_lower = k.lower()
            val_lower = v.lower()
            if any(term in key_lower for term in ["img", "image", "photo", "icon", "creative", "banner"]):
                return v
            if any(val_lower.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"]):
                return v

    return ""

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

# --- Mount static folder for local ads ---
if os.path.exists("ads"):
    app.mount("/ads", StaticFiles(directory="ads"), name="ads")
else:
    logger.warning("ads folder not found – local images won't be served")

# --- Include webhook router ---
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
    offset: int = 0,
    seed: Optional[int] = Query(None)
):
    try:
        # 1. Fetch matching games (without ordering by ID)
        query = supabase.table("games").select("*")
        if category and category != "🔥 Discover":
            # Remove emojis and keep only alphabetic characters and spaces
            clean_cat = ''.join(ch for ch in category if ch.isalnum() or ch == ' ' or ch == '-').strip()
            if clean_cat:
                query = query.ilike("category", clean_cat)
        if search:
            query = query.ilike("title", f"%{search}%")
        result = query.execute()
        games = result.data or []

        # 2. Combine seed with category to create a deterministic but action‑dependent shuffle
        effective_seed = (seed or 0) + hash(category or "")
        r = random.Random(effective_seed)
        r.shuffle(games)

        # 3. Paginate the shuffled list
        paginated_games = games[offset : offset + limit]
        return paginated_games

    except Exception as e:
        return {"error": str(e)}, 500

# --- Saved Games Endpoints ---
@app.get("/saved-games")
async def get_saved_games(
    telegram_id: int,
    limit: int = 20,
    offset: int = 0
):
    try:
        # 1. Get saved_games list for user
        user_res = supabase.table("users").select("saved_games").eq("telegram_id", telegram_id).execute()
        if not user_res.data or not user_res.data[0].get("saved_games"):
            return []

        saved_ids = user_res.data[0]["saved_games"]
        if not saved_ids:
            return []

        # 2. Fetch full game details for these IDs
        games_res = supabase.table("games").select("*").in_("id", saved_ids).execute()
        games = games_res.data or []

        # 3. Paginate
        return games[offset : offset + limit]
    except Exception as e:
        logger.error(f"Error fetching saved games: {e}")
        return []

@app.post("/toggle-save-game")
async def toggle_save_game(request: Request):
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        game_id = str(data.get("game_id"))

        if not telegram_id or not game_id:
            return {"status": "error", "message": "Missing telegram_id or game_id"}

        # Get current saved list
        user_res = supabase.table("users").select("saved_games").eq("telegram_id", telegram_id).execute()
        current_saved = []
        if user_res.data and user_res.data[0].get("saved_games"):
            current_saved = user_res.data[0]["saved_games"]

        if game_id in current_saved:
            current_saved.remove(game_id)
            is_saved = False
        else:
            current_saved.append(game_id)
            is_saved = True

        supabase.table("users").update({"saved_games": current_saved}).eq("telegram_id", telegram_id).execute()
        return {"status": "success", "is_saved": is_saved, "saved_games": current_saved}
    except Exception as e:
        logger.error(f"Error toggling saved game: {e}")
        return {"status": "error", "message": str(e)}

# --- Recent Games Endpoints ---
@app.get("/recent-games")
async def get_recent_games(telegram_id: int):
    try:
        user_res = supabase.table("users").select("recent_games").eq("telegram_id", telegram_id).execute()
        if not user_res.data or not user_res.data[0].get("recent_games"):
            return []

        recent_ids = user_res.data[0]["recent_games"]
        if not recent_ids:
            return []

        # Fetch full game records for these IDs
        games_res = supabase.table("games").select("*").in_("id", recent_ids).execute()
        games = games_res.data or []

        # Map back to preserve order from most recent to oldest
        game_dict = {str(g["id"]): g for g in games}
        ordered_games = [game_dict[str(gid)] for gid in recent_ids if str(gid) in game_dict]

        return ordered_games
    except Exception as e:
        logger.error(f"Error fetching recent games: {e}")
        return []

@app.post("/add-recent-game")
async def add_recent_game(request: Request):
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        game_id = str(data.get("game_id"))

        if not telegram_id or not game_id:
            return {"status": "error", "message": "Missing parameters"}

        user_res = supabase.table("users").select("recent_games").eq("telegram_id", telegram_id).execute()
        current_recent = []
        if user_res.data and user_res.data[0].get("recent_games"):
            current_recent = [str(x) for x in user_res.data[0]["recent_games"]]

        # Remove if already exists, then prepend to top (most recent first)
        if game_id in current_recent:
            current_recent.remove(game_id)
        current_recent.insert(0, game_id)

        # Keep last 10 games max
        current_recent = current_recent[:10]

        supabase.table("users").update({"recent_games": current_recent}).eq("telegram_id", telegram_id).execute()
        return {"status": "success", "recent_games": current_recent}
    except Exception as e:
        logger.error(f"Error adding recent game: {e}")
        return {"status": "error", "message": str(e)}

# ========== CPAGrip + Native Hybrid Offers Endpoint ==========
@app.get("/api/cpa-offers")
async def get_cpa_offers(request: Request):
    """Fetches live CPAGrip offers mixed intelligently with custom native ads from JSON file."""
    try:
        # Load native ads fresh from file each request
        native_ads = load_native_ads()

        # Convert any local image paths to absolute URLs
        base_url = str(request.base_url).rstrip('/')
        for ad in native_ads:
            img = ad.get("image", "")
            if img and not img.startswith("http://") and not img.startswith("https://"):
                if img.startswith("/"):
                    img = img[1:]
                ad["image"] = f"{base_url}/{img}"

        # Extract client IP for geo-targeting
        client_ip = request.headers.get("x-forwarded-for", request.client.host)
        if client_ip and "," in client_ip:
            client_ip = client_ip.split(",")[0].strip()

        # 1. Fetch CPAGrip offers
        delimiter = "&" if "?" in CPAGRIP_FEED_URL else "?"
        feed_url = f"{CPAGRIP_FEED_URL}{delimiter}ip={client_ip}" if client_ip else CPAGRIP_FEED_URL

        response = requests.get(feed_url, timeout=6)
        data = response.json() if response.status_code == 200 else {}

        raw_offers = []
        if isinstance(data, dict):
            raw_offers = data.get("offers", [])
        elif isinstance(data, list):
            raw_offers = data

        # Fallback to no-IP feed if needed
        if not raw_offers and client_ip:
            fallback_resp = requests.get(CPAGRIP_FEED_URL, timeout=6)
            if fallback_resp.status_code == 200:
                fallback_data = fallback_resp.json()
                if isinstance(fallback_data, dict):
                    raw_offers = fallback_data.get("offers", [])
                elif isinstance(fallback_data, list):
                    raw_offers = fallback_data

        cpa_ads = []
        for offer in raw_offers:
            # Use the adaptive helper to extract image URL
            img_url = extract_adaptive_image(offer)

            offer_title = offer.get("title", "Featured Offer")
            offer_link = offer.get("offerlink") or offer.get("link") or offer.get("url") or "#"
            offer_id = offer.get("offer_id") or offer.get("offerid") or offer.get("id") or ""

            if "www.cpagrip.com" in offer_link:
                offer_link = offer_link.replace("www.cpagrip.com", "motifiles.com")

            # Final fallback only if no valid image string could be dynamically located
            if not img_url:
                encoded_title = requests.utils.quote(offer_title)
                img_url = f"https://placehold.co/600x200/6c5ce7/ffffff.png?text={encoded_title}"

            cpa_ads.append({
                "id": f"cpa_{offer_id}",
                "title": offer_title,
                "link": offer_link,
                "image": img_url,
                "description": offer.get("description", "")
            })

        # 2. Hybrid mixing & Fallback strategy
        final_ads = []

        if cpa_ads:
            # Insert a native ad every 2 CPAGrip ads (or mix them)
            native_idx = 0
            for i, cpa_ad in enumerate(cpa_ads[:6]):
                final_ads.append(cpa_ad)
                # Inject a native house ad after every 2 CPA offers
                if (i + 1) % 2 == 0 and native_ads:
                    final_ads.append(native_ads[native_idx % len(native_ads)])
                    native_idx += 1
        else:
            # FALLBACK: If CPAGrip completely fails, serve 100% native house ads
            final_ads = native_ads

        return {"success": True, "ads": final_ads[:6]}

    except Exception as e:
        logger.error(f"CPA/Native endpoint error: {e}")
        # Absolute fallback to native ads on exception
        native_ads = load_native_ads()
        # Convert paths again
        base_url = str(request.base_url).rstrip('/')
        for ad in native_ads:
            img = ad.get("image", "")
            if img and not img.startswith("http://") and not img.startswith("https://"):
                if img.startswith("/"):
                    img = img[1:]
                ad["image"] = f"{base_url}/{img}"
        return {"success": True, "ads": native_ads}

# --- Bot Handlers (unchanged) ---
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

# --- Sync lock and background task ---
_sync_lock = asyncio.Lock()

async def run_sync_and_notify(chat_id: int, message_id: int):
    try:
        if _sync_lock.locked():
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text="⏳ A sync is already in progress. Please wait..."
            )
            return

        async with _sync_lock:
            games = await asyncio.to_thread(sync_games.fetch_gamepix_games)
            if not games:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id,
                    text="❌ Sync failed or no games found."
                )
                return

            inserted = await asyncio.to_thread(
                sync_games.insert_new_games, supabase, games
            )

            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=f"✅ Synced {inserted} new games from GamePix."
            )
    except Exception as e:
        logger.error(f"Background sync error: {e}", exc_info=True)
        try:
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=f"❌ Sync error: {str(e)[:200]}"
            )
        except Exception:
            pass

@dp.callback_query(F.data == "admin_sync_games")
async def admin_sync_games(callback: types.CallbackQuery):
    await callback.answer("Sync started...")
    chat_id = callback.message.chat.id
    message_id = callback.message.message_id
    await callback.message.edit_text("🔄 Syncing games from GamePix, please wait...")
    asyncio.create_task(run_sync_and_notify(chat_id, message_id))

# ========== WEBHOOK SETUP ==========
async def set_webhook_async():
    if not RENDER_EXTERNAL_URL:
        logger.warning("RENDER_EXTERNAL_URL not set; webhook will not be set.")
        return

    expected_url = f"{RENDER_EXTERNAL_URL.rstrip('/')}/api/telegram-webhook"

    try:
        current = await bot.get_webhook_info()
        if current.url == expected_url:
            logger.info("Webhook already correctly set, skipping.")
            return
    except Exception as e:
        logger.warning(f"Failed to get current webhook info: {e}")

    try:
        await bot.set_webhook(url=expected_url, drop_pending_updates=True)
        logger.info(f"Webhook set to {expected_url}")
    except Exception as e:
        logger.error(f"Failed to set webhook: {e}")

@app.on_event("startup")
async def startup():
    await set_webhook_async()
    def start_pinger():
        ping.run_pinger()
    thread = threading.Thread(target=start_pinger, daemon=True)
    thread.start()
    logger.info("Background pinger started")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
    
