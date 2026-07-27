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
    }
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

function toggleSearch() {
    if (searchOpen) closeSearch();
    else openSearch();
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
        closeSearch();
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

            // Update adOffset based on delta, clamp between 0 and AD_HEIGHT
            adOffset = Math.min(Math.max(adOffset + delta, 0), AD_HEIGHT);

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
function openGame(game) {
    gameIframe.src = game.playable_url;
    gameModal.classList.add('active');
    const recent = JSON.parse(localStorage.getItem('nanogamz_recent') || '[]');
    const filtered = recent.filter(g => g.id !== game.id);
    filtered.unshift({ id: game.id, title: game.title, thumbnail: game.thumbnail });
    if (filtered.length > 10) filtered.pop();
    localStorage.setItem('nanogamz_recent', JSON.stringify(filtered));
    renderRecentGames();
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
function renderRecentGames() {
    const container = document.getElementById('recentGames');
    const recent = JSON.parse(localStorage.getItem('nanogamz_recent') || '[]');
    if (recent.length === 0) {
        container.innerHTML = '<div style="opacity:0.5; font-size:13px;">No games played yet</div>';
        return;
    }
    container.innerHTML = recent.map(g => `
        <div class="recent-game" data-id="${g.id}">
            <img src="${g.thumbnail || 'https://via.placeholder.com/70/333/666?text=?'}" alt="${g.title}" />
            <div style="font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${g.title}</div>
        </div>
    `).join('');
    container.querySelectorAll('.recent-game').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const game = state.games.find(g => g.id === id);
            if (game) openGame(game);
            else {
                alert('Game not found in current list. Please refresh.');
            }
        });
    });
}
renderRecentGames();

// ------------------------ SIDE MENU ------------------------
function toggleMenu() {
    const isOpen = menuPanel.classList.contains('open');
    menuPanel.classList.toggle('open');
    menuOverlay.classList.toggle('active');
    document.body.style.overflow = isOpen ? '' : 'hidden';
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

// ------------------------ INITIAL LOAD ------------------------
loadGames(true);
