import os
import requests
from supabase import create_client, Client
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GAMEPIX_SID = os.getenv("GAMEPIX_SID", "F5123")
# Use the proper GamePix feed URL (as shown in your screenshot)
GAMEPIX_FEED = f"https://feeds.gamepix.com/v2/json?sid={GAMEPIX_SID}&pagination=12&page=1"

def fetch_gamepix_games():
    try:
        resp = requests.get(GAMEPIX_FEED, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        games = []
        for item in data.get("games", []):
            raw_url = item.get("url", "")
            parsed = urlparse(raw_url)
            query = parse_qs(parsed.query)
            query["sid"] = GAMEPIX_SID
            new_query = urlencode(query, doseq=True)
            playable_url = urlunparse(parsed._replace(query=new_query))

            games.append({
                "id": str(item.get("id", "")),
                "title": item.get("title", ""),
                "thumbnail": item.get("thumbnailUrl", ""),   # correct key
                "playable_url": playable_url,
                "category": item.get("category", "Other"),
                "updated_at": datetime.utcnow().isoformat()
            })
        return games
    except requests.exceptions.RequestException as e:
        print(f"Request error fetching GamePix: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response status: {e.response.status_code}, body: {e.response.text[:200]}")
        return []
    except ValueError as e:
        print(f"JSON decode error: {e}")
        if 'resp' in locals():
            print(f"Response text (first 500): {resp.text[:500]}")
        return []

def upsert_games(supabase: Client, games):
    for game in games:
        supabase.table("games").upsert(game).execute()

def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    games = fetch_gamepix_games()
    if games:
        upsert_games(supabase, games)
        print(f"✅ Synced {len(games)} games")
    else:
        print("❌ No games fetched")

if __name__ == "__main__":
    main()
    
