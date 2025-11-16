/**
 * /public/index.js
 * Frontend logic for Telegram WebApp / Web environment.
 * Handles UI interactions, state management (localStorage for simplicity),
 * and communication with the /api/index.js backend.
 */

// =================================================================
// TON Connect Initialization (REQUIRED AT TOP)
// =================================================================
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: "https://index-html-win-lgtf.vercel.app/tonconnect-manifest.json"
});
window.tonConnectUI = tonConnectUI;

// =================================================================
// 0. Configuration & Constants
// =================================================================
const BOT_USERNAME = 'Game_win_usdtBot'; // من ملف ENV
const SUPABASE_API_URL = '/api';

const SWAP_RATE_POINTS = 100000;
const SWAP_RATE_USDT = 0.01;

// TON Deposit Address
const DEPOSIT_ADDRESS = "UQABsMMUakTi2iRO5pox4DDR--0J7uqsULYqHDv4Zo3w0E-T";


// IDs
const D = (id) => document.getElementById(id);
const IDS = {
    // Pages
    PAGES: ['home', 'withdraw', 'task', 'addtask', 'swap', 'refal', 'tonwallet'],
    // Balances & User Info
    POINTS: D('points'),
    USDT: D('usdt'),
    TON: D('ton'),
    USERNAME: D('username'),
    USER_IMG: D('userImg'),
    // UI Elements
    LOADER: D('loaderOverlay'),
    NOTIF_BAR: D('notifBar'),
    // Home Buttons
    ADS_BTN: D('adsBtn'),
    // Task Page
    TASK_JOIN_BTN: D('taskJoinBtn'),
    TASK_ADS_BTN: D('taskAdsBtn'),
    TASK_ADS_COUNT: D('taskAdsCount'),
    TASK_ADS_TIMER: D('taskAdsTimer'),
    TASK_JOIN_LINK: D('taskJoinLink'),
    TASK_MSG: D('taskMsg'),
    // Withdraw Page
    WITHDRAW_AMOUNT: D('withdrawAmount'),
    BINANCE_UID: D('binanceUID'),
    WITHDRAW_MSG: D('withdrawMsg'),
    WITHDRAW_BUTTON: D('withdrawButton'),
    // Swap Page
    POINTS_INPUT: D('pointsInput'),
    USDT_DISPLAY: D('usdtValueDisplay'),
    CONVERT_BTN: D('convertBtn'),
    SWAP_MSG: D('swapMsg'),
    // Refal Page
    REF_LINK_DISPLAY: D('refLinkDisplay'),
    COPY_BTN: D('copyBtn'),
    COPY_MSG: D('copyMsg'),
    REF_COUNT: D('refCount'),
    // Add Task Page (TON)
    TASK_LINK: D('taskLink'),
    TARGET_USERS_INPUT: D('targetUsers'),
    TOTAL_TON_COST: D('totalTonCost'),
    ADD_TASK_BTN: D('addTonTaskBtn'),
    ADD_TASK_MSG: D('addTaskMsg'),
    USER_OPTION_BTNS: document.querySelectorAll('.user-option-btn'),
    // TON Wallet Page
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
 * @returns {string | null} Telegram user ID from WebApp or localStorage.
 */
function getTelegramUserID() {
    let userID = null;
    try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
            userID = String(window.Telegram.WebApp.initDataUnsafe.user.id);
        } else {
            // Fallback for non-Telegram environment/testing
            const savedUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
            userID = savedUser.id ? String(savedUser.id) : 'default_web_user';
        }
    } catch (e) {
        console.error("Error getting Telegram User ID:", e);
        userID = 'default_web_user';
    }
    return userID;
}

/**
 * @returns {string | null} Referral user ID from URL startapp parameter.
 */
function getRefParam() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const startApp = urlParams.get('startapp');
        if (startApp && startApp.startsWith('ref_')) {
            return startApp.replace('ref_', '');
        }
    } catch (e) {
        console.warn("Could not read URL for referral parameter.", e);
    }
    return null;
}

/**
 * Displays a page and hides others.
 * @param {string} id - The ID of the page to show.
 */
