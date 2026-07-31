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

export async function fetchLiveAds() {
    try {
        const baseUrl = window.BACKEND_URL || 'https://nanogamz.onrender.com';
        const response = await fetch(`${baseUrl}/api/cpa-offers`);
        
        if (!response.ok) return null;

        const result = await response.json();

        if (result.success && Array.isArray(result.ads) && result.ads.length > 0) {
            return result.ads;
        }
        return null;
    } catch (error) {
        console.warn('Failed to fetch live CPA offers:', error);
        return null;
    }
}
