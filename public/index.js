/**
 * /public/index.js
 * Frontend logic for Telegram WebApp / Web environment.
 * Fetches all necessary constants from the Backend.
 */

// =================================================================
// TON Connect Initialization (REQUIRED AT TOP)
// =================================================================
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: "https://index-html-win-lgtf.vercel.app/tonconnect-manifest.json"
});
window.tonConnectUI = tonConnectUI;

// =================================================================
// 0. Configuration & Global State
// =================================================================
const BOT_USERNAME = 'Game_win_usdtBot'; 
const SUPABASE_API_URL = '/api';

const SWAP_RATE_POINTS = 100000;
const SWAP_RATE_USDT = 0.01;
const DEPOSIT_ADDRESS = "UQABsMMUakTi2iRO5pox4DDR--0J7uqsULYqHDv4Zo3w0E-T";

let GLOBAL_CONSTANTS = {}; // Stores constants fetched from Backend (e.g., DAILY_MAX, COOLDOWN_SEC)
let isProcessingAPI = false; // Global flag for double execution protection

// IDs (Optimized for brevity)
const D = (id) => document.getElementById(id);
const IDS = {
    PAGES: ['home', 'withdraw', 'task', 'addtask', 'swap', 'refal', 'tonwallet'],
    POINTS: D('points'),
    USDT: D('usdt'),
    TON: D('ton'),
    USERNAME: D('username'),
    USER_IMG: D('userImg'),
    LOADER: D('loaderOverlay'),
    NOTIF_BAR: D('notifBar'),
    ADS_BTN: D('adsBtn'),
    TASK_JOIN_BTN: D('taskJoinBtn'),
    TASK_ADS_BTN: D('taskAdsBtn'),
    TASK_ADS_COUNT: D('taskAdsCount'),
    TASK_ADS_TIMER: D('taskAdsTimer'),
    TASK_JOIN_LINK: D('taskJoinLink'),
    TASK_MSG: D('taskMsg'),
    WITHDRAW_AMOUNT: D('withdrawAmount'),
    BINANCE_UID: D('binanceUID'),
    WITHDRAW_MSG: D('withdrawMsg'),
    WITHDRAW_BUTTON: D('withdrawButton'),
    POINTS_INPUT: D('pointsInput'),
    USDT_DISPLAY: D('usdtValueDisplay'),
    CONVERT_BTN: D('convertBtn'),
    SWAP_MSG: D('swapMsg'),
    REF_LINK_DISPLAY: D('refLinkDisplay'),
    COPY_BTN: D('copyBtn'),
    COPY_MSG: D('copyMsg'),
    REF_COUNT: D('refCount'),
    TASK_LINK: D('taskLink'),
    TARGET_USERS_INPUT: D('targetUsers'),
    TOTAL_TON_COST: D('totalTonCost'),
    ADD_TASK_BTN: D('addTonTaskBtn'),
    ADD_TASK_MSG: D('addTaskMsg'),
    USER_OPTION_BTNS: document.querySelectorAll('.user-option-btn'),
    CONNECT_WALLET_BTN: D('connectWallet'),
    DEPOSIT_BTN: D('deposit-btn'),
    WALLET_STATUS: D('walletStatus'),
    WALLET_ADDRESS: D('walletAddress'),
    TON_DEPOSIT_MSG: D('tonDepositMsg'),
};

// =================================================================
// 1. Utility Functions
// =================================================================

/**
 * Gets Telegram User ID.
 */
function getTelegramUserID() {
    try {
        if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
            return String(window.Telegram.WebApp.initDataUnsafe.user.id);
        }
        const savedUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
        return savedUser.id ? String(savedUser.id) : 'default_web_user';
    } catch (e) {
        return 'default_web_user';
    }
}

/**
 * Gets Referral user ID from URL startapp parameter.
 */
function getRefParam() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const startApp = urlParams.get('startapp');
        if (startApp && startApp.startsWith('ref_')) {
            return startApp.replace('ref_', '');
        }
    } catch (e) {
        console.warn("Could not read URL for referral parameter.");
    }
    return null;
}

/**
 * Displays a page and hides others.
 */
function showPage(id) {
    if (!IDS.PAGES.includes(id) && id !== 'home') return;

    document.querySelectorAll('.page, .screen').forEach(el => el.classList.remove('active'));
    D(id)?.classList.add('active');

    const isHome = id === 'home';
    D('userCircle').style.display = isHome ? 'flex' : 'none';
    D('username').style.display = isHome ? 'block' : 'none';
    D('topBalance').style.display = isHome ? 'flex' : 'none';
    
    if (id === 'swap') calcSwap();
    if (id === 'addtask' && !document.querySelector('.user-option-btn.selected')) {
        IDS.USER_OPTION_BTNS[0]?.click();
    }
}

