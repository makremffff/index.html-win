// /public/index.js (Frontend - Telegram WebApp)

// === الثوابت الموحدة ===
const AD_REWARD = 400;
const DAILY_MAX_ADS = 100;
const COOLDOWN_SEC = 3;
const POINTS_TO_USDT_RATE = 100000;
const BOT_USERNAME = 'Game_win_usdtBot';

// === UI Elements ===
const UI = {
    loaderOverlay: document.getElementById('loaderOverlay'),
    points: document.getElementById('points'),
    usdt: document.getElementById('usdt'),
    home: document.getElementById('home'),
    adsBtn: document.getElementById('adsBtn'),
    notifBar: document.getElementById('notifBar'),
    pointsInput: document.getElementById('pointsInput'),
    usdtValue: document.getElementById('usdtValue'),
    swapMsg: document.getElementById('swapMsg'),
    userImg: document.getElementById('userImg'),
    username: document.getElementById('username'),
    refCount: document.getElementById('refCount'),
    copyBtn: document.getElementById('copyBtn'),
    copyMsg: document.getElementById('copyMsg'),
    task: document.getElementById('task'),
    ledbord: document.getElementById('ledbord'),
    withdraw: document.getElementById('withdraw'),
    swap: document.getElementById('swap'),
    refal: document.getElementById('refal'),
    withdrawMsg: document.getElementById('withdrawMsg'),
    binanceIdInput: document.getElementById('binanceIdInput'),
    withdrawAmountInput: document.getElementById('withdrawAmountInput'),
    availableUsdt: document.getElementById('availableUsdt'),
    userCircle: document.getElementById('userCircle'),
    topBalance: document.getElementById('topBalance'),
    leaderboardList: document.getElementById('leaderboardList'),
    leaderboardStatus: document.getElementById('leaderboardStatus'),
};

// === Helpers ===
function getTelegramUserID() {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id
        ? String(window.Telegram.WebApp.initDataUnsafe.user.id)
        : null;
}

function getRefParam() {
    const startParam = new URLSearchParams(window.location.search).get('startapp');
    return startParam?.startsWith('ref_') ? startParam.replace('ref_', '') : null;
}

async function api(action, params = {}) {
    UI.loaderOverlay.style.display = 'flex';
    try {
        const response = await fetch(`/api/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...params, user_id: getTelegramUserID() }),
        });

        const text = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} → ${text}`);
        }

        if (!text.trim()) return { success: false, error: "Empty JSON response" };

        const json = JSON.parse(text);
        if (!json.success) throw new Error(json.error);
        return json;
    } catch (e) {
        showNotif(`Error: ${e.message}`, 'error');
        return { success: false, error: e.message };
    } finally {
        UI.loaderOverlay.style.display = 'none';
    }
}

// === Register User ===
async function registerUser() {
    const userId = getTelegramUserID();
    if (!userId) return;

    const u = window.Telegram?.WebApp?.initDataUnsafe?.user || {};

    await api("register", {
        user_id: userId,
        ref_by: getRefParam(),
        username: u.username || null,
        first_name: u.first_name || null,
        photo_url: u.photo_url || null
    });
}

// === UI Update ===
function updateUI(data) {
    UI.points.textContent = data.points || 0;
    UI.usdt.textContent = (data.usdt || 0).toFixed(2);
    UI.refCount.textContent = data.refs || 0;
    UI.availableUsdt.textContent = (data.usdt || 0).toFixed(2);

    UI.username.textContent = data.username || data.first_name || "User";

    if (data.photo_url) {
        UI.userImg.src = data.photo_url;
        UI.userImg.style.display = 'block';
    } else {
        UI.userImg.style.display = 'none';
    }
}

// === Update Ad Button ===
function updateAdButton(data) {
    const btn = UI.adsBtn;
    if (!btn) return;

    const { ads_watched_today, remaining_cooldown_sec } = data;

    if (ads_watched_today >= DAILY_MAX_ADS) {
        btn.textContent = "Back Tomorrow";
        btn.style.opacity = .5;
        btn.style.pointerEvents = "none";
        return;
    }

    if (remaining_cooldown_sec > 0) {
        btn.textContent = `Wait ${remaining_cooldown_sec}s`;
        btn.style.opacity = .6;
        btn.style.pointerEvents = "none";

        setTimeout(() => getProfile(), remaining_cooldown_sec * 1000 + 300);
        return;
    }

    btn.textContent = "Ads";
    btn.style.opacity = 1;
    btn.style.pointerEvents = "auto";
}

// === Profile ===
async function getProfile() {
    const userId = getTelegramUserID();
    if (!userId) return;

    const response = await api("profile", { user_id: userId });
    if (!response.success) return;

    updateUI(response.data);
    updateAdButton(response.data);
}

