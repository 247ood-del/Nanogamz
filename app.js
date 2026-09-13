// app.js – Nanogamz main application

import { ADS, fetchLiveAds } from './ads.js';

// ------------------------ CONFIG ------------------------
const BACKEND_URL = window.BACKEND_URL || 'https://nanogamz.onrender.com';

const CATEGORIES = [
    '🔥 Discover',
    '🕹️ Arcade',
    '🧩 Puzzle',
    '👶 Kids',
    '🧭 Adventure',
    '🎮 Casual',
    '⚔️ Action',
    '🚀 Hyper-casual',
    '⚽ Sports',
    '🔫 Shooter',
    '🏃 Platformer',
    '🐾 Animal',
    '🍇 Match-3',
    '⚾ Ball',
    '🧠 Brain',
    '♟️ Board',
    '👾 Monster',
    '👥 Two-player',
    '💭 Memory',
    '🏁 Racing',
    '🖱️ Clicker',
    '🏃‍♂️ Runner',
    '🎯 Skill',
    '😄 Fun'
];

// ------------------------ TOAST SYSTEM ------------------------
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ------------------------ HELPERS ------------------------
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        if (sameDay) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) {
            return d.toLocaleDateString([], { weekday: 'short' });
        }
        return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    } catch {
        return '';
    }
}

// ------------------------ STATE ------------------------
const state = {
    currentCategory: '🔥 Discover',
    offset: 0,
    limit: 30,
    games: [],
    loading: false,
    hasMore: true,
    searchQuery: '',
    sessionSeed: Date.now(),
    lastPlayed: JSON.parse(localStorage.getItem('nanogamz_recent') || '[]'),
    swiperAd: null,
    user: null,
    theme: {
        bg: '#0a0a0a',
        text: '#ffffff',
        bar: '#1a1a1a',
        accent: '#6c5ce7'
    },
    savedGameIds: new Set(),
    savedOffset: 0,
    savedLimit: 20,
    savedHasMore: true,
    loadingSaved: false,
    // --- Support chat ---
    isAdmin: false,
    supportPolling: null,
    adminListPolling: null,
    adminChatPolling: null,
    activeSupportUser: null,
    activeSupportUserInfo: null,
    // Cached avatar data URL generated client-side (fallback when Telegram
    // doesn't provide photo_url — which is most of the time)
    myAvatarUrl: null
};

// ------------------------ TELEGRAM WEBAPP ------------------------
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Build a small data-URL avatar from the user's initial.
// Cached so we only build it once per session.
function buildInitialsAvatar(name) {
    const initials = (name?.[0] || 'U').toUpperCase();
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    // Pick a stable colour from the name
    const palette = ['#6c5ce7','#e17055','#00b894','#0984e3','#fd79a8','#fdcb6e','#a29bfe','#55efc4'];
    let hash = 0;
    for (let i = 0; i < (name || 'U').length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    ctx.fillStyle = palette[Math.abs(hash) % palette.length];
    ctx.beginPath();
    ctx.arc(48, 48, 48, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 48, 52);
    return canvas.toDataURL('image/png');
}

function getMyAvatarUrl() {
    if (state.myAvatarUrl) return state.myAvatarUrl;
    if (state.user?.photo_url) {
        state.myAvatarUrl = state.user.photo_url;
    } else {
        state.myAvatarUrl = buildInitialsAvatar(state.user?.first_name || 'User');
    }
    return state.myAvatarUrl;
}

if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    state.user = tg.initDataUnsafe.user;
    document.getElementById('userName').textContent = state.user.first_name || 'Player';
    document.getElementById('userId').textContent = `ID: ${state.user.id}`;

    document.getElementById('userAvatar').src = getMyAvatarUrl();

    fetchUserSavedGameIds();
    checkAdminStatus();
    startUserUnreadPolling();
}

// ------------------------ DOM REFS ------------------------
const grid = document.getElementById('gridContainer');
const catBar = document.getElementById('catBar');
const gameModal = document.getElementById('gameModal');
const gameIframe = document.getElementById('gameIframe');
const modalClose = document.getElementById('modalClose');
const menuToggle = document.getElementById('menuToggle');
const menuPanel = document.getElementById('menuPanel');
const menuOverlay = document.getElementById('menuOverlay');
const searchToggle = document.getElementById('searchToggle');
const refreshBtn = document.getElementById('refreshBtn');
const adWrapper = document.getElementById('adWrapper');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const adCarousel = document.querySelector('.ad-carousel');
const gridContainer = document.getElementById('gameGrid');

const saveBtn = document.getElementById('saveBtn');
const savedOverlay = document.getElementById('savedOverlay');
const savedGamesLink = document.getElementById('savedGamesLink');
const closeSavedOverlay = document.getElementById('closeSavedOverlay');
const savedGrid = document.getElementById('savedGrid');
const savedGridContainer = document.getElementById('savedGridContainer');
const refreshSavedBtn = document.getElementById('refreshSavedBtn');
const shareBtn = document.getElementById('shareBtn');

// Support chat DOM refs
const supportOverlay = document.getElementById('supportOverlay');
const supportChatView = document.getElementById('supportChatView');
const supportListView = document.getElementById('supportListView');
const adminChatView = document.getElementById('adminChatView');
const supportMessages = document.getElementById('supportMessages');
const supportInput = document.getElementById('supportInput');
const supportSendBtn = document.getElementById('supportSendBtn');
const closeSupportChat = document.getElementById('closeSupportChat');
const closeSupportList = document.getElementById('closeSupportList');
const supportConversations = document.getElementById('supportConversations');
const adminChatMessages = document.getElementById('adminChatMessages');
const adminChatInput = document.getElementById('adminChatInput');
const adminChatSendBtn = document.getElementById('adminChatSendBtn');
const adminChatName = document.getElementById('adminChatName');
const adminChatAvatar = document.getElementById('adminChatAvatar');
const backToSupportList = document.getElementById('backToSupportList');

// ------------------------ SEARCH PANEL ------------------------
const searchPanel = document.getElementById('searchPanel');
const searchInput = document.getElementById('searchInput');
const searchSubmitBtn = document.getElementById('searchSubmitBtn');
let searchOpen = false;

function openSearch() {
    if (searchOpen) return;
    searchPanel.classList.add('open');
    document.body.classList.add('search-open');
    searchOpen = true;
    searchToggle.textContent = '✕';
    setTimeout(() => searchInput.focus(), 100);
}