/**
 * Displays status messages.
 */
function showMsg(msgId, text, type, duration = 3000) {
    const box = D(msgId);
    if (box) {
        box.textContent = text;
        box.className = `withdraw-msg ${type}`;
        box.style.opacity = '1';
        setTimeout(() => box.style.opacity = '0', duration);
    }
}

// =================================================================
// 2. API Communication
// =================================================================

/**
 * Sends a request to the serverless API with double execution protection.
 */
async function api(action, params = {}) {
    if (isProcessingAPI) {
        console.warn('API call skipped: Already processing.');
        return { success: false, error: 'Busy: Please wait for the current operation to finish.' };
    }
    
    const userID = getTelegramUserID();
    if (!userID) return { success: false, error: 'User ID missing' };

    isProcessingAPI = true;

    try {
        const response = await fetch(`${SUPABASE_API_URL}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userID, ...params }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.error || `HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (e) {
        console.error(`API call failed for action ${action}:`, e.message);
        showMsg(IDS.NOTIF_BAR.id, `Connection error: ${e.message}`, 'error', 5000);
        return { success: false, error: e.message };
    } finally {
        isProcessingAPI = false;
    }
}

/**
 * Registers user and retrieves constants.
 */
async function registerUser() {
    const refBy = getRefParam();
    const result = await api('registerUser', { ref_by: refBy });
    
    if (result.success) {
        GLOBAL_CONSTANTS = result.data.CONSTANTS || {};
    }
    return result;
}

/**
 * Fetches the user's profile data and constants.
 */
async function getProfile() {
    const result = await api('getProfile');
    if (result.success) {
        GLOBAL_CONSTANTS = result.data.CONSTANTS || {};
        return result.data;
    }
    return null;
}

// =================================================================
// 3. UI Update and State Logic
// =================================================================

/**
 * Updates all displayed values on the screen based on profile data.
 */
function updateUI(data) {
    if (!data) return;

    // Balances
    IDS.POINTS.textContent = (data.points || 0).toLocaleString('en-US');
    IDS.USDT.textContent = parseFloat(data.usdt || 0).toFixed(4);
    IDS.TON.textContent = parseFloat(data.ton || 0).toFixed(4);

    // Refal Page
    IDS.REF_COUNT.textContent = (data.refs || 0);

    // Ad Button Status
    updateAdButton(data.ads_watched_today, data.ads_last_watch);

    // Task Page
    updateTaskUI(data);

    // Referral Link
    const userID = getTelegramUserID();
    const refLink = `https://t.me/${BOT_USERNAME}/earn?startapp=ref_${userID}`;
    IDS.REF_LINK_DISPLAY.textContent = refLink;

    IDS.LOADER.style.display = 'none';
}

/**
 * Updates the state of the main Ads button using backend constants.
 */
function updateAdButton(watched, lastWatch) {
    const { DAILY_MAX, COOLDOWN_SEC } = GLOBAL_CONSTANTS;
    if (!DAILY_MAX || !COOLDOWN_SEC) return;
    
    const now = Date.now();
    IDS.ADS_BTN.style.pointerEvents = 'auto';
    IDS.ADS_BTN.style.opacity = 1;
    IDS.NOTIF_BAR.style.display = 'none';

    if (watched >= DAILY_MAX) {
        IDS.ADS_BTN.style.opacity = 0.4;
        IDS.ADS_BTN.style.pointerEvents = 'none';
        IDS.ADS_BTN.textContent = 'Back Tomorrow';
        IDS.NOTIF_BAR.textContent = `Daily Max of ${DAILY_MAX} Ads Reached.`;
        IDS.NOTIF_BAR.style.display = 'block';
        return;
    }
    
    const timeSinceLast = Math.floor((now - lastWatch) / 1000);
    
    if (timeSinceLast < COOLDOWN_SEC) {
        const remainingTime = COOLDOWN_SEC - timeSinceLast;
        IDS.ADS_BTN.style.pointerEvents = 'none';
        IDS.ADS_BTN.style.opacity = 0.6;
        IDS.ADS_BTN.textContent = `Wait ${remainingTime}s`;
        
        clearTimeout(window.adCooldownTimeout);
        window.adCooldownTimeout = setTimeout(() => {
            getProfile().then(updateUI);
        }, remainingTime * 1000 + 100);
        
        return;
    }

    IDS.ADS_BTN.textContent = 'Watch Ad';
}

/**
 * Updates the task-related UI elements using backend constants and state.
 */
function updateTaskUI(data) {
    const { TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } = GLOBAL_CONSTANTS;
    
    // --- Task 1: Join Telegram (Relies on Backend state) ---
    const joinDone = data.task_join_done === true;
    const TELEGRAM_CHANNEL_LINK = 'https://t.me/+DOmlqes4cedmZTFk'; 
    IDS.TASK_JOIN_LINK.href = TELEGRAM_CHANNEL_LINK;
    IDS.TASK_JOIN_BTN.setAttribute('data-task-type', 'join');
    
    if (joinDone) {
        IDS.TASK_JOIN_BTN.classList.add('task-completed');
        IDS.TASK_JOIN_BTN.textContent = 'Completed';
        IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'done');
        IDS.TASK_JOIN_BTN.style.pointerEvents = 'none';
    } else { 
        IDS.TASK_JOIN_BTN.classList.remove('task-completed');
        // We assume the user has to visit first, then claim. Client-side visit flag is needed.
        const hasVisited = localStorage.getItem('task_join_visited') === 'true';
        
        if (hasVisited) {
            IDS.TASK_JOIN_BTN.textContent = `Claim ${TASK_JOIN_PTS?.toLocaleString() || '10,000'} Points`;
            IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'claim');
        } else {
             IDS.TASK_JOIN_BTN.textContent = 'Go to Channel';
             IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'go');
        }
        IDS.TASK_JOIN_BTN.style.pointerEvents = 'auto';
    }
    
    // --- Task 2: Watch 300 Ads ---
    const adsCount = data.ads_300_count || 0;
    const adsResetTs = data.ads_300_reset || 0;
    const now = Date.now();

    clearInterval(window.taskTimerInterval);
    
    if (adsResetTs > now) {
        // Timer Logic
        IDS.TASK_ADS_BTN.style.display = 'none';
        IDS.TASK_ADS_COUNT.style.display = 'none';
        IDS.TASK_ADS_TIMER.style.display = 'inline';
        
        const updateTimer = () => {
            const remaining = adsResetTs - Date.now();
            if (remaining <= 0) {
                clearInterval(window.taskTimerInterval);
                getProfile().then(updateUI);
                return;
            }
            const totalSeconds = Math.floor(remaining / 1000);
            const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
            const s = String(totalSeconds % 60).padStart(2, '0');
            
            IDS.TASK_ADS_TIMER.textContent = `Resets in: ${h}:${m}:${s}`;
        };
        
        window.taskTimerInterval = setInterval(updateTimer, 1000);
        updateTimer();
        
    } else {
        // Active Logic
        IDS.TASK_ADS_BTN.classList.remove('task-completed');
        IDS.TASK_ADS_BTN.textContent = 'Watch Ad';
        IDS.TASK_ADS_BTN.style.pointerEvents = 'auto';
        IDS.TASK_ADS_BTN.style.display = 'inline';
        IDS.TASK_ADS_COUNT.style.display = 'inline';
        IDS.TASK_ADS_COUNT.textContent = `${adsCount}/${TASK_ADS_COUNT || 300}`;
        IDS.TASK_ADS_TIMER.style.display = 'none';
    }
}

