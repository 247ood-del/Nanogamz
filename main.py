import os
import json
import logging
import asyncio
import threading
import random
import httpx
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from supabase import create_client, Client
import requests
from typing import Optional

# ---- Logging ----
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---- Config (common) ----
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
CPAGRIP_FEED_URL = os.getenv(
    "CPAGRIP_FEED_URL",
    "https://www.cpagrip.com/common/offer_feed_json.php?user_id=YOUR_ID&pubkey=YOUR_KEY"
)

# ---- Supabase client ----
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---- FastAPI app ----
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Mount static folders (common) ----
if os.path.exists("ads"):
    app.mount("/ads", StaticFiles(directory="ads"), name="ads")
else:
    logger.warning("ads folder not found – local images won't be served")

# ---- Public API endpoints (run on both Vercel and Render) ----

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/games")
async def get_games(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = 20,
    offset: int = 0,
    seed: Optional[int] = Query(None)
):
    try:
        query = supabase.table("games").select("*")
        if category and category != "🔥 Discover":
            clean_cat = ''.join(ch for ch in category if ch.isalnum() or ch == ' ' or ch == '-').strip()
            if clean_cat:
                query = query.ilike("category", clean_cat)
        if search:
            query = query.ilike("title", f"%{search}%")
        result = query.execute()
        games = result.data or []

        effective_seed = (seed or 0) + hash(category or "")
        r = random.Random(effective_seed)
        r.shuffle(games)

        paginated_games = games[offset : offset + limit]
        return paginated_games
    except Exception as e:
        return {"error": str(e)}, 500

# NEW: Fetch a single game by ID
@app.get("/game/{game_id}")
async def get_game_by_id(game_id: str):
    """Fetch a single game by its ID."""
    try:
        result = supabase.table("games").select("*").eq("id", game_id).execute()
        if not result.data:
            return {"error": "Game not found"}, 404
        return result.data[0]
    except Exception as e:
        logger.error(f"Error fetching game {game_id}: {e}")
        return {"error": str(e)}, 500

@app.get("/saved-games")
async def get_saved_games(
    telegram_id: int,
    limit: int = 20,
    offset: int = 0
):
    try:
        user_res = supabase.table("users").select("saved_games").eq("telegram_id", telegram_id).execute()
        if not user_res.data or not user_res.data[0].get("saved_games"):
            return []
        saved_ids = user_res.data[0]["saved_games"]
        if not saved_ids:
            return []
        games_res = supabase.table("games").select("*").in_("id", saved_ids).execute()
        games = games_res.data or []
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

@app.get("/recent-games")
async def get_recent_games(telegram_id: int):
    try:
        user_res = supabase.table("users").select("recent_games").eq("telegram_id", telegram_id).execute()
        if not user_res.data or not user_res.data[0].get("recent_games"):
            return []
        recent_ids = user_res.data[0]["recent_games"]
        if not recent_ids:
            return []
        games_res = supabase.table("games").select("*").in_("id", recent_ids).execute()
        games = games_res.data or []
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
        if game_id in current_recent:
            current_recent.remove(game_id)
        current_recent.insert(0, game_id)
        current_recent = current_recent[:10]
        supabase.table("users").update({"recent_games": current_recent}).eq("telegram_id", telegram_id).execute()
        return {"status": "success", "recent_games": current_recent}
    except Exception as e:
        logger.error(f"Error adding recent game: {e}")
        return {"status": "error", "message": str(e)}

