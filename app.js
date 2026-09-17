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

function safeOn(id, event, handler, options) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler, options);
    return el;
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
    isAdmin: false,
    supportPolling: null,
    adminListPolling: null,
    adminChatPolling: null,
    userUnreadPolling: null,
    activeSupportUser: null,
    activeSupportUserInfo: null,
    myAvatarUrl: null
};

// ------------------------ TELEGRAM WEBAPP ------------------------
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
if (tg) {
    try { tg.ready(); } catch (e) { /* ignore */ }
    try { tg.expand(); } catch (e) { /* ignore */ }
}

function buildInitialsAvatar(name) {
    const initials = (name?.[0] || 'U').toUpperCase();
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext('2d');
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

if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    state.user = tg.initDataUnsafe.user;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = state.user.first_name || 'Player';
    const idEl = document.getElementById('userId');
    if (idEl) idEl.textContent = `ID: ${state.user.id}`;
    const avEl = document.getElementById('userAvatar');
    if (avEl) avEl.src = getMyAvatarUrl();

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
    if (searchOpen || !searchPanel) return;
    searchPanel.classList.add('open');
    document.body.classList.add('search-open');
    searchOpen = true;
    if (searchToggle) searchToggle.textContent = '✕';
    setTimeout(() => searchInput && searchInput.focus(), 100);
}

function closeSearch() {
    if (!searchOpen || !searchPanel) return;
    searchPanel.classList.remove('open');
    document.body.classList.remove('search-open');
    searchOpen = false;
    if (searchToggle) searchToggle.textContent = '🔍';
    if (searchInput) searchInput.value = '';
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
    const query = (searchInput?.value || '').trim();
    closeSearch();
    state.searchQuery = query;
    state.offset = 0;
    state.hasMore = true;
    state.games = [];
    generateNewSeed();
    loadGames(true);
}

if (searchToggle) searchToggle.addEventListener('click', toggleSearch);
if (searchSubmitBtn) searchSubmitBtn.addEventListener('click', performSearch);
if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performSearch();
        }
    });
}

document.addEventListener('click', (e) => {
    if (searchOpen && searchPanel && !searchPanel.contains(e.target) && e.target !== searchToggle) {
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
    if (!container) return;
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

    if (!adWrapper) return;

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

    if (typeof Swiper === 'undefined') return;

    try {
        state.swiperAd = new Swiper('#adCarousel', {
            loop: true,
            autoplay: { delay: 4000, disableOnInteraction: false },
            speed: 800,
            slidesPerView: 1,
            spaceBetween: 0,
            effect: 'slide',
        });
    } catch (e) {
        console.warn('Swiper init failed:', e);
    }
}

initAdCarousel();

// ------------------------ CATEGORY BAR ------------------------
function renderCategories() {
    if (!catBar) return;
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
    if (!container) return;
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

    if (reset && grid) {
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
if (gridContainer) {
    gridContainer.addEventListener('scroll', () => {
        if (gridContainer.scrollTop + gridContainer.clientHeight >= gridContainer.scrollHeight - 100) {
            if (!state.loading && state.hasMore) loadGames(false);
        }
    });
}

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
    if (adCarousel) adCarousel.style.transform = `translateY(-${offset}px)`;
    if (catBar) catBar.style.top = `${TOP_BAR_HEIGHT + AD_HEIGHT - offset}px`;
    if (gridContainer) gridContainer.style.top = `${TOP_BAR_HEIGHT + AD_HEIGHT + CAT_BAR_HEIGHT - offset}px`;
}

let ticking = false;
if (gridContainer) {
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
}

resetAdOffset();

// ------------------------ REFRESH ------------------------
if (refreshBtn) {
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
}

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
    if (gameIframe) gameIframe.src = game.playable_url;
    if (gameModal) gameModal.classList.add('active');

    recordRecentGame(game.id);

    if (state.user && state.user.id) {
        await fetchUserSavedGameIds();
        syncSavedState(game.id);
    }
}

function closeGameModal() {
    if (gameModal) gameModal.classList.remove('active');
    if (gameIframe) gameIframe.src = '';
    resetPillPosition();
}

if (modalClose) modalClose.addEventListener('click', closeGameModal);

if (gameModal) {
    gameModal.addEventListener('click', (e) => {
        if (e.target === gameModal) {
            closeGameModal();
        }
    });
}

// ------------------------ SIDE MENU ------------------------
function toggleMenu() {
    if (!menuPanel) return;
    const isOpen = menuPanel.classList.contains('open');
    menuPanel.classList.toggle('open');
    if (menuOverlay) menuOverlay.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
    if (!isOpen) {
        renderRecentGames();
    }
}
if (menuToggle) menuToggle.addEventListener('click', toggleMenu);
if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);

if (closeMenuBtn) {
    closeMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuPanel.classList.contains('open')) {
            toggleMenu();
        }
    });
}

