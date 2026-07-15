import os
import requests
from supabase import create_client, Client
from datetime import datetime

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GAMEPIX_FEED = "https://games.gamepix.com/gameinfo/"

def fetch_gamepix_games():
    try:
        resp = requests.get(GAMEPIX_FEED, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        games = []
        # Adjust based on actual GamePix response structure
        for item in data.get("games", []):
            games.append({
                "id": str(item["id"]),
                "title": item["title"],
                "thumbnail": item.get("thumbnail", ""),
                "playable_url": item["url"],
                "category": item.get("category", "Other"),
                "updated_at": datetime.utcnow().isoformat()
            })
        return games
    except Exception as e:
        print(f"Error fetching GamePix: {e}")
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
  