# ---- Helper for CPA image extraction ----
def extract_adaptive_image(offer: dict) -> str:
    preferred_keys = [
        "offerphoto", "creative", "mobile_icon", "image",
        "image_url", "anchor_image", "picture", "banner", "thumbnail"
    ]
    for key in preferred_keys:
        val = offer.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val
    for k, v in offer.items():
        if isinstance(v, str) and v.startswith("http"):
            key_lower = k.lower()
            val_lower = v.lower()
            if any(term in key_lower for term in ["img", "image", "photo", "icon", "creative", "banner"]):
                return v
            if any(val_lower.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"]):
                return v
    return ""

def load_native_ads():
    NATIVE_ADS_FILE = os.path.join(os.path.dirname(__file__), "native_ads.json")
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

@app.get("/api/cpa-offers")
async def get_cpa_offers(request: Request):
    try:
        native_ads = load_native_ads()
        base_url = str(request.base_url).rstrip('/')
        for ad in native_ads:
            img = ad.get("image", "")
            if img and not img.startswith("http://") and not img.startswith("https://"):
                if img.startswith("/"):
                    img = img[1:]
                ad["image"] = f"{base_url}/{img}"

        client_ip = request.headers.get("x-forwarded-for", request.client.host)
        if client_ip and "," in client_ip:
            client_ip = client_ip.split(",")[0].strip()

        delimiter = "&" if "?" in CPAGRIP_FEED_URL else "?"
        feed_url = f"{CPAGRIP_FEED_URL}{delimiter}ip={client_ip}" if client_ip else CPAGRIP_FEED_URL

        response = requests.get(feed_url, timeout=6)
        data = response.json() if response.status_code == 200 else {}

        raw_offers = []
        if isinstance(data, dict):
            raw_offers = data.get("offers", [])
        elif isinstance(data, list):
            raw_offers = data

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
            img_url = extract_adaptive_image(offer)
            offer_title = offer.get("title", "Featured Offer")
            offer_link = offer.get("offerlink") or offer.get("link") or offer.get("url") or "#"
            offer_id = offer.get("offer_id") or offer.get("offerid") or offer.get("id") or ""
            if "www.cpagrip.com" in offer_link:
                offer_link = offer_link.replace("www.cpagrip.com", "motifiles.com")
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

        final_ads = []
        if cpa_ads:
            native_idx = 0
            for i, cpa_ad in enumerate(cpa_ads[:6]):
                final_ads.append(cpa_ad)
                if (i + 1) % 2 == 0 and native_ads:
                    final_ads.append(native_ads[native_idx % len(native_ads)])
                    native_idx += 1
        else:
            final_ads = native_ads

        return {"success": True, "ads": final_ads[:6]}
    except Exception as e:
        logger.error(f"CPA/Native endpoint error: {e}")
        native_ads = load_native_ads()
        base_url = str(request.base_url).rstrip('/')
        for ad in native_ads:
            img = ad.get("image", "")
            if img and not img.startswith("http://") and not img.startswith("https://"):
                if img.startswith("/"):
                    img = img[1:]
                ad["image"] = f"{base_url}/{img}"
        return {"success": True, "ads": native_ads}

# =============================================================================
#  BOT & WEBHOOK – DEFINED BEFORE THE ROOT STATIC MOUNT TO AVOID OVERRIDING
# =============================================================================
if os.getenv("BOT_TOKEN"):
    from aiogram import Bot, Dispatcher, types, F
    from aiogram.filters import Command
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, Update
    from aiogram.exceptions import TelegramBadRequest

    BOT_TOKEN = os.getenv("BOT_TOKEN")
    ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x]
    WEBAPP_URL = os.getenv("WEBAPP_URL")
    RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")

    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()

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

    _check_lock = asyncio.Lock()
    _sync_lock = asyncio.Lock()

    async def run_check_broken_and_notify(chat_id: int, message_id: int):
        if _check_lock.locked():
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text="⏳ A broken link check is already in progress. Please wait..."
            )
            return
        async with _check_lock:
            try:
                games = supabase.table("games").select("id, playable_url").execute()
                broken = []
                async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                    for game in games.data:
                        url = game.get("playable_url")
                        if not url:
                            broken.append(game["id"])
                            continue
                        try:
                            resp = await client.head(url)
                            if resp.status_code >= 400:
                                resp_get = await client.get(url)
                                if resp_get.status_code >= 400:
                                    broken.append(game["id"])
                        except Exception:
                            broken.append(game["id"])
                if broken:
                    for gid in broken:
                        supabase.table("games").delete().eq("id", gid).execute()
                    await bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text=f"🗑 Deleted {len(broken)} broken games from the database."
                    )
                else:
                    await bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text="✅ All game links are reachable."
                    )
            except Exception as e:
                logger.error(f"Broken links check error: {e}", exc_info=True)
                try:
                    await bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text=f"❌ Error during check: {str(e)[:200]}"
                    )
                except Exception:
                    pass

    @dp.callback_query(F.data == "admin_check_broken")
    async def admin_check_broken(callback: types.CallbackQuery):
        await callback.answer("Link check initiated...")
        chat_id = callback.message.chat.id
        message_id = callback.message.message_id
        await callback.message.edit_text("🔍 Checking broken links in background, please wait...")
        asyncio.create_task(run_check_broken_and_notify(chat_id, message_id))

    async def run_sync_and_notify(chat_id: int, message_id: int):
        if _sync_lock.locked():
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text="⏳ A sync is already in progress. Please wait..."
            )
            return
        async with _sync_lock:
            try:
                import sync_games
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

    # ======================== WEBHOOK ROUTES ========================

    @app.api_route("/api/telegram-webhook", methods=["GET", "POST"])
    async def telegram_webhook(request: Request):
        """Handle incoming Telegram updates (accepts both GET and POST)."""
        if request.method == "GET":
            return {"status": "Webhook endpoint is active"}
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

    @app.get("/api/set-webhook")
    async def set_webhook_manual(request: Request):
        """Manually set the webhook URL."""
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

    @app.get("/api/webhook-status")
    async def webhook_status():
        """Return current webhook info."""
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

    # ---- Startup event (only on Render) ----
    @app.on_event("startup")
    async def startup_render():
        if RENDER_EXTERNAL_URL:
            expected_url = f"{RENDER_EXTERNAL_URL.rstrip('/')}/api/telegram-webhook"
            try:
                current = await bot.get_webhook_info()
                if current.url == expected_url:
                    logger.info("Webhook already correctly set, skipping.")
                else:
                    await bot.set_webhook(url=expected_url, drop_pending_updates=True)
                    logger.info(f"Webhook set to {expected_url}")
            except Exception as e:
                logger.error(f"Failed to set webhook: {e}")

        # Start pinger
        import ping
        def start_pinger():
            ping.run_pinger()
        thread = threading.Thread(target=start_pinger, daemon=True)
        thread.start()
        logger.info("Background pinger started")

# ---- Serve static files (MUST BE LAST - catches any unmatched routes) ----
app.mount("/", StaticFiles(directory=os.path.dirname(__file__), html=True), name="static")
