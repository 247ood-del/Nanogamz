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


def fetch_gamepix_games():
    """
    Automatically fetches all pages by looping until an empty response.
    Stops when a page returns fewer than 96 items (or an empty list).
    """
    all_games = {}
    page = 1
    max_per_page = 96

    while True:
        url = f"https://feeds.gamepix.com/v2/json?sid={GAMEPIX_SID}&pagination={max_per_page}&page={page}"
        logger.info(f"🔄 Fetching page {page} from {url}")

        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code != 200:
                logger.warning(f"Page {page} returned status {resp.status_code}. Stopping.")
                break

            data = resp.json()

            # --- Parse response ---
            raw_items = []
            if isinstance(data, list):
                raw_items = data
            elif isinstance(data, dict):
                # If the API returns a "games" or "items" key, use that
                if "games" in data:
                    raw_items = data["games"]
                elif "items" in data:
                    raw_items = data["items"]
                else:
                    # fallback: try to find any list value
                    for val in data.values():
                        if isinstance(val, list):
                            raw_items = val
                            break

            if not raw_items:
                logger.info(f"Page {page} empty – reached the end.")
                break

            logger.info(f"📋 Found {len(raw_items)} games on page {page}.")

            for item in raw_items:
                raw_url = item.get("url") or item.get("link") or ""
                if not raw_url:
                    continue

                # Inject affiliate tracker
                parsed = urlparse(raw_url)
                query = parse_qs(parsed.query)
                query["sid"] = GAMEPIX_SID
                new_query = urlencode(query, doseq=True)
                playable_url = urlunparse(parsed._replace(query=new_query))

                game_id = str(item.get("id") or item.get("guid") or hash(raw_url))
                title = item.get("title") or item.get("name") or "Unnamed Game"
                thumbnail = item.get("thumbnailUrl") or item.get("thumbnail") or item.get("image") or ""
                category = item.get("category") or "Other"

                # Store by ID to deduplicate
                all_games[game_id] = {
                    "id": game_id,
                    "title": title,
                    "thumbnail": thumbnail,
                    "playable_url": playable_url,
                    "category": category,
                    "updated_at": datetime.utcnow().isoformat()
                }

            # If we got fewer than max_per_page, this is the last page
            if len(raw_items) < max_per_page:
                logger.info(f"Page {page} returned fewer than {max_per_page} items – assuming last page.")
                break

            # Move to next page with a small delay
            page += 1
            time.sleep(0.3)

        except Exception as e:
            logger.error(f"Error on page {page}: {e}", exc_info=True)
            break

    logger.info(f"✅ Total unique games fetched: {len(all_games)}")
    return list(all_games.values())


def insert_new_games(supabase: Client, games):
    """
    Checks your database for existing records and appends missing rows safely.
    """
    if not games:
        return 0

    try:
        response = supabase.table("games").select("id").execute()
        existing_ids = {row["id"] for row in response.data}
    except Exception as e:
        logger.error(f"Failed to query current row mapping from Supabase: {e}")
        return 0

    new_games = [g for g in games if g["id"] not in existing_ids]
    if not new_games:
        logger.info("Database match up-to-date. No new entries found.")
        return 0

    try:
        # Ingest missing entries safely
        supabase.table("games").insert(new_games).execute()
        logger.info(f"Successfully added {len(new_games)} new rows to the database.")
        return len(new_games)
    except Exception as e:
        logger.error(f"Failed bulk transaction execution into Supabase: {e}")
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