function closeSearch() {
    if (!searchOpen) return;
    searchPanel.classList.remove('open');
    document.body.classList.remove('search-open');
    searchOpen = false;
    searchToggle.textContent = '🔍';
    searchInput.value = '';
}

function resetSearch() {
    if (state.searchQuery === '') {
        closeSearch();
        return;
    }
    state.searchQuery = '';
    state.offset = 0;
    state.hasMore = true;
    state.games = [];
    generateNewSeed();
    loadGames(true);
    closeSearch();
}

function toggleSearch() {
    if (searchOpen) {
        resetSearch();
    } else {
        openSearch();
    }
}

function performSearch() {
    const query = searchInput.value.trim();
    closeSearch();
    state.searchQuery = query;
    state.offset = 0;
    state.hasMore = true;
    state.games = [];
    generateNewSeed();
    loadGames(true);
}

searchToggle.addEventListener('click', toggleSearch);
searchSubmitBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        performSearch();
    }
});

document.addEventListener('click', (e) => {
    if (searchOpen && !searchPanel.contains(e.target) && e.target !== searchToggle) {
        resetSearch();
    }
});

// ------------------------ THEME ENGINE ------------------------
function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty('--bg', theme.bg || '#0a0a0a');
    root.style.setProperty('--text', theme.text || '#ffffff');
    root.style.setProperty('--bar', theme.bar || '#1a1a1a');
    root.style.setProperty('--accent', theme.accent || '#6c5ce7');
    localStorage.setItem('nanogamz_theme', JSON.stringify(theme));
}

function loadTheme() {
    try {
        const saved = JSON.parse(localStorage.getItem('nanogamz_theme'));
        if (saved) {
            state.theme = saved;
            applyTheme(saved);
        }
    } catch {}
}
loadTheme();

const COLORS = [
    '#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00',
    '#ff4500','#ff8c00','#ffd700','#adff2f','#32cd32','#3cb371',
    '#20b2aa','#4682b4','#4169e1','#6a5acd','#8a2be2','#c71585',
    '#db7093','#ff69b4','#ffb6c1','#ffa07a','#f08080','#e9967a',
    '#f5deb3','#f0e68c','#bdb76b','#d3d3d3','#a9a9a9','#808080',
    '#696969','#2f4f4f','#1e1e1e','#4a4a4a','#9c4dff','#ff6b6b',
    '#4ecdc4','#ffe66d','#ff9f1c','#2ec4b6','#e71d36','#011627'
];

function populatePalette(mode) {
    const container = document.getElementById('colorPalette');
    container.innerHTML = COLORS.map(c => `
        <div class="color-swatch" style="background:${c}" data-color="${c}"></div>
    `).join('');
    container.querySelectorAll('.color-swatch').forEach(el => {
        el.addEventListener('click', () => {
            const color = el.dataset.color;
            if (mode === 'theme') {
                state.theme.bg = color;
                state.theme.bar = darken(color, 30);
                applyTheme(state.theme);
            } else if (mode === 'accent') {
                state.theme.accent = color;
                applyTheme(state.theme);
            } else if (mode === 'text') {
                state.theme.text = color;
                applyTheme(state.theme);
            }
            localStorage.setItem('nanogamz_theme', JSON.stringify(state.theme));
        });
    });
}

function darken(hex, percent) {
    hex = hex.replace('#','');
    let r = parseInt(hex.substring(0,2),16);
    let g = parseInt(hex.substring(2,4),16);
    let b = parseInt(hex.substring(4,6),16);
    r = Math.floor(r * (1 - percent/100));
    g = Math.floor(g * (1 - percent/100));
    b = Math.floor(b * (1 - percent/100));
    return `#${((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}`;
}

document.querySelectorAll('#themeSegmented .seg-option').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#themeSegmented .seg-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        populatePalette(btn.dataset.mode);
    });
});
populatePalette('theme');

// ------------------------ AD CAROUSEL (DYNAMIC) ------------------------
async function initAdCarousel() {
    let adsToUse = ADS;

    try {
        const liveAds = await fetchLiveAds();
        if (liveAds && liveAds.length > 0) {
            adsToUse = liveAds;
        }
    } catch (e) {
        // silent fallback – keep using ADS
    }

    adWrapper.innerHTML = adsToUse.map(ad => `
        <div class="swiper-slide">
            <a href="${ad.link}" target="_blank" rel="noopener">
                <img src="${ad.image}" alt="${ad.title || 'ad'}" />
            </a>
        </div>
    `).join('');

    if (state.swiperAd) {
        state.swiperAd.destroy(true, true);
    }

    state.swiperAd = new Swiper('#adCarousel', {
        loop: true,
        autoplay: { delay: 4000, disableOnInteraction: false },
        speed: 800,
        slidesPerView: 1,
        spaceBetween: 0,
        effect: 'slide',
    });
}

initAdCarousel();

// ------------------------ CATEGORY BAR ------------------------
function renderCategories() {
    catBar.innerHTML = CATEGORIES.map(cat => `
        <button class="cat-btn ${cat === state.currentCategory ? 'active' : ''}" data-cat="${cat}">${cat}</button>
    `).join('');
    catBar.querySelectorAll('.cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.currentCategory = btn.dataset.cat;
            state.offset = 0;
            state.hasMore = true;
            state.games = [];
            generateNewSeed();
            renderCategories();
            loadGames(true);
        });
    });
}
renderCategories();

// ------------------------ SEED GENERATION ------------------------
function generateNewSeed() {
    state.sessionSeed = Math.floor(Math.random() * 1000000000);
}

// ------------------------ FETCH GAMES ------------------------
async function fetchGames(category, offset, limit, search = '', seed = null) {
    let url = `${BACKEND_URL}/games?limit=${limit}&offset=${offset}`;
    if (category && category !== '🔥 Discover') {
        url += `&category=${encodeURIComponent(category)}`;
    }
    if (search) {
        url += `&search=${encodeURIComponent(search)}`;
    }
    if (seed) {
        url += `&seed=${seed}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Network error');
    return resp.json();
}

// ------------------------ RENDER GAMES ------------------------
function renderGames(games, append = false) {
    const container = grid;
    if (!append) container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <img src="${game.thumbnail || 'https://via.placeholder.com/300x200/333/666?text=No+Image'}" alt="${game.title}" loading="lazy" />
            <div class="info">
                <div class="title">${game.title}</div>
                <div class="category">${game.category || 'Other'}</div>
            </div>
        `;
        card.addEventListener('click', () => openGame(game));
        fragment.appendChild(card);
    });
    container.appendChild(fragment);
}