function showPage(id) {
    if (!IDS.PAGES.includes(id) && id !== 'home') return;

    document.querySelectorAll('.page, .screen').forEach(el => el.classList.remove('active'));
    
    const pageEl = D(id);
    if (pageEl) {
        pageEl.classList.add('active');
    }

    // Toggle balance/user info visibility
    const isHome = id === 'home';
    D('userCircle').style.display = isHome ? 'flex' : 'none';
    D('username').style.display = isHome ? 'block' : 'none';
    D('topBalance').style.display = isHome ? 'flex' : 'none';
    
    // Specific page logic that requires immediate update
    if (id === 'swap') {
        calcSwap();
    } else if (id === 'addtask') {
        IDS.USER_OPTION_BTNS[0]?.click(); // Select default 100 users
    }
}

/**
 * Generic function to display status messages.
 * @param {string} msgId - The ID of the message element (e.g., 'withdrawMsg').
 * @param {string} text - The message text.
 * @param {'success'|'error'} type - The message type.
 * @param {number} duration - Duration in ms.
 */
function showMsg(msgId, text, type, duration = 3000) {
    const box = D(msgId);
    if (box) {
        box.textContent = text;
        box.className = `withdraw-msg ${type}`; // Using shared class structure
        box.style.opacity = '1';
        setTimeout(() => box.style.opacity = '0', duration);
    }
}

// =================================================================
// 2. API Communication
// =================================================================

/**
 * Sends a request to the serverless API.
 * @param {string} action - The API endpoint action (e.g., 'registerUser', 'getProfile').
 * @param {Object} params - The request body parameters.
 * @returns {Promise<Object>} The API response data.
 */