// ==================== SHARE BOT ====================
safeOn('shareLink', 'click', async (e) => {
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
    if (!userIdEl) return;
    const userId = userIdEl.textContent.replace('ID: ', '').trim();
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            if (!btn) return;
            const original = btn.textContent;
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }).catch(() => {
            alert('Failed to copy ID.');
        });
    }
}

safeOn('copyIdBtn', 'click', copyUserId);

// ==================== COPYRIGHT & PRIVACY MODALS ====================
function openCopyright() {
    const m = document.getElementById('copyrightModal');
    if (m) m.classList.add('active');
}
function closeCopyright() {
    const m = document.getElementById('copyrightModal');
    if (m) m.classList.remove('active');
}

function openPrivacy() {
    const m = document.getElementById('privacyModal');
    if (m) m.classList.add('active');
}
function closePrivacy() {
    const m = document.getElementById('privacyModal');
    if (m) m.classList.remove('active');
}

safeOn('copyrightLink', 'click', (e) => {
    e.preventDefault();
    toggleMenu();
    openCopyright();
});
safeOn('privacyLink', 'click', (e) => {
    e.preventDefault();
    toggleMenu();
    openPrivacy();
});

safeOn('copyrightClose', 'click', closeCopyright);
safeOn('privacyClose', 'click', closePrivacy);

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

// ==================== SUPPORT LINK (opens in-app overlay) ====================
safeOn('supportLink', 'click', (e) => {
    e.preventDefault();
    toggleMenu();
    openSupport();
});

// ==================== PILL CONTROLS ====================
async function syncSavedState(gameId) {
    if (!saveBtn) return;
    const isSaved = state.savedGameIds.has(String(gameId));
    saveBtn.textContent = isSaved ? '📑' : '🔖';
    saveBtn.title = isSaved ? 'Delete from Saved' : 'Save Game';
}

if (saveBtn) {
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

                if (savedOverlay && savedOverlay.classList.contains('active')) {
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
}

// ==================== SHARE GAME ====================
const BOT_USERNAME = 'Nanogamz_bot';

if (shareBtn) {
    shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!activeModalGame) {
            showToast('No game loaded to share.', 'error');
            return;
        }
        shareGame(activeModalGame.id);
    });
}

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
    if (!tg) return;
    const startParam = tg.initDataUnsafe?.start_param;
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

    if (!savedGrid) { state.loadingSaved = false; return; }

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

safeOn('savedGamesLink', 'click', (e) => {
    e.preventDefault();
    toggleMenu();
    if (savedOverlay) savedOverlay.classList.add('active');
    loadSavedGames(true);
});

safeOn('closeSavedOverlay', 'click', () => {
    if (savedOverlay) savedOverlay.classList.remove('active');
});

if (refreshSavedBtn) {
    refreshSavedBtn.addEventListener('click', () => {
        state.savedOffset = 0;
        state.savedHasMore = true;
        loadSavedGames(true);
        showToast('Refreshing saved games...', 'info', 1000);
    });
}

if (savedGridContainer) {
    savedGridContainer.addEventListener('scroll', () => {
        if (savedGridContainer.scrollTop + savedGridContainer.clientHeight >= savedGridContainer.scrollHeight - 100) {
            if (!state.loadingSaved && state.savedHasMore) {
                loadSavedGames(false);
            }
        }
    });
}

// =============================================================================
//  SUPPORT CHAT  (USER VIEW + ADMIN VIEW)
// =============================================================================

const lastRendered = {
    conversations: ''
};