// ------------------------ LOAD GAMES ------------------------
async function loadGames(reset = false) {
    if (state.loading || (!state.hasMore && !reset)) return;
    state.loading = true;

    if (reset) {
        grid.innerHTML = '';
        for (let i = 0; i < 6; i++) {
            const skel = document.createElement('div');
            skel.className = 'skeleton-card';
            skel.innerHTML = `
                <div class="img"></div>
                <div class="line"></div>
                <div class="line short"></div>
            `;
            grid.appendChild(skel);
        }
        resetAdOffset();
    }

    try {
        const data = await fetchGames(
            state.currentCategory,
            state.offset,
            state.limit,
            state.searchQuery,
            state.sessionSeed
        );
        if (data.length < state.limit) state.hasMore = false;
        state.games = reset ? data : [...state.games, ...data];
        renderGames(data, !reset);
        state.offset += data.length;
    } catch (e) {
        console.error(e);
        showToast('Failed to load games. Please try again.', 'error');
    } finally {
        state.loading = false;
    }
}

// ------------------------ INFINITE SCROLL ------------------------
gridContainer.addEventListener('scroll', () => {
    if (gridContainer.scrollTop + gridContainer.clientHeight >= gridContainer.scrollHeight - 100) {
        if (!state.loading && state.hasMore) loadGames(false);
    }
});

// ==================== PARALLAX AD COLLAPSE ====================
let lastScrollTop = 0;
let adOffset = 0;
const AD_HEIGHT = 160;
const TOP_BAR_HEIGHT = 56;
const CAT_BAR_HEIGHT = 48;
const SCROLL_RATIO = 0.7;

function resetAdOffset() {
    adOffset = 0;
    lastScrollTop = 0;
    updateAdPosition(0);
}

function updateAdPosition(offset) {
    adCarousel.style.transform = `translateY(-${offset}px)`;
    catBar.style.top = `${TOP_BAR_HEIGHT + AD_HEIGHT - offset}px`;
    gridContainer.style.top = `${TOP_BAR_HEIGHT + AD_HEIGHT + CAT_BAR_HEIGHT - offset}px`;
}

let ticking = false;
gridContainer.addEventListener('scroll', () => {
    if (!ticking) {
        window.requestAnimationFrame(() => {
            const scrollTop = gridContainer.scrollTop;
            const delta = scrollTop - lastScrollTop;
            lastScrollTop = scrollTop;
            adOffset = Math.min(Math.max(adOffset + (delta * SCROLL_RATIO), 0), AD_HEIGHT);
            updateAdPosition(adOffset);
            ticking = false;
        });
        ticking = true;
    }
});

resetAdOffset();

// ------------------------ REFRESH ------------------------
refreshBtn.addEventListener('click', () => {
    if (state.searchQuery) {
        resetSearch();
    } else {
        state.offset = 0;
        state.hasMore = true;
        state.games = [];
        generateNewSeed();
        loadGames(true);
    }
});

// ------------------------ GAME MODAL ------------------------
let activeModalGame = null;

async function recordRecentGame(gameId) {
    if (!state.user || !state.user.id) return;
    try {
        await fetch(`${BACKEND_URL}/add-recent-game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: state.user.id,
                game_id: String(gameId)
            })
        });
        renderRecentGames();
    } catch (err) {
        console.error("Failed to record recent game:", err);
        showToast('Failed to save recent game.', 'error');
    }
}

async function renderRecentGames() {
    const recentGamesContainer = document.getElementById('recentGames');
    if (!recentGamesContainer) return;

    if (!state.user || !state.user.id) {
        recentGamesContainer.innerHTML = '<span style="font-size:12px; opacity:0.5;">Log in to see recent games</span>';
        return;
    }

    try {
        const resp = await fetch(`${BACKEND_URL}/recent-games?telegram_id=${state.user.id}`);
        const games = await resp.json();

        recentGamesContainer.innerHTML = '';

        if (!games || games.length === 0) {
            recentGamesContainer.innerHTML = '<span style="font-size:12px; opacity:0.5;">No recently played games</span>';
            return;
        }

        games.forEach(game => {
            const item = document.createElement('div');
            item.className = 'recent-game';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <img src="${game.thumbnail || 'https://via.placeholder.com/70/333/666?text=?'}" alt="${game.title}" />
                <div style="font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${game.title}</div>
            `;
            item.addEventListener('click', () => {
                toggleMenu();
                openGame(game);
            });
            recentGamesContainer.appendChild(item);
        });
    } catch (err) {
        console.error("Error rendering recent games:", err);
        showToast('Failed to load recent games.', 'error');
    }
}

// ==================== FETCH USER'S SAVED GAME IDs ====================
async function fetchUserSavedGameIds() {
    if (!state.user || !state.user.id) return;
    try {
        const resp = await fetch(`${BACKEND_URL}/saved-games?telegram_id=${state.user.id}`);
        const games = await resp.json();
        if (Array.isArray(games)) {
            state.savedGameIds = new Set(games.map(g => String(g.id)));
        }
    } catch (err) {
        console.error("Failed to pre-fetch saved games:", err);
        showToast('Failed to load saved games.', 'error');
    }
}

// ==================== PILL POSITION RESET ====================
function resetPillPosition() {
    const pill = document.querySelector('.game-control-pill');
    if (!pill) return;
    pill.style.left = '';
    pill.style.top = '';
    pill.style.right = '';
}

// ==================== OPEN / CLOSE GAME MODAL ====================
async function openGame(game) {
    if (!game || !game.playable_url) {
        alert("Game URL not found. Please try again.");
        return;
    }

    activeModalGame = game;
    syncSavedState(game.id);
    gameIframe.src = game.playable_url;
    gameModal.classList.add('active');

    recordRecentGame(game.id);

    if (state.user && state.user.id) {
        await fetchUserSavedGameIds();
        syncSavedState(game.id);
    }
}

function closeGameModal() {
    gameModal.classList.remove('active');
    gameIframe.src = '';
    resetPillPosition();
}

