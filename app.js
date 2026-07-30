// app.js – Nanogamz main application

import { ADS } from './ads.js';

// ------------------------ CONFIG ------------------------
// Use the URL set in index.html (or fallback)
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

// ------------------------ STATE ------------------------
const state = {
    currentCategory: '🔥 Discover',
    offset: 0,
    limit: 20,
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
    // Saved games
    savedGameIds: new Set(),
    savedOffset: 0,
    savedLimit: 20,
    savedHasMore: true,
    loadingSaved: false
};

// ------------------------ TELEGRAM WEBAPP ------------------------
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    state.user = tg.initDataUnsafe.user;
    document.getElementById('userName').textContent = state.user.first_name || 'Player';
    document.getElementById('userId').textContent = `ID: ${state.user.id}`;
    if (state.user.photo_url) {
        document.getElementById('userAvatar').src = state.user.photo_url;
    } else {
        const initials = (state.user.first_name?.[0] || 'U') + (state.user.last_name?.[0] || '');
        const canvas = document.createElement('canvas');
        canvas.width = 100; canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = state.theme.accent;
        ctx.beginPath();
        ctx.arc(50,50,50,0,2*Math.PI);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials || 'U', 50, 52);
        document.getElementById('userAvatar').src = canvas.toDataURL();
    }

    // 🔽 Pre-fetch saved games when user is verified
    fetchUserSavedGameIds();
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

// New elements for pill controls and saved games
const saveBtn = document.getElementById('saveBtn');
const savedOverlay = document.getElementById('savedOverlay');
const savedGamesLink = document.getElementById('savedGamesLink');
const closeSavedOverlay = document.getElementById('closeSavedOverlay');
const savedGrid = document.getElementById('savedGrid');
const savedGridContainer = document.getElementById('savedGridContainer');

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
    // Do NOT reset state.searchQuery here – that is handled by resetSearch() when needed
}

function resetSearch() {
    // Clear search state and reload the current category view
    if (state.searchQuery === '') {
        // If already empty, just close the panel
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
        resetSearch(); // user closed without submitting -> clear search
    } else {
        openSearch();
    }
}

