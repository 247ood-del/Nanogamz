import os
import requests
import logging
from supabase import create_client, Client
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GAMEPIX_SID = os.getenv("GAMEPIX_SID", "F5123")

# List of (url_suffix, label) to try
FETCH_CONFIGS = [
    (f"?sid={GAMEPIX_SID}", "no pagination"),          # try without pagination first
    (f"?sid={GAMEPIX_SID}&pagination=96", "pagination=96")  # fallback
]

def fetch_gamepix_games():
    """
    Fetch games from GamePix, trying different URL configurations.
    Returns a list of game dicts (or empty on failure).
    """
    for url_suffix, label in FETCH_CONFIGS:
        url = f"https://feeds.gamepix.com/v2/json{url_suffix}"
        logger.info(f"Trying {label}: {url}")

        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code != 200:
                logger.warning(f"{label} returned status {resp.status_code}, skipping.")
                continue

            data = resp.json()

            # Parse response
            raw_items = []
            if isinstance(data, list):
                raw_items = data
            elif isinstance(data, dict):
                if "games" in data:
                    raw_items = data["games"]
                elif "items" in data:
                    raw_items = data["items"]
                else:
                    for val in data.values():
                        if isinstance(val, list):
                            raw_items = val
                            break

            if not raw_items:
                logger.info(f"{label} returned empty list, trying next.")
                continue

            logger.info(f"{label} returned {len(raw_items)} games.")

            # Process each item
            games = []
            for item in raw_items:
                raw_url = item.get("url") or item.get("link") or ""
                if not raw_url:
                    continue

                parsed = urlparse(raw_url)
                query = parse_qs(parsed.query)
                query["sid"] = GAMEPIX_SID
                new_query = urlencode(query, doseq=True)
                playable_url = urlunparse(parsed._replace(query=new_query))

                game_id = str(item.get("id") or item.get("guid") or hash(raw_url))
                title = item.get("title") or item.get("name") or "Unnamed Game"
                thumbnail = item.get("thumbnailUrl") or item.get("thumbnail") or item.get("image") or ""
                category = item.get("category") or "Other"

                games.append({
                    "id": game_id,
                    "title": title,
                    "thumbnail": thumbnail,
                    "playable_url": playable_url,
                    "category": category,
                    "updated_at": datetime.utcnow().isoformat()
                })

            if games:
                logger.info(f"Successfully fetched {len(games)} games with {label}.")
                return games
            else:
                logger.warning(f"{label} returned 0 games, trying next.")

        except Exception as e:
            logger.error(f"Error with {label}: {e}", exc_info=True)
            continue

    # If we exhaust all configs, return empty
    logger.error("All fetch configurations failed. No games fetched.")
    return []


def insert_new_games(supabase: Client, games):
    """
    Bulk insert only games whose ID does not already exist.
    Returns the number of newly inserted games.
    """
    if not games:
        return 0

    try:
        response = supabase.table("games").select("id").execute()
        existing_ids = {row["id"] for row in response.data}
    except Exception as e:
        logger.error(f"Failed to fetch existing IDs: {e}")
        return 0

    new_games = [g for g in games if g["id"] not in existing_ids]
    if not new_games:
        logger.info("No new games to insert.")
        return 0

    try:
        supabase.table("games").insert(new_games).execute()
        logger.info(f"Inserted {len(new_games)} new games.")
        return len(new_games)
    except Exception as e:
        logger.error(f"Bulk insert failed: {e}")
        return 0


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.error("Missing Supabase credentials.")
        return
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    games = fetch_gamepix_games()
    if games:
        inserted = insert_new_games(supabase, games)
        logger.info(f"✅ Sync complete! Inserted {inserted} new games.")
    else:
        logger.warning("❌ No games fetched.")

if __name__ == "__main__":
    main()
    