modalClose.addEventListener('click', closeGameModal);

gameModal.addEventListener('click', (e) => {
    if (e.target === gameModal) {
        closeGameModal();
    }
});

// ------------------------ SIDE MENU ------------------------
function toggleMenu() {
    const isOpen = menuPanel.classList.contains('open');
    menuPanel.classList.toggle('open');
    menuOverlay.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
    if (!isOpen) {
        renderRecentGames();
    }
}
menuToggle.addEventListener('click', toggleMenu);
menuOverlay.addEventListener('click', toggleMenu);

closeMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuPanel.classList.contains('open')) {
        toggleMenu();
    }
});

// ==================== SHARE BOT ====================
document.getElementById('shareLink').addEventListener('click', async (e) => {
    e.preventDefault();
    const shareText = '🎮 Play instant games on Nanogamz – your pocket gaming hub!';
    const botLink = 'https://t.me/Nanogamz_bot';
    try {
        await navigator.clipboard.writeText(`${shareText} ${botLink}`);
        alert('✅ Link & Text copied to clipboard!');
    } catch {
        alert('Unable to copy. Please copy the link manually: ' + botLink);
    }
    toggleMenu();
});

// ==================== COPY USER ID ====================
function copyUserId() {
    const userIdEl = document.getElementById('userId');
    const userId = userIdEl.textContent.replace('ID: ', '').trim();
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            const original = btn.textContent;
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }).catch(() => {
            alert('Failed to copy ID.');
        });
    }
}

document.getElementById('copyIdBtn').addEventListener('click', copyUserId);

// ==================== COPYRIGHT & PRIVACY MODALS ====================
function openCopyright() {
    document.getElementById('copyrightModal').classList.add('active');
}
function closeCopyright() {
    document.getElementById('copyrightModal').classList.remove('active');
}

function openPrivacy() {
    document.getElementById('privacyModal').classList.add('active');
}
function closePrivacy() {
    document.getElementById('privacyModal').classList.remove('active');
}

document.getElementById('copyrightLink').addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
    openCopyright();
});
document.getElementById('privacyLink').addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
    openPrivacy();
});

document.getElementById('copyrightClose').addEventListener('click', closeCopyright);
document.getElementById('privacyClose').addEventListener('click', closePrivacy);

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

// ==================== SUPPORT LINK (opens in-app overlay) ====================
document.getElementById('supportLink').addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
    openSupport();
});

// ==================== PILL CONTROLS ====================
async function syncSavedState(gameId) {
    const isSaved = state.savedGameIds.has(String(gameId));
    saveBtn.textContent = isSaved ? '📑' : '🔖';
    saveBtn.title = isSaved ? 'Delete from Saved' : 'Save Game';
}

saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!activeModalGame || !state.user) {
        alert('Please open the app inside Telegram to save games.');
        return;
    }
    const gId = String(activeModalGame.id);
    try {
        const resp = await fetch(`${BACKEND_URL}/toggle-save-game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: state.user.id, game_id: gId })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            state.savedGameIds = new Set(data.saved_games.map(String));
            syncSavedState(gId);
            const message = data.is_saved ? 'Game saved!' : 'Game removed from saved.';
            showToast(message, 'success');

            if (savedOverlay.classList.contains('active')) {
                state.savedOffset = 0;
                state.savedHasMore = true;
                loadSavedGames(true);
            }
        } else {
            showToast('Failed to update saved games.', 'error');
        }
    } catch (err) {
        console.error('Failed to toggle save state', err);
        showToast('Network error. Please try again.', 'error');
    }
});

// ==================== SHARE GAME ====================
const BOT_USERNAME = 'Nanogamz_bot';

shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeModalGame) {
        showToast('No game loaded to share.', 'error');
        return;
    }
    shareGame(activeModalGame.id);
});

async function shareGame(gameId) {
    const deepLink = `https://t.me/${BOT_USERNAME}?startapp=${gameId}`;
    try {
        await navigator.clipboard.writeText(deepLink);
        showToast('✅ Game link copied to clipboard!', 'success', 2000);
    } catch (err) {
        console.error('Copy failed', err);
        try {
            const textarea = document.createElement('textarea');
            textarea.value = deepLink;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('✅ Game link copied to clipboard!', 'success', 2000);
        } catch (fallbackErr) {
            showToast('Failed to copy link. Please copy manually.', 'error');
        }
    }
}

// ==================== DEEP LINK HANDLER ====================
async function handleDeepLink() {
    if (!window.Telegram || !Telegram.WebApp) return;
    const startParam = Telegram.WebApp.initDataUnsafe?.start_param;
    if (!startParam) return;

    try {
        const game = await fetchGameById(startParam);
        if (game) {
            setTimeout(() => {
                openGame(game);
            }, 500);
        } else {
            showToast('Game not found.', 'error');
        }
    } catch (err) {
        console.error('Deep link error:', err);
        showToast('Failed to load shared game.', 'error');
    }
}

async function fetchGameById(gameId) {
    try {
        const resp = await fetch(`${BACKEND_URL}/game/${gameId}`);
        if (!resp.ok) {
            if (resp.status === 404) return null;
            throw new Error('Network error');
        }
        return await resp.json();
    } catch (err) {
        console.error('fetchGameById error:', err);
        return null;
    }
}

// ==================== DRAGGABLE CONTROL PILL LOGIC ====================
const pill = document.querySelector('.game-control-pill');

if (pill) {
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, initialLeft, initialTop;

    const startDrag = (clientX, clientY) => {
        isDragging = true;
        hasDragged = false;
        startX = clientX;
        startY = clientY;

        const rect = pill.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        pill.style.right = 'auto';
        pill.style.left = `${initialLeft}px`;
        pill.style.top = `${initialTop}px`;
    };

    const moveDrag = (clientX, clientY) => {
        if (!isDragging) return;
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            hasDragged = true;
        }

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        const maxLeft = window.innerWidth - pill.offsetWidth - 10;
        const maxTop = window.innerHeight - pill.offsetHeight - 10;

        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));

        pill.style.left = `${newLeft}px`;
        pill.style.top = `${newTop}px`;
    };

    const endDrag = () => {
        isDragging = false;
    };

    pill.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startDrag(touch.clientX, touch.clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isDragging) {
            const touch = e.touches[0];
            moveDrag(touch.clientX, touch.clientY);
        }
    }, { passive: true });

    window.addEventListener('touchend', endDrag);

    pill.addEventListener('mousedown', (e) => {
        startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        moveDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', endDrag);

    pill.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (hasDragged) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    });
}