function performSearch() {
    const query = searchInput.value.trim();
    // Close panel first (UI), then set query and load
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

// Clicking outside the search panel clears the search
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

// ------------------------ AD CAROUSEL ------------------------
function initAdCarousel() {
    adWrapper.innerHTML = ADS.map(ad => `
        <div class="swiper-slide">
            <a href="${ad.link}" target="_blank"><img src="${ad.image}" alt="ad" /></a>
        </div>
    `).join('');
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
        // Reset ad offset when loading new content
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

// ==================== PARALLAX AD COLLAPSE (DELTA‑BASED) ====================
let lastScrollTop = 0;
let adOffset = 0;
const AD_HEIGHT = 160;
const TOP_BAR_HEIGHT = 56;
const CAT_BAR_HEIGHT = 48;

// 🔥 NEW: Adjust this to control speed. 0.7 = 70% of scroll speed.
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

// Listen to scroll with delta
let ticking = false;
gridContainer.addEventListener('scroll', () => {
    if (!ticking) {
        window.requestAnimationFrame(() => {
            const scrollTop = gridContainer.scrollTop;
            const delta = scrollTop - lastScrollTop;
            lastScrollTop = scrollTop;

            // 👇 MULTIPLY the delta by the ratio here
            adOffset = Math.min(Math.max(adOffset + (delta * SCROLL_RATIO), 0), AD_HEIGHT);

            updateAdPosition(adOffset);
            ticking = false;
        });
        ticking = true;
    }
});

// Ensure initial position is correct
resetAdOffset();

// ------------------------ PULL-TO-REFRESH ------------------------
refreshBtn.addEventListener('click', () => {
    state.offset = 0;
    state.hasMore = true;
    state.games = [];
    generateNewSeed();
    loadGames(true);
});

// ------------------------ GAME MODAL ------------------------
let activeModalGame = null;

// --- DATABASE-DRIVEN RECENT GAMES LOGIC (NEW) ---

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
        // Refresh recent games UI in menu
        renderRecentGames();
    } catch (err) {
        console.error("Failed to record recent game:", err);
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
            item.className = 'recent-game';  // matches existing CSS
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <img src="${game.thumbnail || 'https://via.placeholder.com/70/333/666?text=?'}" alt="${game.title}" />
                <div style="font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${game.title}</div>
            `;

            // Directly launches the complete game object returned from Supabase!
            item.addEventListener('click', () => {
                toggleMenu(); // Close side menu
                openGame(game);
            });

            recentGamesContainer.appendChild(item);
        });
    } catch (err) {
        console.error("Error rendering recent games:", err);
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
    }
}

// Update openGame function to record game open event in Supabase
async function openGame(game) {
    if (!game || !game.playable_url) {
        alert("Game URL not found. Please try again.");
        return;
    }

    activeModalGame = game;

    // 1. Immediately reflect current saved state in UI
    syncSavedState(game.id);
    
    gameIframe.src = game.playable_url;
    gameModal.classList.add('active');

    // Record game into user's recent_games array in Supabase
    recordRecentGame(game.id);

    // 2. Fetch fresh list in background to ensure accurate button state
    if (state.user && state.user.id) {
        await fetchUserSavedGameIds();
        syncSavedState(game.id);
    }
}

modalClose.addEventListener('click', () => {
    gameModal.classList.remove('active');
    gameIframe.src = '';
});
gameModal.addEventListener('click', (e) => {
    if (e.target === gameModal) {
        gameModal.classList.remove('active');
        gameIframe.src = '';
    }
});

// ------------------------ RECENT GAMES ------------------------
// (Initial render – kept for backward compatibility, but the async version will overwrite)
// We still call renderRecentGames after user is set and on menu open.
// The old localStorage-based render is replaced by the async version above.
// The initial call will be made in the menu toggle logic below.

// ------------------------ SIDE MENU ------------------------
function toggleMenu() {
    const isOpen = menuPanel.classList.contains('open');
    menuPanel.classList.toggle('open');
    menuOverlay.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
    if (!isOpen) {
        // When opening menu, refresh recent games from server
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

document.getElementById('supportLink').addEventListener('click', (e) => {
    e.preventDefault();
    tg.openTelegramLink('https://t.me/ojareridominion');
    toggleMenu();
});

// ==================== PILL CONTROLS ====================
// Save/Unsave
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
        }
    } catch (err) {
        console.error('Failed to toggle save state', err);
    }
});

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

        // Switch from right-based positioning to left/top absolute offsets for smooth dragging
        pill.style.right = 'auto';
        pill.style.left = `${initialLeft}px`;
        pill.style.top = `${initialTop}px`;
    };

    const moveDrag = (clientX, clientY) => {
        if (!isDragging) return;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        // Mark as dragged if threshold passed (prevents click events from firing accidentally when dragging)
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            hasDragged = true;
        }

        // Calculate target positions
        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Keep inside screen bounds
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

    // --- Touch Events (Mobile Telegram Mini App) ---
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

    // --- Mouse Events (Desktop Testing) ---
    pill.addEventListener('mousedown', (e) => {
        startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        moveDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', endDrag);

    // Block button clicks if user was dragging the pill
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
    } finally {
        state.loadingSaved = false;
    }
}

// Close dropdowns on outside click
document.addEventListener('click', () => {
    document.querySelectorAll('.card-dropdown.show').forEach(d => d.classList.remove('show'));
});

// Open saved overlay
savedGamesLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu();
    savedOverlay.classList.add('active');
    loadSavedGames(true);
});

closeSavedOverlay.addEventListener('click', () => {
    savedOverlay.classList.remove('active');
});

// Infinite scroll inside Saved Games overlay
savedGridContainer.addEventListener('scroll', () => {
    if (savedGridContainer.scrollTop + savedGridContainer.clientHeight >= savedGridContainer.scrollHeight - 100) {
        if (!state.loadingSaved && state.savedHasMore) {
            loadSavedGames(false);
        }
    }
});

// ------------------------ INITIAL LOAD ------------------------
loadGames(true);
// Initial render of recent games (will be refreshed when menu opens)
renderRecentGames();