// =================================================================
// 4. Button Handlers
// =================================================================

/** Main Ads Button Handler (Daily) */
async function handleAdWatch() {
    IDS.ADS_BTN.style.pointerEvents = 'none';
    
    try {
        await window.showGiga(); 
        
        const result = await api('adWatch', { task_type: 'daily' });
        
        if (result.success) {
            updateUI(result.data);
            showMsg(IDS.NOTIF_BAR.id, result.message || 'Ad watched successfully.', 'success');
        } else {
            showMsg(IDS.NOTIF_BAR.id, result.error || 'Failed to record ad watch.', 'error');
            getProfile().then(updateUI); // Re-fetch state
        }
    } catch (e) {
        showMsg(IDS.NOTIF_BAR.id, 'Ad failed, try again later.', 'error');
        getProfile().then(updateUI);
    }
}

/** Task Button Handler */
async function handleTask(taskType, action) {
    if (taskType === 'join') {
        if (action === 'go') {
            window.open(IDS.TASK_JOIN_LINK.href, '_blank');
            localStorage.setItem('task_join_visited', 'true');
            updateTaskUI({ task_join_done: false }); 
            showMsg('taskMsg', `Opened channel! Now click 'Claim Points'.`, 'success');
        } else if (action === 'claim') {
            IDS.TASK_JOIN_BTN.style.pointerEvents = 'none';
            const result = await api('taskClaim', { task_type: 'join_channel' });
            
            if (result.success) {
                localStorage.removeItem('task_join_visited');
                updateUI(result.data);
                showMsg('taskMsg', result.message, 'success');
            } else {
                showMsg('taskMsg', result.error || 'Failed to claim task.', 'error');
                IDS.TASK_JOIN_BTN.style.pointerEvents = 'auto';
            }
        }
    } else if (taskType === 'ads300') {
        IDS.TASK_ADS_BTN.style.pointerEvents = 'none';
        
        try {
            await window.showGiga();
            
            const result = await api('adWatch', { task_type: 'ads_300' });
            
            if (result.success) {
                updateUI(result.data);
                showMsg('taskMsg', result.message, 'success', 5000);
            } else {
                showMsg('taskMsg', result.error || 'Failed to record ad watch.', 'error');
                getProfile().then(updateUI);
            }
        } catch (e) {
            showMsg('taskMsg', 'Ad failed, try again later.', 'error');
            getProfile().then(updateUI);
        }
    }
}