// ==================== SAVED GAMES OVERLAY ====================
async function loadSavedGames(reset = false) {
    if (state.loadingSaved || (!state.savedHasMore && !reset)) return;
    state.loadingSaved = true;

    if (reset) {
        savedGrid.innerHTML = '';
        state.savedOffset = 0;
        state.savedHasMore = true;
        for (let i = 0; i < 4; i++) {
            const skel = document.createElement('div');
            skel.className = 'skeleton-card';
            skel.innerHTML = `<div class="img"></div><div class="line"></div>`;
            savedGrid.appendChild(skel);
        }
    }

    try {
        if (!state.user) {
            savedGrid.innerHTML = '<div class="saved-empty-state">Unable to load user context.</div>';
            return;
        }

        const resp = await fetch(`${BACKEND_URL}/saved-games?telegram_id=${state.user.id}&limit=${state.savedLimit}&offset=${state.savedOffset}`);
        const games = await resp.json();

        if (reset) savedGrid.innerHTML = '';

        if (!games || games.length === 0) {
            if (reset) {
                savedGrid.innerHTML = '<div class="saved-empty-state">No games saved yet</div>';
            }
            state.savedHasMore = false;
            return;
        }

        if (games.length < state.savedLimit) state.savedHasMore = false;

        games.forEach(game => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.innerHTML = `
                <button class="card-menu-btn">⋮</button>
                <div class="card-dropdown">
                    <div class="card-dropdown-item delete-item">🗑 Delete</div>
                </div>
                <img src="${game.thumbnail || 'https://via.placeholder.com/300x200/333/666?text=No+Image'}" alt="${game.title}" loading="lazy" />
                <div class="info">
                    <div class="title">${game.title}</div>
                    <div class="category">${game.category || 'Other'}</div>
                </div>
            `;

            const menuBtn = card.querySelector('.card-menu-btn');
            const dropdown = card.querySelector('.card-dropdown');
            const deleteItem = card.querySelector('.delete-item');

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('show');
            });

            deleteItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
                try {
                    await fetch(`${BACKEND_URL}/toggle-save-game`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telegram_id: state.user.id, game_id: String(game.id) })
                    });
                    state.savedGameIds.delete(String(game.id));
                    card.remove();
                    if (savedGrid.children.length === 0) {
                        savedGrid.innerHTML = '<div class="saved-empty-state">No games saved yet</div>';
                    }
                    showToast('Game removed from saved.', 'success');
                } catch (err) {
                    showToast('Failed to remove game.', 'error');
                }
            });

            card.addEventListener('click', () => {
                openGame(game);
            });

            savedGrid.appendChild(card);
        });

        state.savedOffset += games.length;
    } catch (e) {
        console.error(e);
        if (reset) savedGrid.innerHTML = '<div class="saved-empty-state">Failed to load saved games.</div>';
        showToast('Failed to load saved games.', 'error');
    } finally {
        state.loadingSaved = false;
    }
}

document.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown.show').forEach(d => d.classList.remove('show'));
});

savedGamesLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
    savedOverlay.classList.add('active');
    loadSavedGames(true);
});

closeSavedOverlay.addEventListener('click', () => {
    savedOverlay.classList.remove('active');
});

if (refreshSavedBtn) {
    refreshSavedBtn.addEventListener('click', () => {
        state.savedOffset = 0;
        state.savedHasMore = true;
        loadSavedGames(true);
        showToast('Refreshing saved games...', 'info', 1000);
    });
}

savedGridContainer.addEventListener('scroll', () => {
    if (savedGridContainer.scrollTop + savedGridContainer.clientHeight >= savedGridContainer.scrollHeight - 100) {
        if (!state.loadingSaved && state.savedHasMore) {
            loadSavedGames(false);
        }
    }
});

// =============================================================================
//  SUPPORT CHAT  (USER VIEW + ADMIN VIEW)
// =============================================================================

const lastRendered = {
    conversations: ''
};

// Cursor map so we only download NEW messages on each poll (avoids re-fetching
// large image payloads every 5 seconds). The list view still uses the cached
// payload check to prevent blinking.
const chatCursor = {
    user: 0,
    admin: {}  // telegram_id -> last seen message id
};

function isScrolledToBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// -------------------- MESSAGE RENDERING HELPERS --------------------

// Turn plain text into safe HTML where URLs and long numbers become
// interactive, underlined elements. Newlines become <br>.
function linkifyMessage(text) {
    if (!text) return '';

    const tokens = [];
    // Match either a URL or a long enough number sequence (TG id, phone, etc.)
    const regex = /(https?:\/\/[^\s<>"']+)|(\+?\d[\d\s\-()]{4,}\d)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        if (match[1]) {
            // Trim trailing punctuation so "(https://x.com)." doesn't include ")." 
            let url = match[1];
            let trailing = '';
            const t = url.match(/[.,;:!?)\]]+$/);
            if (t) {
                trailing = t[0];
                url = url.slice(0, -trailing.length);
            }
            tokens.push({ type: 'link', value: url });
            if (trailing) tokens.push({ type: 'text', value: trailing });
        } else if (match[2]) {
            tokens.push({ type: 'number', value: match[2].trim() });
        }
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        tokens.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return tokens.map(t => {
        if (t.type === 'link') {
            const safe = escapeHtml(t.value);
            return `<a class="msg-link" data-url="${safe}" href="#" rel="noopener">${safe}</a>`;
        }
        if (t.type === 'number') {
            const safe = escapeHtml(t.value);
            return `<span class="msg-num" data-num="${safe}">${safe}</span>`;
        }
        return escapeHtml(t.value).replace(/\n/g, '<br>');
    }).join('');
}

// Robust clipboard copy with fallback for older webviews.
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch {
            return false;
        }
    }
}

