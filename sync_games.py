# sync_games.py
import os
import requests
import logging
import time
from supabase import create_client, Client
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GAMEPIX_SID = os.getenv("GAMEPIX_SID", "F5123")

def fetch_and_sync_all_pages():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.error("Missing Supabase credentials in environment variables.")
        return 0

    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    total_synced = 0
    
    # Loop 10 times to get 10 pages of 96 games = 960 games total!
    for page in range(1, 11):
        feed_url = f"https://feeds.gamepix.com/v2/json?sid={GAMEPIX_SID}&pagination=96&page={page}"
        logger.info(f"🚀 Fetching Page {page}/10 from: {feed_url}")
        
        try:
            resp = requests.get(feed_url, timeout=30)
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
            
            if not raw_items:
                logger.info(f"Page {page} returned no games. Stopping pagination sequence.")
                break
                
            logger.info(f"Found {len(raw_items)} games on page {page}. Ingesting...")
            games_batch = []
            
            for item in raw_items:
                raw_url = item.get("url") or item.get("link") or ""
                if not raw_url:
                    continue
                    
                # Inject tracking seamlessly
                parsed = urlparse(raw_url)
                query = parse_qs(parsed.query)
                query["sid"] = GAMEPIX_SID
                new_query = urlencode(query, doseq=True)
                playable_url = urlunparse(parsed._replace(query=new_query))

                games_batch.append({
                    "id": str(item.get("id") or item.get("guid") or hash(raw_url)),
                    "title": item.get("title") or item.get("name") or "Unnamed Game",
                    "thumbnail": item.get("thumbnailUrl") or item.get("thumbnail") or item.get("image") or "",
                    "category": item.get("category") or "Other",
                    "updated_at": datetime.utcnow().isoformat()
                })
            
            # Upsert batch directly into Supabase
            if games_batch:
                for game in games_batch:
                    supabase.table("games").upsert(game).execute()
                total_synced += len(games_batch)
                logger.info(f"✅ Successfully processed page {page}.")
            
            # Brief pause to keep the free-tier Render server happy and lightweight
            time.sleep(0.5)
            
        except Exception as e:
            logger.error(f"Error executing pagination layer on page {page}: {e}")
            continue

    return total_synced

def main():
    logger.info("Starting multi-page GamePix deep synchronization sync...")
    count = fetch_and_sync_all_pages()
    logger.info(f"🏁 Master Sync Complete! Total unique rows populated: {count}")

if __name__ == "__main__":
    main()
    