// === Watch Ad ===
async function handleAdWatch() {
    const userId = getTelegramUserID();
    if (!userId) return;

    const status = await api("adStatus", { user_id: userId });
    if (!status.success) return showNotif(status.error, 'error');

    const { can_watch, remaining_cooldown_sec } = status.data;
    if (!can_watch) {
        updateAdButton(status.data);
        return showNotif(
            remaining_cooldown_sec > 0
                ? `Wait ${remaining_cooldown_sec}s`
                : "Daily limit reached",
            'error'
        );
    }

    try {
        await window.showGiga();

        const reward = await api("adWatch", { user_id: userId, reward: AD_REWARD });
        if (reward.success) {
            updateUI(reward.data);
            updateAdButton(reward.data);
            return showNotif(`+${AD_REWARD} Points!`, "success");
        }
        showNotif(reward.error, 'error');
    } catch {
        showNotif("Ad cancelled", "error");
    }
}

// === Swap ===
async function handleSwap() {
    const amount = parseInt(UI.pointsInput.value);
    if (!amount || amount <= 0) return showMsg(UI.swapMsg, "Invalid amount", 'error');

    const res = await api("swap", { points_amount: amount });
    if (res.success) {
        updateUI(res.data);
        updateAdButton(res.data);
        UI.pointsInput.value = "";
        calcSwap();
        return showMsg(UI.swapMsg, "Swap completed!", 'success');
    }
    showMsg(UI.swapMsg, res.error, 'error');
}

function calcSwap() {
    const points = parseInt(UI.pointsInput.value) || 0;
    UI.usdtValue.textContent = (points / POINTS_TO_USDT_RATE).toFixed(4) + " USDT";
}

// === Withdraw ===
async function handleWithdraw() {
    const amount = parseFloat(UI.withdrawAmountInput.value);
    const binanceId = UI.binanceIdInput.value.trim();

    if (amount < 0.03) return showMsg(UI.withdrawMsg, "Min 0.03 USDT", 'error');
    if (!binanceId) return showMsg(UI.withdrawMsg, "Enter Binance ID", 'error');

    const res = await api("withdraw", { amount, binance_id: binanceId });
    if (res.success) {
        updateUI(res.data);
        UI.withdrawAmountInput.value = "";
        UI.binanceIdInput.value = "";
        return showMsg(UI.withdrawMsg, "Withdrawal submitted!", 'success');
    }
    showMsg(UI.withdrawMsg, res.error, 'error');
}

// === Leaderboard ===
async function loadLeaderboard() {
    UI.leaderboardStatus.textContent = "Loading...";

    const res = await api("leaderboard");
    if (!res.success) {
        UI.leaderboardStatus.textContent = `Error: ${res.error}`;
        return;
    }

    UI.leaderboardList.innerHTML = "";
    res.data.forEach((u, i) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span>#${i + 1}</span>
            <span>${u.username || u.first_name || 'User'}</span>
            <span>${u.points} Points</span>
        `;
        UI.leaderboardList.appendChild(li);
    });

    UI.leaderboardStatus.textContent = "";
}

// === Navigation ===
function showMsg(el, text, type) {
    el.textContent = text;
    el.className = type;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2500);
}
function showNotif(txt, type) {
    showMsg(UI.notifBar, txt, type);
}

function showPage(id) {
    const pages = [UI.home, UI.task, UI.ledbord, UI.withdraw, UI.swap, UI.refal];
    pages.forEach(p => p.style.display = p.id === id ? "block" : "none");

    if (id === "ledbord") loadLeaderboard();
}

function setupButtons() {
    UI.adsBtn.onclick = handleAdWatch;
    UI.swap.onclick = () => showPage("swap");
    UI.withdraw.onclick = () => showPage("withdraw");
    UI.ledbord.onclick = () => showPage("ledbord");
    UI.refal.onclick = () => showPage("refal");

    document.querySelectorAll(".back-btn").forEach(btn =>
        btn.onclick = () => showPage("home")
    );

    document.getElementById("doWithdraw").onclick = handleWithdraw;
    document.getElementById("doSwap").onclick = handleSwap;
    UI.copyBtn.onclick = copyRefLink;
    UI.pointsInput.oninput = calcSwap;

    showPage("home");
}

// === Copy Ref Link ===
function copyRefLink() {
    const id = getTelegramUserID();
    if (!id) return;
    const link = `https://t.me/${BOT_USERNAME}/earn?startapp=ref_${id}`;

    if (window.Telegram?.WebApp?.setClipboardText) {
        window.Telegram.WebApp.setClipboardText(link);
    } else navigator.clipboard?.writeText(link);

    UI.copyMsg.style.opacity = 1;
    setTimeout(() => UI.copyMsg.style.opacity = 0, 2000);
}

// === Init ===
async function init() {
    await registerUser();
    await getProfile();
    setupButtons();
    calcSwap();
}

if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
}

window.addEventListener("DOMContentLoaded", init);