async function api(action, params = {}) {
    const userID = getTelegramUserID();
    if (!userID) {
        console.error("API call failed: User ID is required.");
        return { success: false, error: 'User ID missing' };
    }

    try {
        const response = await fetch(`${SUPABASE_API_URL}/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id: userID, ...params }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (e) {
        console.error(`API call failed for action ${action}:`, e);
        showMsg('taskMsg', `Connection error: ${action} failed.`, 'error', 5000);
        return { success: false, error: e.message };
    }
}

/**
 * Registers a new user or updates the profile if needed.
 */
async function registerUser() {
    const refBy = getRefParam();
    const result = await api('registerUser', { ref_by: refBy });
    
    if (result.success && window.Telegram && window.Telegram.WebApp) {
        console.log("User registered/profile confirmed.");
    } else if (result.error) {
        console.error("Registration/Update failed:", result.error);
    }
}

/**
 * Fetches the user's profile data.
 * @returns {Promise<Object>} Profile data or null.
 */
async function getProfile() {
    const result = await api('getProfile');
    if (result.success) {
        return result.data;
    }
    return null;
}

// =================================================================
// 3. UI Update and State Logic
// =================================================================

/**
 * Updates all displayed values on the screen based on profile data.
 * @param {Object} data - User profile data from the API.
 */
function updateUI(data) {
    if (!data) return;

    // Balances
    IDS.POINTS.textContent = (data.points || 0).toLocaleString('en-US');
    IDS.USDT.textContent = (data.usdt || 0).toFixed(4);
    IDS.TON.textContent = (data.ton || 0).toFixed(4);

    // Refal Page
    IDS.REF_COUNT.textContent = (data.refs || 0);

    // Ad Button Status (using ads_watched_today and ads_date for check)
    const { ads_watched_today: watched, ads_last_watch: lastWatch, ads_date: lastDate } = data;
    updateAdButton(watched, lastWatch, lastDate);

    // Task Page
    updateTaskUI(data);

    // Referral Link
    const userID = getTelegramUserID();
    const refLink = `https://t.me/${BOT_USERNAME}/earn?startapp=ref_${userID}`;
    IDS.REF_LINK_DISPLAY.textContent = refLink;

    // Hide loader
    IDS.LOADER.style.display = 'none';
}

/**
 * Updates the state of the main Ads button.
 * @param {number} watched - Ads watched today.
 * @param {number} lastWatch - Timestamp of last watch.
 * @param {string} lastDate - Date of last watch for reset check.
 */
async function updateAdButton(watched, lastWatch, lastDate) {
    const DAILY_MAX = 100;
    const COOLDOWN_SEC = 3;
    const now = Date.now();
    
    // Check for daily reset (This logic should ideally be confirmed by the server's 'ads_date')
    const today = new Date().toDateString();
    let isResetNeeded = lastDate !== today;
    
    if (isResetNeeded) {
        watched = 0;
        // NOTE: The API call 'adStatus' should handle the reset if needed. 
    }

    const remain = DAILY_MAX - watched;
    const timeSinceLast = Math.floor((now - lastWatch) / 1000);
    
    IDS.ADS_BTN.style.opacity = 1;
    IDS.ADS_BTN.style.pointerEvents = 'auto';

    if (remain <= 0) {
        IDS.ADS_BTN.style.opacity = 0.4;
        IDS.ADS_BTN.style.pointerEvents = 'none';
        IDS.ADS_BTN.textContent = 'Back Tomorrow';
        IDS.NOTIF_BAR.style.display = 'block';
        return;
    }
    
    if (timeSinceLast < COOLDOWN_SEC) {
        IDS.ADS_BTN.style.pointerEvents = 'none';
        IDS.ADS_BTN.style.opacity = 0.6;
        IDS.ADS_BTN.textContent = `Wait ${COOLDOWN_SEC - timeSinceLast}s`;
        setTimeout(() => getProfile().then(updateUI), 1000); // Re-check after 1s
        return;
    }

    IDS.ADS_BTN.textContent = 'Ads';
    IDS.NOTIF_BAR.style.display = 'none';
}

/**
 * Updates the task-related UI elements.
 * @param {Object} data - User profile data from the API.
 */
function updateTaskUI(data) {
    // Task 1: Join Telegram (using localStorage for UI state as per original HTML JS)
    const JOIN_TASK_KEY = 'task_join_done';
    const JOIN_VISIT_KEY = 'task_join_visited';
    const joinDone = localStorage.getItem(JOIN_TASK_KEY) === 'true';
    const joinVisited = localStorage.getItem(JOIN_VISIT_KEY) === 'true'; 
    
    const TELEGRAM_CHANNEL_LINK = 'https://t.me/+DOmlqes4cedmZTFk'; 
    IDS.TASK_JOIN_LINK.href = TELEGRAM_CHANNEL_LINK;
    IDS.TASK_JOIN_BTN.setAttribute('data-task-type', 'join');

    if (joinDone) {
        IDS.TASK_JOIN_BTN.classList.add('task-completed');
        IDS.TASK_JOIN_BTN.textContent = 'Completed';
        IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'done');
    } else if (joinVisited) { 
        IDS.TASK_JOIN_BTN.classList.remove('task-completed');
        IDS.TASK_JOIN_BTN.textContent = 'Claim Points';
        IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'claim');
    } else { 
        IDS.TASK_JOIN_BTN.classList.remove('task-completed');
        IDS.TASK_JOIN_BTN.textContent = 'Go to Channel';
        IDS.TASK_JOIN_BTN.setAttribute('data-task-action', 'go');
    }
    
    // Task 2: Watch 300 Ads (using API data)
    const TASK_ADS_COUNT = 300;
    const adsCount = data.ads_300_count || 0;
    const adsResetTs = data.ads_300_reset || 0;
    const now = Date.now();

    if (adsResetTs && now < adsResetTs) {
        // Timer Logic
        IDS.TASK_ADS_BTN.style.display = 'none';
        IDS.TASK_ADS_COUNT.style.display = 'none';
        IDS.TASK_ADS_TIMER.style.display = 'inline';
        
        const updateTimer = () => {
            const remaining = adsResetTs - Date.now();
            if (remaining <= 0) {
                clearInterval(window.taskTimerInterval);
                getProfile().then(updateUI); // Force UI update to show button
                return;
            }
            const totalSeconds = Math.floor(remaining / 1000);
            const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
            const s = String(totalSeconds % 60).padStart(2, '0');
            
            IDS.TASK_ADS_TIMER.textContent = `Resets in: ${h}:${m}:${s}`;
        };
        
        clearInterval(window.taskTimerInterval);
        window.taskTimerInterval = setInterval(updateTimer, 1000);
        updateTimer();
        
    } else if (adsCount >= TASK_ADS_COUNT) {
        // Completed Logic (but past reset time, so wait for timer to clear or server to reset)
        IDS.TASK_ADS_BTN.classList.add('task-completed');
        IDS.TASK_ADS_BTN.textContent = 'Claimed';
        IDS.TASK_ADS_BTN.style.pointerEvents = 'none';
        IDS.TASK_ADS_COUNT.textContent = `${TASK_ADS_COUNT}/${TASK_ADS_COUNT}`;
        IDS.TASK_ADS_TIMER.style.display = 'none';
    } else {
        // Active Logic
        clearInterval(window.taskTimerInterval);
        IDS.TASK_ADS_BTN.classList.remove('task-completed');
        IDS.TASK_ADS_BTN.textContent = 'Watch Ad';
        IDS.TASK_ADS_BTN.style.pointerEvents = 'auto';
        IDS.TASK_ADS_BTN.style.display = 'inline';
        IDS.TASK_ADS_COUNT.style.display = 'inline';
        IDS.TASK_ADS_COUNT.textContent = `${adsCount}/${TASK_ADS_COUNT}`;
        IDS.TASK_ADS_TIMER.style.display = 'none';
    }
}