/** Swap/Convert Points Handler */
async function handleConvert() {
    const pointsRequested = parseInt(IDS.POINTS_INPUT.value) || 0;
    if (pointsRequested <= 0 || pointsRequested % SWAP_RATE_POINTS !== 0) {
        showMsg('swapMsg', 'Enter a valid amount of points (multiples of 100,000).', 'error');
        return;
    }

    const usdtEarn = (pointsRequested / SWAP_RATE_POINTS) * SWAP_RATE_USDT;
    IDS.CONVERT_BTN.style.pointerEvents = 'none';
    
    const result = await api('swap', { points_amount: pointsRequested, usdt_amount: usdtEarn });

    if (result.success) {
        updateUI(result.data);
        showMsg('swapMsg', `Success! Exchanged ${pointsRequested.toLocaleString()} Points for ${usdtEarn.toFixed(4)} USDT.`, 'success');
        IDS.POINTS_INPUT.value = '';
        calcSwap();
    } else {
        showMsg('swapMsg', result.error || 'Conversion failed.', 'error');
    }
    IDS.CONVERT_BTN.style.pointerEvents = 'auto';
}

/** Withdraw Handler */
async function handleWithdraw() {
    const amount = parseFloat(IDS.WITHDRAW_AMOUNT.value);
    const uid = IDS.BINANCE_UID.value.trim();
    
    if (isNaN(amount) || amount < 0.03) {
        showMsg('withdrawMsg', 'Minimum withdrawal is 0.03 USDT.', 'error');
        return;
    }
    if (!/^\d{8,10}$/.test(uid)) {
        showMsg('withdrawMsg', 'Please enter a valid 8-10 digit Binance Pay ID/UID.', 'error');
        return;
    }

    IDS.WITHDRAW_BUTTON.style.pointerEvents = 'none';

    const result = await api('withdraw', { amount: amount, binance_uid: uid });
    
    if (result.success) {
        updateUI(result.data);
        IDS.WITHDRAW_AMOUNT.value = '';
        showMsg('withdrawMsg', `Success! ${amount.toFixed(2)} USDT sent to Binance ID: ${uid}.`, 'success', 5000);
    } else {
        showMsg('withdrawMsg', result.error || 'Withdrawal failed.', 'error');
    }
    IDS.WITHDRAW_BUTTON.style.pointerEvents = 'auto';
}

/** Calculate Swap Display */
function calcSwap() {
    const pts = parseInt(IDS.POINTS_INPUT.value) || 0;
    const usdtEarn = (pts / SWAP_RATE_POINTS) * SWAP_RATE_USDT;
    IDS.USDT_DISPLAY.textContent = usdtEarn.toFixed(4);
}

/** Add TON Task Handler (Simulated) */
async function handleAddTonTask() {
    const link = IDS.TASK_LINK.value.trim();
    const users = parseInt(IDS.TARGET_USERS_INPUT.value) || 100;
    const cost = parseFloat(IDS.TOTAL_TON_COST.textContent) || 0;

    if (!/^https?:\/\/t\.me\//i.test(link)) {
        showMsg('addTaskMsg', 'Please enter a valid Telegram channel or bot link (t.me/...).', 'error');
        return;
    }
    if (cost <= 0) {
        showMsg('addTaskMsg', 'Invalid TON cost.', 'error');
        return;
    }

    IDS.ADD_TASK_BTN.style.pointerEvents = 'none';

    const result = await api('addTonTask', { link, users, cost });

    if (result.success) {
        IDS.TASK_LINK.value = '';
        updateUI(result.data);
        showMsg('addTaskMsg', `Task created! Paid ${cost.toFixed(2)} TON for ${users} users.`, 'success', 5000);
    } else {
        showMsg('addTaskMsg', result.error || 'Failed to create task.', 'error');
    }
    IDS.ADD_TASK_BTN.style.pointerEvents = 'auto';
}