// Cursor map so we only download NEW messages on each poll.
const chatCursor = {
    user: 0,
    admin: {}  // telegram_id -> last seen message id
};

function isScrolledToBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// -------------------- MESSAGE RENDERING HELPERS --------------------

function linkifyMessage(text) {
    if (!text) return '';

    const tokens = [];
    const regex = /(https?:\/\/[^\s<>"']+)|(\+?\d[\d\s\-()]{4,}\d)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        if (match[1]) {
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

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through */ }
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

// Append a single bubble (text or image) with its copy button.
// `role` is 'user' or 'admin' — determines which sender means "mine".
//
// ✅ IMAGE HANDLING CHANGED: images are now stored as URLs (https://i.ibb.co/…)
// after being uploaded to ImgBB. We still use the `__IMG__` prefix so the
// wire format stays compatible; the payload after the prefix is now a URL.
function appendSupportBubble(container, msg, role) {
    if (!container) return;
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
        const imageSrc = rawMessage.substring(7);
        const img = document.createElement('img');
        img.className = 'support-image';
        img.src = imageSrc;
        img.alt = 'image';
        img.loading = 'lazy';
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openImagePreview(imageSrc);
        });

        // Simple network-error fallback – no more "too large/corrupted" wording
        img.onerror = () => {
            img.style.display = 'none';
            const fallback = document.createElement('div');
            fallback.style.padding = '10px';
            fallback.style.fontSize = '12px';
            fallback.style.color = '#ff5555';
            fallback.style.textAlign = 'center';
            fallback.textContent = '❌ Image failed to load';
            bubble.appendChild(fallback);
        };

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
    const urlEl = document.getElementById('linkOptionsUrl');
    if (urlEl) urlEl.textContent = url;
    const modal = document.getElementById('linkOptionsModal');
    if (modal) modal.classList.add('active');
}

safeOn('linkOptionCopy', 'click', async () => {
    const ok = await copyToClipboard(activeLinkUrl);
    const modal = document.getElementById('linkOptionsModal');
    if (modal) modal.classList.remove('active');
    showToast(ok ? '📋 Link copied' : 'Failed to copy', ok ? 'success' : 'error', 1500);
});

safeOn('linkOptionOpen', 'click', () => {
    const url = activeLinkUrl;
    const modal = document.getElementById('linkOptionsModal');
    if (modal) modal.classList.remove('active');
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

safeOn('linkOptionCancel', 'click', () => {
    const modal = document.getElementById('linkOptionsModal');
    if (modal) modal.classList.remove('active');
});

safeOn('linkOptionsModal', 'click', (e) => {
    if (e.target && e.target.id === 'linkOptionsModal') {
        e.target.classList.remove('active');
    }
});

// -------------------- IMAGE PREVIEW MODAL --------------------
function openImagePreview(src) {
    const img = document.getElementById('imagePreviewImg');
    if (img) img.src = src;
    const modal = document.getElementById('imagePreviewModal');
    if (modal) modal.classList.add('active');
}

safeOn('imagePreviewClose', 'click', () => {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) modal.classList.remove('active');
});

safeOn('imagePreviewModal', 'click', (e) => {
    if (e.target && e.target.id === 'imagePreviewModal') {
        e.target.classList.remove('active');
    }
});

// -------------------- IMAGE COMPRESSION --------------------
// We still compress before uploading so ImgBB uploads are fast & the
// request body stays small.
function compressImage(file, maxDim = 1600, quality = 0.85) {
    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;

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

                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                try {
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (err) {
                    console.error('Canvas toDataURL failed:', err);
                    resolve(null);
                }
            };

            img.onerror = (err) => {
                console.error('Image load failed:', err);
                resolve(null);
            };

            img.src = e.target.result;
        };

        reader.onerror = (err) => {
            console.error('FileReader failed:', err);
            resolve(null);
        };

        reader.readAsDataURL(file);
    });
}

