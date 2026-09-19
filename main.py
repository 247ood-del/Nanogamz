import os
import json
import logging
import asyncio
import threading
import random
import httpx
from datetime import datetime, timedelta
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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
# ImgBB API key for image uploads (support chat images now live on ImgBB)
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")

# Module-level admin list (used by both support endpoints and bot)
ADMIN_IDS = [int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x]

# Auto-reply message shown to users on their first message
SUPPORT_AUTO_REPLY = (
    "Thanks for reaching out! 🙏\n\n"
    "Our support team has received your message and will respond within 24 hours."
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

# ---- Base directory ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- Mount static folders ----
if os.path.exists("ads"):
    app.mount("/ads", StaticFiles(directory="ads"), name="ads")
else:
    logger.warning("ads folder not found – local images won't be served")

# ---- Public API endpoints ----

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

@app.get("/game/{game_id}")
async def get_game_by_id(game_id: str):
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

# =============================================================================
#  SUPPORT CHAT ENDPOINTS
# =============================================================================

# Tracks when cleanup last ran, so we only run it once per hour even if many
# requests hit the user-messages endpoint.
_last_cleanup_at = None
_cleanup_lock = threading.Lock()
_CLEANUP_INTERVAL_SECONDS = 3600


def _fire_imgbb_delete(delete_url: str):
    """Fire-and-forget deletion of an ImgBB image via its delete URL.
    Runs in a daemon thread so cleanup isn't blocked by network I/O."""
    if not delete_url:
        return

    def _worker():
        try:
            r = requests.get(delete_url, timeout=10, allow_redirects=True)
            logger.info(f"ImgBB delete attempted ({r.status_code}): {delete_url}")
        except Exception as e:
            logger.warning(f"ImgBB delete failed for {delete_url}: {e}")

    threading.Thread(target=_worker, daemon=True).start()


def cleanup_old_support_conversations():
    """Delete all messages for conversations whose latest message is older
    than 7 days, and also request deletion of any ImgBB images they contain."""
    try:
        cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()

        # NOTE: 'image_delete_url' column must exist (see migration SQL).
        try:
            msgs = (
                supabase.table("support_messages")
                .select("telegram_id, created_at, message, image_delete_url")
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as col_err:
            # Fallback if the new column hasn't been added yet — still cleans Supabase.
            logger.warning(
                f"Falling back to legacy cleanup (image_delete_url column missing?): {col_err}"
            )
            msgs = (
                supabase.table("support_messages")
                .select("telegram_id, created_at, message")
                .order("created_at", desc=True)
                .execute()
            )

        data = msgs.data or []

        # Find conversations whose latest message is older than the cutoff.
        seen = set()
        to_delete = set()
        for m in data:
            tid = m["telegram_id"]
            if tid in seen:
                continue
            seen.add(tid)
            if (m.get("created_at") or "") < cutoff:
                to_delete.add(tid)

        if not to_delete:
            return

        # Collect ImgBB delete URLs for the messages we're about to purge.
        img_delete_urls = []
        for m in data:
            if m["telegram_id"] in to_delete:
                du = m.get("image_delete_url")
                if du:
                    img_delete_urls.append(du)

        # Fire-and-forget ImgBB deletions (won't block the response).
        for du in img_delete_urls:
            _fire_imgbb_delete(du)

        # Purge from Supabase.
        supabase.table("support_messages").delete().in_(
            "telegram_id", list(to_delete)
        ).execute()

        logger.info(
            f"Cleaned up {len(to_delete)} inactive support conversations "
            f"({len(img_delete_urls)} ImgBB images queued for deletion)."
        )
    except Exception as e:
        logger.error(f"Support cleanup error: {e}")


def _maybe_cleanup_old_conversations():
    """Throttled cleanup — runs at most once per hour. Called from user-facing
    endpoints so we don't rely solely on admin activity to trigger it."""
    global _last_cleanup_at
    now = datetime.utcnow()
    if _last_cleanup_at and (now - _last_cleanup_at).total_seconds() < _CLEANUP_INTERVAL_SECONDS:
        return
    with _cleanup_lock:
        if _last_cleanup_at and (now - _last_cleanup_at).total_seconds() < _CLEANUP_INTERVAL_SECONDS:
            return
        _last_cleanup_at = now
    try:
        cleanup_old_support_conversations()
    except Exception as e:
        logger.error(f"Background cleanup error: {e}")


@app.get("/api/support/is-admin")
async def support_is_admin(telegram_id: int):
    return {"is_admin": telegram_id in ADMIN_IDS}


# =============================================================================
#  IMAGE UPLOAD PROXY (ImgBB)
# =============================================================================
@app.post("/api/support/upload-image")
async def support_upload_image(request: Request):
    """
    Accepts JSON: { "image": "<base64 or data-url>" } and proxies it to ImgBB.
    Returns: { "status": "success", "url": "...", "delete_url": "..." }
    The frontend then sends the URL as a normal support message with the
    `__IMG__` prefix, and stores the delete_url so we can purge it later.
    """
    if not IMGBB_API_KEY:
        logger.error("IMGBB_API_KEY is not set on the server.")
        return {"status": "error", "message": "Image upload is not configured."}, 500

    try:
        data = await request.json()
    except Exception as e:
        logger.error(f"upload-image JSON parse error (payload may be too large): {e}")
        return {"status": "error", "message": "Invalid or oversized payload."}, 413

    image_data = data.get("image") or ""
    if not image_data:
        return {"status": "error", "message": "Missing image data."}, 400

    # Strip `data:image/...;base64,` prefix if the client sent one.
    if image_data.startswith("data:"):
        try:
            image_data = image_data.split(",", 1)[1]
        except Exception:
            return {"status": "error", "message": "Malformed data URL."}, 400

    # Soft size check on the base64 string (~7 MB decoded).
    if len(image_data) > 9_500_000:
        return {"status": "error", "message": "Image is too large."}, 413

    try:
        resp = requests.post(
            "https://api.imgbb.com/1/upload",
            data={"key": IMGBB_API_KEY, "image": image_data},
            timeout=30,
        )
        try:
            result = resp.json()
        except Exception:
            result = {}

        if resp.status_code == 200 and isinstance(result, dict) and result.get("success"):
            payload = result.get("data") or {}
            url = (
                payload.get("display_url")
                or payload.get("url")
                or (payload.get("thumb") or {}).get("url")
            )
            delete_url = payload.get("delete_url") or ""
            if url:
                logger.info(f"ImgBB upload OK: {url}")
                return {
                    "status": "success",
                    "url": url,
                    "delete_url": delete_url,
                }

        logger.error(f"ImgBB upload failed: status={resp.status_code} body={str(result)[:300]}")
        return {"status": "error", "message": "ImgBB upload failed."}, 502
    except Exception as e:
        logger.error(f"ImgBB proxy error: {e}")
        return {"status": "error", "message": str(e)}, 500


@app.post("/api/support/send")
async def support_send(request: Request):
    try:
        data = await request.json()
    except Exception as parse_err:
        logger.error(f"Failed to parse request JSON (payload may be too large): {parse_err}")
        return {
            "status": "error",
            "message": "Payload too large. Please select a smaller image."
        }, 413

    telegram_id = data.get("telegram_id")
    message = (data.get("message") or "").strip()
    sender = data.get("sender", "user")
    first_name = data.get("first_name") or ""
    username = data.get("username") or ""
    photo_url = data.get("photo_url") or ""
    admin_id = data.get("admin_id")
    image_delete_url = data.get("image_delete_url") or None

    if not telegram_id or not message:
        return {"status": "error", "message": "Missing parameters"}

    if sender == "admin" and admin_id not in ADMIN_IDS:
        return {"status": "error", "message": "Unauthorized"}

    try:
        should_auto_reply = False
        if sender == "user":
            last_msgs = (
                supabase.table("support_messages")
                .select("*")
                .eq("telegram_id", telegram_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if not last_msgs.data or not last_msgs.data[0].get("is_auto_reply"):
                should_auto_reply = True

        # Insert with image_delete_url. If the column doesn't exist, we catch
        # the error and retry without it so the message is still delivered.
        row = {
            "telegram_id": telegram_id,
            "sender": sender,
            "message": message,
            "first_name": first_name,
            "username": username,
            "photo_url": photo_url,
            "read_by_admin": (sender == "admin"),
            "read_by_user": (sender == "user"),
            "is_auto_reply": False,
            "image_delete_url": image_delete_url,
        }
        try:
            supabase.table("support_messages").insert(row).execute()
        except Exception as insert_err:
            logger.warning(f"Insert with image_delete_url failed, retrying without: {insert_err}")
            row.pop("image_delete_url", None)
            supabase.table("support_messages").insert(row).execute()

        if should_auto_reply:
            supabase.table("support_messages").insert({
                "telegram_id": telegram_id,
                "sender": "admin",
                "message": SUPPORT_AUTO_REPLY,
                "first_name": first_name,
                "username": username,
                "photo_url": photo_url,
                "read_by_admin": True,
                "read_by_user": False,
                "is_auto_reply": True
            }).execute()

        return {"status": "success"}
    except Exception as e:
        logger.error(f"Support send error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/support/messages")
async def support_messages(
    telegram_id: int,
    since_id: Optional[int] = None,
    before_id: Optional[int] = None,
    limit: Optional[int] = None,
):
    """
    Paginated support messages endpoint.

    Three modes:
      • since_id  → poll for messages NEWER than that id (ascending). Used by
                    the 5s polling loop. has_more is always False here.
      • before_id → load the previous page of OLDER messages. Server fetches
                    DESC (newest-first) with `limit`, then reverses so the
                    client always receives them in chronological order.
                    has_more = (rows returned == limit).
      • (neither) → initial load. Returns the LATEST `limit` messages in
                    chronological order. has_more = (rows returned == limit).

    The 7-day cleanup routine runs in a background thread so it never blocks
    the response.
    """
    # Kick off the throttled cleanup in the background so user-facing requests
    # stay fast and cleanup happens regularly even without admin activity.
    threading.Thread(target=_maybe_cleanup_old_conversations, daemon=True).start()

    try:
        base_query = (
            supabase.table("support_messages")
            .select("*")
            .eq("telegram_id", telegram_id)
        )

        # --- Poll for NEWER messages (ascending from since_id) ---
        if since_id:
            result = base_query.gt("id", since_id).order("id").execute()
            return {
                "status": "success",
                "messages": result.data or [],
                "has_more": False,
            }

        # --- Load a page of OLDER messages (paginate backwards) ---
        if before_id:
            q = base_query.lt("id", before_id).order("id", desc=True)
            if limit:
                q = q.limit(limit)
            result = q.execute()
            msgs = list(reversed(result.data or []))
            has_more = bool(limit and len(msgs) == limit)
            return {
                "status": "success",
                "messages": msgs,
                "has_more": has_more,
            }

        # --- Initial load: return the LATEST `limit` messages (ascending) ---
        q = base_query.order("id", desc=True)
        if limit:
            q = q.limit(limit)
        result = q.execute()
        msgs = list(reversed(result.data or []))
        has_more = bool(limit and len(msgs) == limit)
        return {
            "status": "success",
            "messages": msgs,
            "has_more": has_more,
        }
    except Exception as e:
        logger.error(f"Support messages error: {e}")
        return {"status": "error", "messages": []}


@app.get("/api/support/unread-count")
async def support_unread_count(telegram_id: int):
    try:
        result = (
            supabase.table("support_messages")
            .select("id", count="exact")
            .eq("telegram_id", telegram_id)
            .eq("sender", "admin")
            .eq("read_by_user", False)
            .execute()
        )
        return {"count": result.count or 0}
    except Exception as e:
        logger.error(f"Unread count error: {e}")
        return {"count": 0}


@app.get("/api/support/conversations")
async def support_conversations(admin_id: int):
    if admin_id not in ADMIN_IDS:
        return {"status": "error", "message": "Unauthorized", "conversations": []}
    try:
        cleanup_old_support_conversations()

        msgs = (
            supabase.table("support_messages")
            .select("*")
            .order("created_at", desc=True)
            .limit(2000)
            .execute()
        )

        convos = {}
        for m in (msgs.data or []):
            tid = m["telegram_id"]
            if tid not in convos:
                raw_last = m.get("message", "") or ""
                if raw_last.startswith("__IMG__"):
                    preview = "📷 Image"
                else:
                    preview = raw_last
                convos[tid] = {
                    "telegram_id": tid,
                    "first_name": "",
                    "username": "",
                    "photo_url": "",
                    "last_message": preview,
                    "last_message_at": m.get("created_at"),
                    "last_sender": m.get("sender"),
                    "unread_count": 0
                }
            if not convos[tid]["first_name"] and m.get("first_name"):
                convos[tid]["first_name"] = m["first_name"]
            if not convos[tid]["photo_url"] and m.get("photo_url"):
                convos[tid]["photo_url"] = m["photo_url"]
            if not convos[tid]["username"] and m.get("username"):
                convos[tid]["username"] = m["username"]

            if m.get("sender") == "user" and not m.get("read_by_admin"):
                convos[tid]["unread_count"] += 1

        for c in convos.values():
            if not c["first_name"]:
                c["first_name"] = "User"

        convos_list = sorted(
            convos.values(),
            key=lambda x: x.get("last_message_at") or "",
            reverse=True
        )
        return {"status": "success", "conversations": convos_list}
    except Exception as e:
        logger.error(f"Support conversations error: {e}")
        return {"status": "error", "conversations": []}


@app.post("/api/support/mark-read")
async def support_mark_read(request: Request):
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        viewer = data.get("viewer")
        if not telegram_id or viewer not in ("admin", "user"):
            return {"status": "error", "message": "Missing parameters"}
        field = "read_by_admin" if viewer == "admin" else "read_by_user"
        opposite_sender = "user" if viewer == "admin" else "admin"
        supabase.table("support_messages").update({field: True}) \
            .eq("telegram_id", telegram_id).eq("sender", opposite_sender).execute()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Support mark-read error: {e}")
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
#  BOT & WEBHOOK
# =============================================================================
if os.getenv("BOT_TOKEN"):
    from aiogram import Bot, Dispatcher, types, F
    from aiogram.filters import Command
    from aiogram.types import (
        InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, Update,
        InputMediaPhoto, InputMediaVideo
    )
    from aiogram.exceptions import TelegramBadRequest

    BOT_TOKEN = os.getenv("BOT_TOKEN")
    WEBAPP_URL = os.getenv("WEBAPP_URL")
    RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL")

    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()

    def parse_pipe_message(raw: str):
        parts = [p.strip() for p in raw.split('|')]
        if len(parts) != 3:
            raise ValueError("Expected 3 parts separated by '|': text | button label | URL")
        text, btn_text, url = parts
        if not url.startswith(('http://', 'https://')):
            raise ValueError("URL must start with http:// or https://")
        return text, btn_text, url

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

    @dp.message(Command("post"), F.from_user.id.in_(ADMIN_IDS))
    async def cmd_post(message: types.Message):
        try:
            raw = message.text.replace('/post', '', 1).strip()
            if not raw:
                await message.reply("❌ Please provide the message in the format:\n`/post Your text | Button label | https://example.com`", parse_mode="Markdown")
                return
            text, btn_text, url = parse_pipe_message(raw)
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text=btn_text, url=url)]
            ])
            await bot.send_message(
                chat_id="@nanogamz",
                text=text,
                reply_markup=keyboard,
                parse_mode="Markdown"
            )
            await message.reply("✅ Post published to @nanogamz.")
        except ValueError as e:
            await message.reply(f"❌ Error: {e}\n\nUse format:\n`/post Your text | Button label | https://example.com`", parse_mode="Markdown")
        except Exception as e:
            logger.error(f"Error in /post: {e}")
            await message.reply(f"❌ Failed to send post: {str(e)[:200]}")

    album_storage = {}

    async def process_album_after_delay(group_id: str, admin_chat_id: int):
        await asyncio.sleep(1.5)
        messages = album_storage.pop(group_id, [])
        if not messages:
            return
        raw_caption = next((m.caption for m in messages if m.caption), None)
        if raw_caption and raw_caption.startswith('/post'):
            raw_caption = raw_caption.replace('/post', '', 1).strip()

        caption, btn_text, url = None, None, None
        if raw_caption and '|' in raw_caption:
            try:
                caption, btn_text, url = parse_pipe_message(raw_caption.strip())
            except Exception as e:
                logger.error(f"Pipe parse error: {e}")

        media_list = []
        for idx, m in enumerate(messages):
            item_caption = caption if idx == 0 else None
            parse_mode = "Markdown" if idx == 0 and caption else None
            if m.photo:
                media_list.append(InputMediaPhoto(
                    media=m.photo[-1].file_id,
                    caption=item_caption,
                    parse_mode=parse_mode
                ))
            elif m.video:
                media_list.append(InputMediaVideo(
                    media=m.video.file_id,
                    caption=item_caption,
                    parse_mode=parse_mode
                ))

        try:
            await bot.send_media_group(chat_id="@nanogamz", media=media_list)
            if btn_text and url:
                keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=btn_text, url=url)]])
                await bot.send_message(
                    chat_id="@nanogamz",
                    text="👇 **probably nothing, probably something**",
                    reply_markup=keyboard,
                    parse_mode="Markdown"
                )
            await bot.send_message(chat_id=admin_chat_id, text="✅ Album published to @nanogamz.")
        except Exception as e:
            logger.error(f"Error publishing album: {e}")
            await bot.send_message(chat_id=admin_chat_id, text=f"❌ Album failed: {str(e)[:200]}")

    @dp.message(F.photo | F.video, F.from_user.id.in_(ADMIN_IDS))
    async def handle_media_post(message: types.Message):
        try:
            if message.media_group_id:
                gid = message.media_group_id
                if gid not in album_storage:
                    album_storage[gid] = []
                    asyncio.create_task(process_album_after_delay(gid, message.chat.id))
                album_storage[gid].append(message)
                return

            if not message.caption:
                await message.reply("❌ Please provide a caption in the format:\n`Caption text | Button label | https://example.com`", parse_mode="Markdown")
                return

            raw_caption = message.caption.strip()
            if raw_caption.startswith('/post'):
                raw_caption = raw_caption.replace('/post', '', 1).strip()

            caption, btn_text, url = parse_pipe_message(raw_caption)
            keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=btn_text, url=url)]])

            if message.photo:
                await bot.send_photo(chat_id="@nanogamz", photo=message.photo[-1].file_id, caption=caption, reply_markup=keyboard, parse_mode="Markdown")
            elif message.video:
                await bot.send_video(chat_id="@nanogamz", video=message.video.file_id, caption=caption, reply_markup=keyboard, parse_mode="Markdown")

            await message.reply("✅ Media post published to @nanogamz.")
        except ValueError as e:
            await message.reply(f"❌ Format Error: {e}\n\nUse format:\n`Caption text | Button label | https://example.com`", parse_mode="Markdown")
        except Exception as e:
            logger.error(f"Error in media broadcast: {e}")
            await message.reply(f"❌ Failed to send media post: {str(e)[:200]}")

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

    @app.on_event("startup")
    async def startup_render():
        try:
            cleanup_old_support_conversations()
        except Exception as e:
            logger.error(f"Startup support cleanup error: {e}")

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

        import ping
        def start_pinger():
            ping.run_pinger()
        thread = threading.Thread(target=start_pinger, daemon=True)
        thread.start()
        logger.info("Background pinger started")

# =============================================================================
#  ROOT STATIC SERVING
# =============================================================================
@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
