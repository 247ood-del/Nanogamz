// ads.js – Native ads configuration (static fallback) + live fetch
export const ADS = [
    {
        image: 'assets/ad1.png',
        link: 'https://example.com/ad1'
    },
    {
        image: 'assets/ad2.png',
        link: 'https://example.com/ad2'
    },
    {
        image: 'assets/ad3.png',
        link: 'https://example.com/ad3'
    }
];

/**
 * Fetches live CPAGrip offers from the backend.
 * Returns an array of ad objects in the same format as ADS,
 * or null if the fetch fails or no offers are available.
 */
export async function fetchLiveAds() {
    try {
        const response = await fetch('/api/cpa-offers');
        const result = await response.json();

        if (result.success && result.ads && result.ads.length > 0) {
            return result.ads;
        }
        return null;
    } catch (error) {
        console.warn('Failed to fetch live CPA offers:', error);
        return null;
    }
}