// -------------------- IMAGE UPLOAD TO IMGBB (via backend proxy) --------------------
// The backend proxies the base64 payload to ImgBB and returns a hosted URL.
// We do this via our own backend so the ImgBB API key never touches the client.
async function uploadImageToServer(dataUrl) {
    if (!dataUrl) return null;
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/upload-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl })
        });
        if (!resp.ok) {
            console.error('Upload HTTP error:', resp.status);
            return null;
        }
        const data = await resp.json();
        if (data.status === 'success' && data.url) {
            return data.url;
        }
        console.error('Upload error:', data.message);
        return null;
    } catch (e) {
        console.error('Image upload exception:', e);
        return null;
    }
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
        // Allow larger originals now since we compress + offload to ImgBB.
        if (file.size > 15 * 1024 * 1024) {
            showToast('Image must be under 15MB.', 'error');
            return;
        }

        showToast('Processing image…', 'info', 1500);
        const dataUrl = await compressImage(file);
        if (!dataUrl) {
            showToast('Failed to process image.', 'error');
            return;
        }

        showToast('Uploading image…', 'info', 4000);
        const imageUrl = await uploadImageToServer(dataUrl);
        if (!imageUrl) {
            showToast('Failed to upload image. Please try again.', 'error');
            return;
        }

        await sendImageMessage(imageUrl, senderType);
    });
}