// =================================================================
// 4. Button Handlers
// =================================================================

/** Main Ads Button Handler */
async function handleAdWatch() {
    try {
        await window.showGiga(); // GigaPub Ad Call
        
        const result = await api('adWatch', { task_type: 'daily' });
        
        if (result.success) {
            getProfile().then(updateUI);
        } else {
            showMsg('taskMsg', result.error || 'Failed to record ad watch.', 'error');
        }
    } catch (e) {
        console.warn('Ad error (Home Ads):', e);
    }
}

/** Task Button Handler */
async function handleTask(taskType, action) {
    if (taskType === 'join') {
        const JOIN_TASK_KEY = 'task_join_done';
        const JOIN_VISIT_KEY = 'task_join_visited';
        const TASK_JOIN_PTS = 10000;
        
        if (action === 'go') {
            const link = IDS.TASK_JOIN_LINK.href;
            if (link) window.open(link, '_blank');
            localStorage.setItem(JOIN_VISIT_KEY, 'true');
            updateTaskUI();
            showMsg('taskMsg', `Opened channel! Now click 'Claim Points'.`, 'success');
        } else if (action === 'claim') {
            const result = await api('taskClaim', { task_type: 'join_channel', points: TASK_JOIN_PTS });
            if (result.success) {
                localStorage.setItem(JOIN_TASK_KEY, 'true');
                localStorage.removeItem(JOIN_VISIT_KEY);
                getProfile().then(updateUI);
                showMsg('taskMsg', `✅ Earned ${TASK_JOIN_PTS.toLocaleString()} Points!`, 'success');
            } else {
                showMsg('taskMsg', result.error || 'Failed to claim task.', 'error');
            }
        }
    } else if (taskType === 'ads300') {
        const TASK_ADS_USDT = 0.015;
        try {
            await window.showGiga();
            
            const result = await api('adWatch', { task_type: 'ads_300' });
            
            if (result.success) {
                const newCount = result.data.ads_300_count;
                if (newCount >= 300) {
                    showMsg('taskMsg', `🎉 Task Completed! Earned ${TASK_ADS_USDT} USDT. Resets in 24 hours.`, 'success');
                } else {
                    showMsg('taskMsg', `Ad watched! ${newCount}/300`, 'success');
                }
                getProfile().then(updateUI);
            } else {
                showMsg('taskMsg', result.error || 'Failed to record ad watch.', 'error');
            }
        } catch (e) {
            console.warn('Task Ad error:', e);
            showMsg('taskMsg', 'Ad failed, try again later.', 'error');
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

    const result = await api('swap', { points_amount: pointsRequested, usdt_amount: usdtEarn });

    if (result.success) {
        getProfile().then(updateUI);
        showMsg('swapMsg', `Success! Exchanged ${pointsRequested.toLocaleString()} Points for ${usdtEarn.toFixed(4)} USDT.`, 'success');
        IDS.POINTS_INPUT.value = '';
        calcSwap();
    } else {
        showMsg('swapMsg', result.error || 'Conversion failed.', 'error');
    }
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

    // NOTE: In a real app, this should go to a dedicated withdrawal API endpoint, 
    // but here we simulate the balance update and show success message.
    const result = await api('withdraw', { amount: amount, binance_uid: uid });
    
    if (result.success) {
        getProfile().then(updateUI);
        IDS.WITHDRAW_AMOUNT.value = '';
        showMsg('withdrawMsg', `Success! ${amount.toFixed(2)} USDT sent to Binance ID: ${uid}.`, 'success');
    } else {
        showMsg('withdrawMsg', result.error || 'Withdrawal failed.', 'error');
    }
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

/** Calculate Swap Display */
function calcSwap() {
    const pts = parseInt(IDS.POINTS_INPUT.value) || 0;
    const usdtEarn = (pts / SWAP_RATE_POINTS) * SWAP_RATE_USDT;
    IDS.USDT_DISPLAY.textContent = usdtEarn.toFixed(4);
}

/** Add TON Task Handler (Simulated) */
function handleAddTonTask() {
    const link = IDS.TASK_LINK.value.trim();
    const users = parseInt(IDS.TARGET_USERS_INPUT.value) || 100;
    const cost = parseFloat(IDS.TOTAL_TON_COST.textContent) || 0;

    if (!/^https?:\/\/t\.me\//i.test(link)) {
        showMsg('addTaskMsg', 'Please enter a valid Telegram channel or bot link (t.me/...).', 'error');
        return;
    }

    // NOTE: This should interact with TON Connect for payment, 
    // but here we only simulate the TON balance check/update.
    const result = api('addTonTask', { link, users, cost });

    if (result.success) {
        IDS.TASK_LINK.value = '';
        getProfile().then(updateUI);
        showMsg('addTaskMsg', `Task created! Paid ${cost.toFixed(2)} TON for ${users} users.`, 'success');
    } else {
        showMsg('addTaskMsg', result.error || 'Failed to create task.', 'error');
    }
}

/** TON Task Users Selection */
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

/**
 * Updates TON Wallet UI state based on TonConnect status.
 */
function updateTONWalletUI(wallet) {
    if (wallet && wallet.account) {
        const rawAddress = wallet.account.address;
        const shortAddress = rawAddress.slice(0, 6) + '...' + rawAddress.slice(-4);
        
        IDS.WALLET_STATUS.textContent = `Connected: ${wallet.device.appName}`;
        IDS.WALLET_ADDRESS.textContent = `Address: ${rawAddress}`;
        IDS.WALLET_ADDRESS.style.display = 'block';
        IDS.CONNECT_WALLET_BTN.textContent = 'Disconnect Wallet';
        showMsg(IDS.TON_DEPOSIT_MSG.id, `Wallet ${shortAddress} Connected!`, 'success');
    } else {
        IDS.WALLET_STATUS.textContent = 'Disconnected';
        IDS.WALLET_ADDRESS.style.display = 'none';
        IDS.WALLET_ADDRESS.textContent = '';
        IDS.CONNECT_WALLET_BTN.textContent = 'Connect Wallet';
        showMsg(IDS.TON_DEPOSIT_MSG.id, 'Wallet Disconnected', 'error');
    }
}

/**
 * Handles connecting and disconnecting the TON Wallet.
 */
async function handleTONConnect() {
    if (tonConnectUI.connected) {
        await tonConnectUI.disconnect();
    } else {
        await tonConnectUI.connectWallet();
    }
}

/**
 * Handles sending a real TON deposit transaction.
 */
async function handleTONDeposit() {
    if (!tonConnectUI.connected) {
        showMsg(IDS.TON_DEPOSIT_MSG.id, "You must connect your wallet first.", 'error');
        return;
    }

    const amountTON = prompt("Enter the TON deposit amount:");

    if (amountTON === null || isNaN(parseFloat(amountTON)) || parseFloat(amountTON) <= 0) {
        showMsg(IDS.TON_DEPOSIT_MSG.id, "Operation cancelled or invalid amount.", 'error');
        return;
    }

    const amountFloat = parseFloat(amountTON);
    const amountNanoTON = BigInt(Math.round(amountFloat * 1e9));

    try {
        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [
                {
                    address: DEPOSIT_ADDRESS,
                    amount: amountNanoTON.toString(), 
                }
            ],
        };
        
        showMsg(IDS.TON_DEPOSIT_MSG.id, "Sending transaction to wallet...", 'success');
        const result = await tonConnectUI.sendTransaction(transaction);
        
        console.log("Transaction Result:", result);
        showMsg(IDS.TON_DEPOSIT_MSG.id, `✅ Transaction sent! TX Hash: ${result.boc.slice(0, 10)}...`, 'success', 5000);

        // NOTE: In a real system, you'd wait for the transaction to be confirmed on the blockchain 
        // before updating the user's TON balance via the API.
        
    } catch (error) {
        console.error("Transaction failed or was cancelled:", error);
        showMsg(IDS.TON_DEPOSIT_MSG.id, "❌ Transaction failed or was cancelled.", 'error', 5000);
    }
}

// =================================================================
// 5. Setup and Initialization
// =================================================================

/**
 * Attaches event listeners to all interactive elements based on their IDs/attributes.
 */
function setupButtons() {
    // --- Page Navigation ---
    document.querySelectorAll('.btn[data-page-target], .back[data-page-target], button[data-page-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.getAttribute('data-page-target');
            if (target) showPage(target);
        });
    });

    // --- Core Actions ---
    IDS.ADS_BTN.addEventListener('click', handleAdWatch);
    IDS.WITHDRAW_BUTTON.addEventListener('click', handleWithdraw);
    IDS.CONVERT_BTN.addEventListener('click', handleConvert);
    IDS.COPY_BTN.addEventListener('click', copyRefLink);
    IDS.ADD_TASK_BTN.addEventListener('click', handleAddTonTask);
    
    // --- Task Buttons ---
    IDS.TASK_JOIN_BTN.addEventListener('click', (e) => {
        const action = e.currentTarget.getAttribute('data-task-action');
        if (action) handleTask('join', action);
    });
    IDS.TASK_ADS_BTN.addEventListener('click', () => handleTask('ads300'));

    // --- Input Handlers ---
    IDS.POINTS_INPUT.addEventListener('input', calcSwap);

    // --- Add Task Selection ---
    IDS.USER_OPTION_BTNS.forEach(btn => {
        btn.addEventListener('click', (e) => selectUsers(e.currentTarget));
    });

    // --- TON Connect Handlers ---
    tonConnectUI.onStatusChange(updateTONWalletUI);
    IDS.CONNECT_WALLET_BTN.addEventListener('click', handleTONConnect);
    IDS.DEPOSIT_BTN.addEventListener('click', handleTONDeposit);
}