// Append a single bubble (text or image) with its copy button.
// `role` is 'user' or 'admin' — it determines which sender means "mine".
function appendSupportBubble(container, msg, role) {
    const isMine = role === 'user' ? msg.sender === 'user' : msg.sender === 'admin';

    const row = document.createElement('div');
    row.className = `support-msg-row ${isMine ? 'mine' : 'theirs'}`;
    if (msg.id !== undefined) row.dataset.msgId = String(msg.id);
    if (msg._optimistic) row.classList.add('optimistic');

    const bubble = document.createElement('div');
    bubble.className = `support-bubble ${isMine ? 'mine' : 'theirs'}`;

    const rawMessage = msg.message || '';
    const isImage = rawMessage.startsWith('__IMG__');

    if (isImage) {
        bubble.classList.add('image-only');
        const dataUrl = rawMessage.substring(7);
        const img = document.createElement('img');
        img.className = 'support-image';
        img.src = dataUrl;
        img.alt = 'image';
        img.loading = 'lazy';
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openImagePreview(dataUrl);
        });
        bubble.appendChild(img);
    } else {
        const textEl = document.createElement('div');
        textEl.className = 'support-text';
        textEl.innerHTML = linkifyMessage(rawMessage);
        bubble.appendChild(textEl);
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'support-time';
    timeEl.textContent = msg._optimistic ? 'sending…' : formatTime(msg.created_at);
    bubble.appendChild(timeEl);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.type = 'button';
    copyBtn.textContent = '📋';
    if (isImage) {
        copyBtn.style.visibility = 'hidden';
    }
    copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isImage) return;
        const ok = await copyToClipboard(rawMessage);
        showToast(ok ? '📋 Message copied' : 'Failed to copy', ok ? 'success' : 'error', 1500);
    });

    row.appendChild(bubble);
    row.appendChild(copyBtn);
    container.appendChild(row);

    // Interactive links & numbers (event handlers are attached per node
    // so no event delegation is needed on the container).
    if (!isImage) {
        bubble.querySelectorAll('.msg-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showLinkOptions(el.dataset.url);
            });
        });
        bubble.querySelectorAll('.msg-num').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ok = await copyToClipboard(el.dataset.num);
                showToast(ok ? '📋 Copied' : 'Failed to copy', ok ? 'success' : 'error', 1500);
            });
        });
    }
}

// -------------------- LINK OPTIONS MODAL --------------------
let activeLinkUrl = '';

function showLinkOptions(url) {
    activeLinkUrl = url;
    document.getElementById('linkOptionsUrl').textContent = url;
    document.getElementById('linkOptionsModal').classList.add('active');
}

document.getElementById('linkOptionCopy').addEventListener('click', async () => {
    const ok = await copyToClipboard(activeLinkUrl);
    document.getElementById('linkOptionsModal').classList.remove('active');
    showToast(ok ? '📋 Link copied' : 'Failed to copy', ok ? 'success' : 'error', 1500);
});

document.getElementById('linkOptionOpen').addEventListener('click', () => {
    const url = activeLinkUrl;
    document.getElementById('linkOptionsModal').classList.remove('active');
    try {
        if (window.Telegram?.WebApp?.openLink) {
            Telegram.WebApp.openLink(url);
        } else {
            window.open(url, '_blank', 'noopener');
        }
    } catch {
        window.open(url, '_blank', 'noopener');
    }
});

document.getElementById('linkOptionCancel').addEventListener('click', () => {
    document.getElementById('linkOptionsModal').classList.remove('active');
});

document.getElementById('linkOptionsModal').addEventListener('click', (e) => {
    if (e.target.id === 'linkOptionsModal') {
        e.target.classList.remove('active');
    }
});

// -------------------- IMAGE PREVIEW MODAL --------------------
function openImagePreview(src) {
    document.getElementById('imagePreviewImg').src = src;
    document.getElementById('imagePreviewModal').classList.add('active');
}

document.getElementById('imagePreviewClose').addEventListener('click', () => {
    document.getElementById('imagePreviewModal').classList.remove('active');
});

document.getElementById('imagePreviewModal').addEventListener('click', (e) => {
    if (e.target.id === 'imagePreviewModal') {
        e.target.classList.remove('active');
    }
});

// -------------------- IMAGE COMPRESSION + UPLOAD --------------------
function fileToDataUrl(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

// Downscale + JPEG-compress so that even big photos land around a few
// hundred KB of base64 in the DB. This keeps polling light.
function compressImage(file, maxDim = 800, quality = 0.72) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            try {
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

function setupImageUpload(clipBtnId, inputId, senderType) {
    const btn = document.getElementById(clipBtnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        input.click();
    });

    input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        input.value = ''; // allow re-selecting the same file
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showToast('Only image files are allowed.', 'error');
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            showToast('Image must be under 3MB.', 'error');
            return;
        }

        const dataUrl = await compressImage(file);
        if (!dataUrl) {
            showToast('Failed to process image.', 'error');
            return;
        }

        await sendImageMessage(dataUrl, senderType);
    });
}

async function sendImageMessage(dataUrl, sender) {
    if (!state.user) return;

    const message = `__IMG__${dataUrl}`;

    if (sender === 'user') {
        if (!state.user.id) {
            showToast('Please open in Telegram to send images.', 'error');
            return;
        }
        const optimisticId = 'opt-' + Date.now();
        appendSupportBubble(supportMessages, {
            id: optimisticId,
            message,
            sender: 'user',
            created_at: new Date().toISOString(),
            _optimistic: true
        }, 'user');
        supportMessages.scrollTop = supportMessages.scrollHeight;

        try {
            await fetch(`${BACKEND_URL}/api/support/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: state.user.id,
                    message,
                    sender: 'user',
                    first_name: state.user.first_name || '',
                    username: state.user.username || '',
                    photo_url: getMyAvatarUrl()
                })
            });
            const opt = supportMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            await loadSupportMessages();
            showToast('📷 Image sent', 'success', 1500);
        } catch (err) {
            const opt = supportMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            showToast('Failed to send image.', 'error');
        }
    } else {
        if (!state.activeSupportUser) return;
        const optimisticId = 'opt-' + Date.now();
        appendSupportBubble(adminChatMessages, {
            id: optimisticId,
            message,
            sender: 'admin',
            created_at: new Date().toISOString(),
            _optimistic: true
        }, 'admin');
        adminChatMessages.scrollTop = adminChatMessages.scrollHeight;

        try {
            await fetch(`${BACKEND_URL}/api/support/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: state.activeSupportUser,
                    message,
                    sender: 'admin',
                    admin_id: state.user.id
                })
            });
            const opt = adminChatMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            await loadAdminChatMessages(state.activeSupportUser);
            showToast('📷 Image sent', 'success', 1500);
        } catch (err) {
            const opt = adminChatMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            showToast('Failed to send image.', 'error');
        }
    }
}

