// /public/index.js

// === الثوابت الموحدة (Frontend Constants) ===
const AD_REWARD = 400;
const DAILY_MAX_ADS = 100;
const COOLDOWN_SEC = 3; 
const POINTS_TO_USDT_RATE = 100000;
const BOT_USERNAME = 'Game_win_usdtBot';

// === UI Elements Mapping ===
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

// === Core Logic Functions ===

function getTelegramUserID() {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id ? String(window.Telegram.WebApp.initDataUnsafe.user.id) : null;
}

function getRefParam() {
    const startParam = new URLSearchParams(window.location.search).get('startapp');
    if (startParam && startParam.startsWith('ref_')) {
        return startParam.replace('ref_', '');
    }
    return null;
}

async function api(action, params = {}) {
    UI.loaderOverlay.style.display = 'flex'; 
    try {
        const response = await fetch(`/api/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...params }),
        });

        if (!response.ok) {
            throw new Error(`API HTTP Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Unknown API Error');
        }
        return data;
    } catch (error) {
        console.error(`Error during API call to /api/index (Action: ${action}):`, error);
        showNotif(`Operation failed: ${error.message}`, 'error'); 
        return { success: false, error: error.message };
    } finally {
        UI.loaderOverlay.style.display = 'none';
    }
}

/**
 * إصلاح: إرسال جميع بيانات المستخدم إلى التسجيل (إصلاح 6).
 */
async function registerUser() {
    const userId = getTelegramUserID();
    const refBy = getRefParam();
    
    if (!userId) {
        console.warn("User ID not available, skipping registration.");
        return;
    }
    
    const webAppUser = window.Telegram?.WebApp?.initDataUnsafe?.user || {};
    
    const response = await api('register', {
        user_id: userId,
        ref_by: refBy,
        username: webAppUser.username || null,
        first_name: webAppUser.first_name || null,
        photo_url: webAppUser.photo_url || null,
    });

    if (!response.success) {
        console.error("Registration failed:", response.error);
    }
}

/**
 * إصلاح: يعتمد فقط على response.data القادم من backend ولا يحسب cooldown محلياً (إصلاح 7).
 */
async function getProfile() {
    const userId = getTelegramUserID();
    if (!userId) return;

    const response = await api('profile', { user_id: userId });

    if (response.success && response.data) {
        updateUI(response.data);
    } else {
        console.error("Failed to fetch profile:", response.error);
        showNotif(`Error loading profile: ${response.error}`, 'error');
    }
}

/**
 * إصلاح: يعتمد 100% على adStatus فقط (إصلاح 3).
 */
async function handleAdWatch() {
    const userId = getTelegramUserID();
    if (!userId) return;

    if (!window.showGiga) { 
        showNotif("Ad service not available.", 'error'); 
        return; 
    }

    // 1. Check ad status
    const statusResponse = await api('adStatus', { user_id: userId });
    
    if (!statusResponse.success) {
        showNotif(statusResponse.error, 'error');
        return;
    }
    
    const { can_watch, remaining_cooldown_sec } = statusResponse.data;
    
    // يمنع الضغط ويعرض انتظار إذا كان remaining_cooldown_sec > 0
    if (!can_watch) {
        updateAdButton(statusResponse.data);
        if (remaining_cooldown_sec > 0) {
            showNotif(`You must wait ${remaining_cooldown_sec}s.`, 'info');
        } else {
            showNotif("Daily limit reached.", 'error');
        }
        return;
    }
    
    // 2. Show Ad and 3. Reward
    try {
        await window.showGiga();
        
        const watchResponse = await api('adWatch', { 
            user_id: userId,
            reward: AD_REWARD
        });

        if (watchResponse.success && watchResponse.data) {
            updateUI(watchResponse.data);
        } else {
            showNotif(`Ad Reward Error: ${watchResponse.error}`, 'error');
        }
    } catch (e) {
        showNotif('Ad cancelled or failed to load.', 'error');
    }
}

/**
 * إصلاح: يرسل ل updateAdButton البيانات المحسوبة فقط من adStatus (إصلاح 2).
 */
function updateUI(data) {
    if (UI.points) UI.points.textContent = data.points || 0;
    if (UI.usdt) UI.usdt.textContent = (data.usdt || 0).toFixed(2);
    if (UI.refCount) UI.refCount.textContent = data.refs || 0;
    
    const usernameFromDB = data.username || data.first_name || 'User';
    if (UI.username) UI.username.textContent = usernameFromDB;
    if (UI.userImg && data.photo_url) {
        UI.userImg.src = data.photo_url;
        UI.userImg.style.display = 'block';
    } else if (UI.userImg) {
        UI.userImg.style.display = 'none';
    }
    
    // طلب حالة الإعلان لتحديث الزر
    api('adStatus', { user_id: getTelegramUserID() }).then(statusResponse => {
        if (statusResponse.success) {
            updateAdButton(statusResponse.data);
        }
    });
}