// Sends a message with `__IMG__<url>` as its payload.
async function sendImageMessage(imageUrl, sender) {
    if (!state.user || !imageUrl) return;

    const message = `__IMG__${imageUrl}`;

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
        if (supportMessages) supportMessages.scrollTop = supportMessages.scrollHeight;

        try {
            const resp = await fetch(`${BACKEND_URL}/api/support/send`, {
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
            const opt = supportMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            if (!resp.ok) {
                showToast('Failed to send image.', 'error');
                return;
            }
            await loadSupportMessages();
            showToast('📷 Image sent', 'success', 1500);
        } catch (err) {
            const opt = supportMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
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
        if (adminChatMessages) adminChatMessages.scrollTop = adminChatMessages.scrollHeight;

        try {
            const resp = await fetch(`${BACKEND_URL}/api/support/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: state.activeSupportUser,
                    message,
                    sender: 'admin',
                    admin_id: state.user.id
                })
            });
            const opt = adminChatMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            if (!resp.ok) {
                showToast('Failed to send image.', 'error');
                return;
            }
            await loadAdminChatMessages(state.activeSupportUser);
            showToast('📷 Image sent', 'success', 1500);
        } catch (err) {
            const opt = adminChatMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
            if (opt) opt.remove();
            showToast('Failed to send image.', 'error');
        }
    }
}

setupImageUpload('supportClipBtn', 'supportImageInput', 'user');
setupImageUpload('adminClipBtn', 'adminImageInput', 'admin');

// -------------------- USER-SIDE UNREAD BADGE POLLING --------------------
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
    try {
        const resp = await fetch(`${BACKEND_URL}/api/support/messages?telegram_id=${state.user.id}`);
        const data = await resp.json();
        const unread = (data.messages || []).filter(m => m.sender === 'admin' && !m.read_by_user).length;
        updateSupportBadge(unread);
    } catch {}
}

function startUserUnreadPolling() {
    if (state.userUnreadPolling) clearInterval(state.userUnreadPolling);
    setTimeout(pollUserUnread, 1500);
    state.userUnreadPolling = setInterval(pollUserUnread, 20000);
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
    if (!supportOverlay) return;
    supportOverlay.classList.add('active');

    if (state.isAdmin) {
        if (supportListView) supportListView.style.display = 'flex';
        if (supportChatView) supportChatView.style.display = 'none';
        if (adminChatView) adminChatView.style.display = 'none';
        loadSupportConversations();
        startAdminListPolling();
    } else {
        if (supportListView) supportListView.style.display = 'none';
        if (adminChatView) adminChatView.style.display = 'none';
        if (supportChatView) supportChatView.style.display = 'flex';
        // Clear the badge immediately — we're about to mark them read
        updateSupportBadge(0);

        // ✅ NEW: Force a full history load on every open so that
        // the "first unread" divider shows up correctly every time.
        chatCursor.user = 0;
        if (supportMessages) supportMessages.innerHTML = '';

        loadSupportMessages();
        startSupportPolling();
    }
}

function closeSupport() {
    if (supportOverlay) supportOverlay.classList.remove('active');
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
        if (supportOverlay && supportOverlay.classList.contains('active') &&
            supportChatView && supportChatView.style.display !== 'none') {
            loadSupportMessages(true);
        }
    }, 5000);
}

function startAdminListPolling() {
    if (state.adminListPolling) clearInterval(state.adminListPolling);
    state.adminListPolling = setInterval(() => {
        if (supportOverlay && supportOverlay.classList.contains('active') &&
            supportListView && supportListView.style.display !== 'none') {
            loadSupportConversations();
        }
    }, 8000);
}

function startAdminChatPolling() {
    if (state.adminChatPolling) clearInterval(state.adminChatPolling);
    state.adminChatPolling = setInterval(() => {
        if (supportOverlay && supportOverlay.classList.contains('active') &&
            adminChatView && adminChatView.style.display !== 'none' &&
            state.activeSupportUser) {
            loadAdminChatMessages(state.activeSupportUser, true);
        }
    }, 5000);
}

// -------------------- UNREAD DIVIDER HELPERS --------------------
// Insert a "New Messages" divider right above the first unread message
// and smoothly scroll it into the middle of the viewport.
function insertUnreadDivider(container, firstUnreadId) {
    if (!container || !firstUnreadId) return false;
    const target = container.querySelector(`[data-msg-id="${firstUnreadId}"]`);
    if (!target || !target.parentNode) return false;

    // Avoid double-inserting
    if (container.querySelector('.unread-divider')) return false;

    const divider = document.createElement('div');
    divider.className = 'unread-divider';
    divider.innerHTML = '<span>New Messages</span>';
    target.parentNode.insertBefore(divider, target);

    requestAnimationFrame(() => {
        try {
            target.scrollIntoView({ block: 'center', behavior: 'auto' });
        } catch {
            // older WebViews
            const top = target.offsetTop - container.clientHeight / 2;
            container.scrollTop = Math.max(0, top);
        }
    });
    return true;
}

// -------------------- USER SIDE --------------------
async function loadSupportMessages(silent = false) {
    if (!state.user || !state.user.id || !supportMessages) return;
    const isFirstLoad = chatCursor.user === 0;
    try {
        const url = `${BACKEND_URL}/api/support/messages?telegram_id=${state.user.id}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const msgs = data.messages || [];

        // Detect the first unread admin message BEFORE we render (so we
        // can draw a divider and scroll to it).
        let firstUnreadId = null;
        if (isFirstLoad && msgs.length > 0) {
            const firstUnread = msgs.find(m => m.sender === 'admin' && !m.read_by_user);
            if (firstUnread) firstUnreadId = firstUnread.id;
        }

        if (msgs.length > 0) {
            const empty = supportMessages.querySelector('.support-empty');
            if (empty) empty.remove();

            const wasAtBottom = isScrolledToBottom(supportMessages);

            msgs.forEach(m => {
                if (m.id > chatCursor.user) chatCursor.user = m.id;
                appendSupportBubble(supportMessages, m, 'user');
            });

            // Scroll behavior: prefer unread divider, else bottom.
            const dividerInserted = firstUnreadId
                ? insertUnreadDivider(supportMessages, firstUnreadId)
                : false;

            if (!dividerInserted && (wasAtBottom || isFirstLoad)) {
                supportMessages.scrollTop = supportMessages.scrollHeight;
            }
        } else if (isFirstLoad) {
            supportMessages.innerHTML = `
                <div class="support-empty">
                    <div style="font-size:40px;">💬</div>
                    <div>Start a conversation with our support team.</div>
                    <div style="opacity:0.6; font-size:13px;">We usually reply within 24 hours.</div>
                </div>`;
        }

        // Mark admin messages as read for the user (after we've already
        // captured the unread divider position)
        await fetch(`${BACKEND_URL}/api/support/mark-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: state.user.id, viewer: 'user' })
        });
        updateSupportBadge(0);
    } catch (e) {
        if (!silent) console.error('Load support messages error:', e);
    }
}

async function sendSupportMessage() {
    const text = (supportInput?.value || '').trim();
    if (!text || !state.user) return;
    if (supportInput) supportInput.value = '';

    const optimisticId = 'opt-' + Date.now();
    appendSupportBubble(supportMessages, {
        id: optimisticId,
        message: text,
        sender: 'user',
        created_at: new Date().toISOString(),
        _optimistic: true
    }, 'user');
    if (supportMessages) supportMessages.scrollTop = supportMessages.scrollHeight;

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
                photo_url: getMyAvatarUrl()
            })
        });
        const opt = supportMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        await loadSupportMessages();
    } catch (e) {
        const opt = supportMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        showToast('Failed to send message.', 'error');
    }
}

if (supportSendBtn) supportSendBtn.addEventListener('click', sendSupportMessage);
if (supportInput) {
    supportInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendSupportMessage();
        }
    });
}
if (closeSupportChat) closeSupportChat.addEventListener('click', closeSupport);

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

    if (supportListView) supportListView.style.display = 'none';
    if (adminChatView) adminChatView.style.display = 'flex';
    if (adminChatName) adminChatName.textContent = convo?.first_name || 'User';

    const avatarSrc = convo?.photo_url || buildInitialsAvatar(convo?.first_name || 'User');
    if (adminChatAvatar) adminChatAvatar.src = avatarSrc;

    // Reset container + cursor so we can render the unread divider correctly
    if (adminChatMessages) adminChatMessages.innerHTML = '';
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
    if (!adminChatMessages) return;
    try {
        const cursor = chatCursor.admin[telegramId] || 0;
        const isFirstLoad = cursor === 0;
        let url = `${BACKEND_URL}/api/support/messages?telegram_id=${telegramId}`;
        if (cursor > 0) url += `&since_id=${cursor}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const msgs = data.messages || [];

        if (state.activeSupportUser !== telegramId) return;

        // Find first unread user message (before rendering)
        let firstUnreadId = null;
        if (isFirstLoad && msgs.length > 0) {
            const firstUnread = msgs.find(m => m.sender === 'user' && !m.read_by_admin);
            if (firstUnread) firstUnreadId = firstUnread.id;
        }

        if (msgs.length > 0) {
            const wasAtBottom = isScrolledToBottom(adminChatMessages);
            msgs.forEach(m => {
                if (m.id > (chatCursor.admin[telegramId] || 0)) {
                    chatCursor.admin[telegramId] = m.id;
                }
                appendSupportBubble(adminChatMessages, m, 'admin');
            });

            const dividerInserted = firstUnreadId
                ? insertUnreadDivider(adminChatMessages, firstUnreadId)
                : false;

            if (!dividerInserted && (wasAtBottom || isFirstLoad)) {
                adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
            }
        }
    } catch (e) {
        if (!silent) console.error('Load admin chat error:', e);
    }
}

async function sendAdminReply() {
    const text = (adminChatInput?.value || '').trim();
    if (!text || !state.activeSupportUser || !state.user) return;
    if (adminChatInput) adminChatInput.value = '';

    const optimisticId = 'opt-' + Date.now();
    appendSupportBubble(adminChatMessages, {
        id: optimisticId,
        message: text,
        sender: 'admin',
        created_at: new Date().toISOString(),
        _optimistic: true
    }, 'admin');
    if (adminChatMessages) adminChatMessages.scrollTop = adminChatMessages.scrollHeight;

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
        const opt = adminChatMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        await loadAdminChatMessages(state.activeSupportUser);
    } catch (e) {
        const opt = adminChatMessages?.querySelector(`[data-msg-id="${optimisticId}"]`);
        if (opt) opt.remove();
        showToast('Failed to send reply.', 'error');
    }
}

if (adminChatSendBtn) adminChatSendBtn.addEventListener('click', sendAdminReply);
if (adminChatInput) {
    adminChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendAdminReply();
        }
    });
}
if (closeSupportList) closeSupportList.addEventListener('click', closeSupport);

if (backToSupportList) {
    backToSupportList.addEventListener('click', () => {
        if (state.adminChatPolling) { clearInterval(state.adminChatPolling); state.adminChatPolling = null; }
        state.activeSupportUser = null;
        state.activeSupportUserInfo = null;
        if (adminChatView) adminChatView.style.display = 'none';
        if (supportListView) supportListView.style.display = 'flex';
        lastRendered.conversations = '';
        loadSupportConversations();
        startAdminListPolling();
    });
}

// =============================================================================
//  INITIAL LOAD
// =============================================================================
loadGames(true);
renderRecentGames();
handleDeepLink();