setupImageUpload('supportClipBtn', 'supportImageInput', 'user');
setupImageUpload('adminClipBtn', 'adminImageInput', 'admin');

// -------------------- USER-SIDE UNREAD BADGE POLLING --------------------
let userUnreadPolling = null;

function updateSupportBadge(count) {
    const badge = document.getElementById('supportBadge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.add('show');
    } else {
        badge.classList.remove('show');
    }
}

async function pollUserUnread() {
    if (!state.user || !state.user.id || state.isAdmin) return;
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/unread-count?telegram_id=${state.user.id}`);
        if (resp.ok) {
            const data = await resp.json();
            updateSupportBadge(data.count || 0);
            return;
        }
    } catch {
        // fall through to the fallback
    }
    // Fallback for deployments where the unread-count endpoint isn't available.
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/messages?telegram_id=${state.user.id}`);
        const data = await resp.json();
        const unread = (data.messages || []).filter(m => m.sender === 'admin' && !m.read_by_user).length;
        updateSupportBadge(unread);
    } catch {}
}

function startUserUnreadPolling() {
    if (userUnreadPolling) clearInterval(userUnreadPolling);
    // small delay so we don't race checkAdminStatus
    setTimeout(pollUserUnread, 1500);
    userUnreadPolling = setInterval(pollUserUnread, 20000);
}

// -------------------- ADMIN CHECK --------------------
async function checkAdminStatus() {
    if (!state.user || !state.user.id) return;
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/is-admin?telegram_id=${state.user.id}`);
        const data = await resp.json();
        state.isAdmin = !!data.is_admin;
    } catch (e) {
        state.isAdmin = false;
    }
}

// -------------------- OPEN / CLOSE SUPPORT OVERLAY --------------------
function openSupport() {
    if (!state.user || !state.user.id) {
        showToast('Please open the app inside Telegram to use support.', 'error');
        return;
    }
    supportOverlay.classList.add('active');

    if (state.isAdmin) {
        supportListView.style.display = 'flex';
        supportChatView.style.display = 'none';
        adminChatView.style.display = 'none';
        loadSupportConversations();
        startAdminListPolling();
    } else {
        supportListView.style.display = 'none';
        adminChatView.style.display = 'none';
        supportChatView.style.display = 'flex';
        // Clear the badge immediately — we're about to mark them read
        updateSupportBadge(0);
        loadSupportMessages();
        startSupportPolling();
    }
}

function closeSupport() {
    supportOverlay.classList.remove('active');
    stopAllSupportPolling();
    state.activeSupportUser = null;
    state.activeSupportUserInfo = null;
    lastRendered.conversations = '';
}

function stopAllSupportPolling() {
    if (state.supportPolling) { clearInterval(state.supportPolling); state.supportPolling = null; }
    if (state.adminListPolling) { clearInterval(state.adminListPolling); state.adminListPolling = null; }
    if (state.adminChatPolling) { clearInterval(state.adminChatPolling); state.adminChatPolling = null; }
}

function startSupportPolling() {
    if (state.supportPolling) clearInterval(state.supportPolling);
    state.supportPolling = setInterval(() => {
        if (supportOverlay.classList.contains('active') && supportChatView.style.display !== 'none') {
            loadSupportMessages(true);
        }
    }, 5000);
}

function startAdminListPolling() {
    if (state.adminListPolling) clearInterval(state.adminListPolling);
    state.adminListPolling = setInterval(() => {
        if (supportOverlay.classList.contains('active') && supportListView.style.display !== 'none') {
            loadSupportConversations();
        }
    }, 8000);
}

function startAdminChatPolling() {
    if (state.adminChatPolling) clearInterval(state.adminChatPolling);
    state.adminChatPolling = setInterval(() => {
        if (supportOverlay.classList.contains('active') && adminChatView.style.display !== 'none' && state.activeSupportUser) {
            loadAdminChatMessages(state.activeSupportUser, true);
        }
    }, 5000);
}

// -------------------- USER SIDE --------------------
async function loadSupportMessages(silent = false) {
    if (!state.user || !state.user.id) return;
    try {
        let url = `${BACKEND_URL}/api/support/messages?telegram_id=${state.user.id}`;
        if (chatCursor.user > 0) url += `&since_id=${chatCursor.user}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const msgs = data.messages || [];

        if (msgs.length > 0) {
            // Remove "empty state" placeholder if it exists
            const empty = supportMessages.querySelector('.support-empty');
            if (empty) empty.remove();

            const wasAtBottom = isScrolledToBottom(supportMessages);
            msgs.forEach(m => {
                if (m.id > chatCursor.user) chatCursor.user = m.id;
                appendSupportBubble(supportMessages, m, 'user');
            });
            if (wasAtBottom || chatCursor.user === 0) {
                supportMessages.scrollTop = supportMessages.scrollHeight;
            }
        } else if (chatCursor.user === 0) {
            // Very first load, no messages at all
            supportMessages.innerHTML = `
                <div class="support-empty">
                    <div style="font-size:40px;">💬</div>
                    <div>Start a conversation with our support team.</div>
                    <div style="opacity:0.6; font-size:13px;">We usually reply within 24 hours.</div>
                </div>`;
        }

        // Mark admin messages as read for the user
        await fetch(`${BACKEND_URL}/api/support/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: state.user.id, viewer: 'user' })
        });
        // Refresh the badge to 0
        updateSupportBadge(0);
    } catch (e) {
        if (!silent) console.error('Load support messages error:', e);
    }
}

async function sendSupportMessage() {
    const text = (supportInput.value || '').trim();
    if (!text || !state.user) return;
    supportInput.value = '';

    // Optimistic render
    const optimisticId = 'opt-' + Date.now();
    appendSupportBubble(supportMessages, {
        id: optimisticId,
        message: text,
        sender: 'user',
        created_at: new Date().toISOString(),
        _optimistic: true
    }, 'user');
    supportMessages.scrollTop = supportMessages.scrollHeight;

    try {
        await fetch(`${BACKEND_URL}/api/support/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: state.user.id,
                message: text,
                sender: 'user',
                first_name: state.user.first_name || '',
                username: state.user.username || '',
                // Send the client-generated avatar fallback so admins always
                // see something recognisable, even when Telegram omits photo_url.
                photo_url: getMyAvatarUrl()
            })
        });
        const opt = supportMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        await loadSupportMessages();
    } catch (e) {
        const opt = supportMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        showToast('Failed to send message.', 'error');
    }
}