/**
 * The main initialization function.
 */
async function init() {
    // 1. Initial UI setup (show loader)
    IDS.LOADER.style.display = 'flex';
    
    // 2. Setup button listeners
    setupButtons();
    updateTONWalletUI(tonConnectUI.wallet); // Initial wallet UI status check

    // 3. Register user and fetch profile data
    await registerUser();
    const profile = await getProfile();

    // 4. Populate UI
    if (profile) {
        updateUI(profile);
        
        // Optional: Load Telegram User Info for display if available
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
            const user = window.Telegram.WebApp.initDataUnsafe.user;
            IDS.USERNAME.textContent = user.first_name || user.username || 'User';
            if (user.photo_url) {
                IDS.USER_IMG.src = user.photo_url;
                IDS.USER_IMG.style.display = 'block';
            }
            // Save for non-WebApp fallback/display consistency
            localStorage.setItem('telegramUser', JSON.stringify({ id: getTelegramUserID(), first_name: user.first_name, username: user.username, photo_url: user.photo_url }));
        } else {
            // Load from fallback/localStorage
            const savedUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
            IDS.USERNAME.textContent = savedUser.first_name || savedUser.username || 'Web User';
            if (savedUser.photo_url) {
                IDS.USER_IMG.src = savedUser.photo_url;
                IDS.USER_IMG.style.display = 'block';
            }
        }
    } else {
        IDS.LOADER.querySelector('.loader-text').textContent = "Failed to load profile data.";
    }
    
    // 5. Default to Home Page
    showPage('home'); 
}

// Start the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', init);