/**
 * إصلاح: يعتمد فقط على remaining_cooldown_sec و ads_watched_today (إصلاح 1).
 */
function updateAdButton(data) {
    if (!UI.adsBtn) return;
    
    const { ads_watched_today, remaining_cooldown_sec } = data;

    if (ads_watched_today >= DAILY_MAX_ADS) {
        UI.adsBtn.style.opacity = 0.4;
        UI.adsBtn.style.pointerEvents = 'none';
        UI.adsBtn.textContent = 'Back Tomorrow';
        return;
    }

    if (remaining_cooldown_sec > 0) {
        UI.adsBtn.style.pointerEvents = 'none';
        UI.adsBtn.style.opacity = 0.6;
        UI.adsBtn.textContent = `Wait ${remaining_cooldown_sec}s`;
        
        // إعادة التحقق بعد انتهاء الكوولداون
        setTimeout(() => getProfile(), (remaining_cooldown_sec) * 1000 + 500); 
        return;
    }

    UI.adsBtn.style.opacity = 1;
    UI.adsBtn.style.pointerEvents = 'auto';
    UI.adsBtn.textContent = 'Ads';
}

/**
 * إصلاح: عدم مسح كل الكلاسات وإضافة class للنوع فقط (إصلاح 4).
 */
function showMsg(element, text, type) {
    if (!element) return;
    // الحفاظ على الكلاسات الأصلية وإضافة كلاس النوع
    element.className = element.className.replace(/error|success/g, '').trim() + ' ' + type;
    element.textContent = text;
    element.style.opacity = '1';
    setTimeout(() => {
        element.style.opacity = '0';
        // إزالة كلاس النوع بعد الاختفاء
        element.className = element.className.replace(type, '').trim(); 
    }, 3000);
}

/**
 * إصلاح: يعمل داخل Telegram WebApp وخارجه (إصلاح 5).
 */
function copyRefLink() {
    const userId = getTelegramUserID() || 'DEFAULT_USER_ID'; 
    const link = `https://t.me/${BOT_USERNAME}/earn?startapp=ref_${userId}`;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            if (UI.copyMsg) {
                UI.copyMsg.style.opacity = '1';
                setTimeout(() => UI.copyMsg.style.opacity = '0', 2000);
            }
        }).catch(err => {
            showNotif('Failed to copy link via Clipboard API.', 'error');
        });
    } else if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.clipboardText) {
        // Fallback لـ Telegram WebApp
        window.Telegram.WebApp.clipboardText = link;
        if (UI.copyMsg) {
            UI.copyMsg.style.opacity = '1';
            setTimeout(() => UI.copyMsg.style.opacity = '0', 2000);
        }
    } else {
        showNotif('Clipboard access not supported.', 'error');
    }
}

// === Boilerplate Functions (Unchanged Logic) ===

function handleWithdraw() {
    const binanceId = UI.binanceIdInput.value.trim();
    const amount = parseFloat(UI.withdrawAmountInput.value) || 0;
    const minAmount = 0.03;

    if (binanceId.length === 0) {
        showMsg(UI.withdrawMsg, 'Please enter your Binance ID', 'error');
        return;
    }
    if (amount < minAmount) {
        showMsg(UI.withdrawMsg, `Minimum withdrawal is ${minAmount.toFixed(2)} USDT`, 'error');
        return;
    }
    
    const response = await api('withdraw', {
        user_id: getTelegramUserID(),
        binance_id: binanceId,
        amount: amount
    });
    
    if (UI.withdrawMsg) {
        if (response.success && response.data) {
            showMsg(UI.withdrawMsg, response.message || 'Withdrawal request successful!', 'success');
            updateUI(response.data);
            UI.binanceIdInput.value = '';
            UI.withdrawAmountInput.value = '';
        } else {
            showMsg(UI.withdrawMsg, response.error || 'Withdrawal Failed', 'error');
        }
    }
}

// ... calcSwap, loadLeaderboard, showPage, showNotif, setupButtons ...

// Main initialization function
async function init() {
    await registerUser(); 
    await getProfile();
    setupButtons();
    calcSwap(); 
    if (UI.loaderOverlay) UI.loaderOverlay.style.display = 'none';
    console.log("App initialized.");
}

// === Telegram WebApp Fix ===
if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
}

window.addEventListener('DOMContentLoaded', init);