supportSendBtn.addEventListener('click', sendSupportMessage);
supportInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendSupportMessage();
    }
});
closeSupportChat.addEventListener('click', closeSupport);

// -------------------- ADMIN SIDE --------------------
async function loadSupportConversations() {
    if (!state.user || !state.user.id) return;
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/conversations?admin_id=${state.user.id}`);
        const data = await resp.json();
        renderSupportConversations(data.conversations || []);
    } catch (e) {
        console.error('Load conversations error:', e);
    }
}

function renderSupportConversations(convos) {
    if (!supportConversations) return;

    // Skip re-render if nothing changed (prevents flicker)
    const payload = JSON.stringify(convos.map(c => [
        c.telegram_id, c.first_name, c.photo_url, c.last_message,
        c.last_message_at, c.last_sender, c.unread_count
    ]));
    if (payload === lastRendered.conversations) return;
    lastRendered.conversations = payload;

    if (!convos.length) {
        supportConversations.innerHTML = '<div class="saved-empty-state">No conversations yet</div>';
        return;
    }

    supportConversations.innerHTML = convos.map(c => {
        const preview = (c.last_message || '').slice(0, 60);
        // Use the user's real photo if we have one, otherwise draw initials
        // client-side (no external request, no flicker).
        const avatarSrc = c.photo_url || buildInitialsAvatar(c.first_name || 'User');
        const unreadHtml = c.unread_count > 0 ? `<span class="support-unread">${c.unread_count}</span>` : '';
        const senderPrefix = c.last_sender === 'admin' ? '<span style="opacity:0.5">You: </span>' : '';
        return `
            <div class="support-convo" data-tid="${c.telegram_id}">
                <img class="support-avatar" src="${avatarSrc}" alt="" />
                <div class="support-convo-body">
                    <div class="support-convo-top">
                        <span class="support-convo-name">${escapeHtml(c.first_name)}</span>
                        <span class="support-convo-time">${formatTime(c.last_message_at)}</span>
                    </div>
                    <div class="support-convo-bottom">
                        <span class="support-convo-preview">${senderPrefix}${escapeHtml(preview)}</span>
                        ${unreadHtml}
                    </div>
                </div>
            </div>`;
    }).join('');

    supportConversations.querySelectorAll('.support-convo').forEach(el => {
        el.addEventListener('click', () => {
            const tid = parseInt(el.dataset.tid);
            const convo = convos.find(c => String(c.telegram_id) === el.dataset.tid);
            openAdminChat(tid, convo);
        });
    });
}

async function openAdminChat(telegramId, convo) {
    state.activeSupportUser = telegramId;
    state.activeSupportUserInfo = convo || null;

    supportListView.style.display = 'none';
    adminChatView.style.display = 'flex';
    adminChatName.textContent = convo?.first_name || 'User';

    // Same fallback: initials if no photo
    const avatarSrc = convo?.photo_url || buildInitialsAvatar(convo?.first_name || 'User');
    adminChatAvatar.src = avatarSrc;

    // Full reload for this user: reset container and cursor
    adminChatMessages.innerHTML = '';
    chatCursor.admin[telegramId] = 0;

    await loadAdminChatMessages(telegramId);
    await fetch(`${BACKEND_URL}/api/support/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: telegramId, viewer: 'admin' })
    });

    startAdminChatPolling();
}

async function loadAdminChatMessages(telegramId, silent = false) {
    try {
        const cursor = chatCursor.admin[telegramId] || 0;
        let url = `${BACKEND_URL}/api/support/messages?telegram_id=${telegramId}`;
        if (cursor > 0) url += `&since_id=${cursor}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const msgs = data.messages || [];

        // If the admin navigated away mid-fetch, ignore the result
        if (state.activeSupportUser !== telegramId) return;

        if (msgs.length > 0) {
            const wasAtBottom = isScrolledToBottom(adminChatMessages);
            msgs.forEach(m => {
                if (m.id > (chatCursor.admin[telegramId] || 0)) {
                    chatCursor.admin[telegramId] = m.id;
                }
                appendSupportBubble(adminChatMessages, m, 'admin');
            });
            if (wasAtBottom || cursor === 0) {
                adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
            }
        }
    } catch (e) {
        if (!silent) console.error('Load admin chat error:', e);
    }
}

async function sendAdminReply() {
    const text = (adminChatInput.value || '').trim();
    if (!text || !state.activeSupportUser || !state.user) return;
    adminChatInput.value = '';

    const optimisticId = 'opt-' + Date.now();
    appendSupportBubble(adminChatMessages, {
        id: optimisticId,
        message: text,
        sender: 'admin',
        created_at: new Date().toISOString(),
        _optimistic: true
    }, 'admin');
    adminChatMessages.scrollTop = adminChatMessages.scrollHeight;

    try {
        await fetch(`${BACKEND_URL}/api/support/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: state.activeSupportUser,
                message: text,
                sender: 'admin',
                admin_id: state.user.id
            })
        });
        const opt = adminChatMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        await loadAdminChatMessages(state.activeSupportUser);
    } catch (e) {
        const opt = adminChatMessages.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        showToast('Failed to send reply.', 'error');
    }
}

adminChatSendBtn.addEventListener('click', sendAdminReply);
adminChatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendAdminReply();
    }
});
closeSupportList.addEventListener('click', closeSupport);

backToSupportList.addEventListener('click', () => {
    if (state.adminChatPolling) { clearInterval(state.adminChatPolling); state.adminChatPolling = null; }
    state.activeSupportUser = null;
    state.activeSupportUserInfo = null;
    adminChatView.style.display = 'none';
    supportListView.style.display = 'flex';
    // Force list refresh since state may have changed
    lastRendered.conversations = '';
    loadSupportConversations();
    startAdminListPolling();
});

// =============================================================================
//  INITIAL LOAD
// =============================================================================
loadGames(true);
renderRecentGames();
handleDeepLink();