/** Copy Referral Link Handler */
function copyRefLink() {
    const link = IDS.REF_LINK_DISPLAY.textContent;
    if (navigator.clipboard && link) {
        navigator.clipboard.writeText(link).then(() => {
            IDS.COPY_MSG.style.opacity = '1';
            setTimeout(() => IDS.COPY_MSG.style.opacity = '0', 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    }
}

// ... [TON Wallet Handlers remain unchanged: updateTONWalletUI, handleTONConnect, handleTONDeposit] ...

// =================================================================
// 5. Setup and Initialization
// =================================================================

/**
 * Attaches event listeners to all interactive elements.
 */
function setupButtons() {
    // Page Navigation
    document.querySelectorAll('.btn[data-page-target], .back[data-page-target], button[data-page-target]').forEach(btn => {
        btn.addEventListener('click', (e) => showPage(e.currentTarget.getAttribute('data-page-target')));
    });

    // Core Actions
    IDS.ADS_BTN.addEventListener('click', handleAdWatch);
    IDS.WITHDRAW_BUTTON.addEventListener('click', handleWithdraw);
    IDS.CONVERT_BTN.addEventListener('click', handleConvert);
    IDS.COPY_BTN.addEventListener('click', copyRefLink);
    IDS.ADD_TASK_BTN.addEventListener('click', handleAddTonTask);
    
    // Task Buttons
    IDS.TASK_JOIN_BTN.addEventListener('click', (e) => {
        handleTask('join', e.currentTarget.getAttribute('data-task-action'));
    });
    IDS.TASK_ADS_BTN.addEventListener('click', () => handleTask('ads300'));

    // Input Handlers
    IDS.POINTS_INPUT.addEventListener('input', calcSwap);

    // Add Task Selection
    IDS.USER_OPTION_BTNS.forEach(btn => {
        btn.addEventListener('click', (e) => selectUsers(e.currentTarget));
    });

    // TON Connect Handlers
    tonConnectUI.onStatusChange(updateTONWalletUI);
    IDS.CONNECT_WALLET_BTN.addEventListener('click', handleTONConnect);
    IDS.DEPOSIT_BTN.addEventListener('click', handleTONDeposit);
}

/**
 * The main initialization function.
 */
async function init() {
    IDS.LOADER.style.display = 'flex';
    setupButtons();
    updateTONWalletUI(tonConnectUI.wallet);

    const regResult = await registerUser();
    let profile = regResult.success ? regResult.data : null;

    if (!profile) {
        profile = await getProfile();
    }

    if (profile) {
        updateUI(profile);
        // Load user info for display
        if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
            const user = window.Telegram.WebApp.initDataUnsafe.user;
            IDS.USERNAME.textContent = user.first_name || user.username || 'User';
            if (user.photo_url) IDS.USER_IMG.src = user.photo_url;
            localStorage.setItem('telegramUser', JSON.stringify({ id: getTelegramUserID(), first_name: user.first_name, username: user.username, photo_url: user.photo_url }));
        } else {
            const savedUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
            IDS.USERNAME.textContent = savedUser.first_name || savedUser.username || 'Web User';
            if (savedUser.photo_url) IDS.USER_IMG.src = savedUser.photo_url;
        }
    } else {
        IDS.LOADER.querySelector('.loader-text').textContent = "Failed to load profile data. Check Supabase connection.";
    }
    
    showPage('home'); 
}

// Start the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', init);


// --- TON Wallet Handlers (from original code, appended here for completeness) ---

function updateTONWalletUI(wallet) {
    // ... (unchanged implementation) ...
}

async function handleTONConnect() {
    // ... (unchanged implementation) ...
}

async function handleTONDeposit() {
    // ... (unchanged implementation) ...
}
function selectUsers(button) {
    const TON_TASK_RATE_USERS = 100;
    const TON_TASK_COST_PER_RATE = 0.1;
    
    IDS.USER_OPTION_BTNS.forEach(btn => btn.classList.remove('selected'));
    
    button.classList.add('selected');
    
    const selectedUsers = parseInt(button.getAttribute('data-users'));
    IDS.TARGET_USERS_INPUT.value = selectedUsers;
    
    const rateMultiplier = selectedUsers / TON_TASK_RATE_USERS;
    const cost = rateMultiplier * TON_TASK_COST_PER_RATE;
    IDS.TOTAL_TON_COST.textContent = cost.toFixed(2);
}
