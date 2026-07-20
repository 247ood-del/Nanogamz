# sync_games.py
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

GAMEPIX_FEED = f"https://feeds.gamepix.com/v2/json?sid={GAMEPIX_SID}&pagination=96"

def fetch_gamepix_games():
    # ... (unchanged, exactly as before) ...
    try:
        logger.info(f"Fetching master feed from: {GAMEPIX_FEED}")
        resp = requests.get(GAMEPIX_FEED, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        
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
            logger.error(f"Could not find a valid list of games. Keys: {list(data.keys()) if isinstance(data, dict) else 'None'}")
            return []

        logger.info(f"Located {len(raw_items)} raw entries. Processing...")
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
        return games
    except Exception as e:
        logger.error(f"Critical sync failure: {e}", exc_info=True)
        return []


def insert_new_games(supabase: Client, games):
    """
    Bulk insert only games whose ID does not already exist in the table.
    Returns the number of newly inserted games.
    """
    if not games:
        return 0

    # 1. Fetch all existing IDs
    try:
        response = supabase.table("games").select("id").execute()
        existing_ids = {row["id"] for row in response.data}
    except Exception as e:
        logger.error(f"Failed to fetch existing game IDs: {e}")
        return 0

    # 2. Filter out existing IDs
    new_games = [g for g in games if g["id"] not in existing_ids]

    if not new_games:
        logger.info("No new games to insert.")
        return 0

    # 3. Bulk insert the new ones
    try:
        supabase.table("games").insert(new_games).execute()
        logger.info(f"Inserted {len(new_games)} new games.")
        return len(new_games)
    except Exception as e:
        logger.error(f"Bulk insert failed: {e}")
        return 0

def main():
    # ... (unchanged, kept for standalone usage) ...
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
    
