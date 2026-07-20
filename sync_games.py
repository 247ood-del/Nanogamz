# sync_games.py
import os
import requests
import logging
from supabase import create_client, Client
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

# Setup explicit logging so errors show up clearly in Render logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GAMEPIX_SID = os.getenv("GAMEPIX_SID", "F5123")

# REMOVED pagination caps to pull the full master feed directly!
GAMEPIX_FEED = f"https://feeds.gamepix.com/v2/json?sid={GAMEPIX_SID}"

def fetch_gamepix_games():
    try:
        logger.info(f"Fetching master feed from: {GAMEPIX_FEED}")
        resp = requests.get(GAMEPIX_FEED, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        
        # --- SMART STRUCTURE DETECTION ---
        raw_items = []
        if isinstance(data, list):
            raw_items = data
        elif isinstance(data, dict):
            if "games" in data:
                raw_items = data["games"]
            elif "items" in data:
                raw_items = data["items"]
            else:
                # Fallback if wrapped under another master key
                for val in data.values():
                    if isinstance(val, list):
                        raw_items = val
                        break

        if not raw_items:
            logger.error(f"Could not find a valid list of games in the JSON response. Keys present: {list(data.keys()) if isinstance(data, dict) else 'None'}")
            return []

        logger.info(f"Successfully located {len(raw_items)} raw feed entries. Processing tracking parameters...")
        games = []
        for item in raw_items:
            # GamePix V2 might use 'url' or 'link'
            raw_url = item.get("url") or item.get("link") or ""
            if not raw_url:
                continue
                
            # Safely inject your tracking ID parameter
            parsed = urlparse(raw_url)
            query = parse_qs(parsed.query)
            query["sid"] = GAMEPIX_SID
            new_query = urlencode(query, doseq=True)
            playable_url = urlunparse(parsed._replace(query=new_query))

            # Normalize data keys (V2 often capitalizes or names fields differently)
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
        logger.error(f"Critical sync execution failure: {e}", exc_info=True)
        return []

def upsert_games(supabase: Client, games):
    logger.info(f"Upserting {len(games)} formatted rows into Supabase...")
    for game in games:
        try:
            supabase.table("games").upsert(game).execute()
        except Exception as table_err:
            logger.error(f"Row insertion error for game {game.get('title')}: {table_err}")

def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.error("Missing Supabase connection credentials in environment variables.")
        return
        
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    games = fetch_gamepix_games()
    if games:
        upsert_games(supabase, games)
        logger.info(f"✅ Sync process complete! Database holds updated tracking data.")
    else:
        logger.warning("❌ Process finished with 0 games ingested.")

if __name__ == "__main__":
    main()
    
