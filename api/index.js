/**
 * /api/index.js
 * Serverless functions for all backend operations using Supabase REST API and fetch.
 * Implements safe fetch-then-update logic for critical paths (adWatch, swap, taskClaim, etc.).
 */

// Configuration loaded from environment variables (Vercel)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Table name and constants (These should ideally be loaded from a more secure service or config)
const TABLE_NAME = 'users_data';
const AD_REWARD_DAILY = 400;
const DAILY_MAX = 100;
const COOLDOWN_SEC = 3; // 3 seconds cooldown
const AD_REWARD_300 = 0.015;
const TASK_ADS_COUNT = 300;
const TASK_RESET_HOURS = 24;
const TASK_JOIN_PTS = 10000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment variables are not set.');
}

// --- Utility Functions ---

/**
 * Helper to get the start of the current day as a timestamp (ms).
 * Used for reliable daily reset check.
 * @returns {number} Timestamp in milliseconds for the start of the current day.
 */
function getStartOfDayTimestamp() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
}

/**
 * Generic function to make requests to the Supabase REST API.
 * Ensures 'return=representation' preference is used to avoid 204 status.
 * @param {string} endpoint - The Supabase path (e.g., '/rest/v1/users_data').
 * @param {Object} options - Fetch options.
 * @returns {Promise<Object[]>} The API response data (array of objects).
 */
async function supabaseFetch(endpoint, options) {
    const url = `${SUPABASE_URL}${endpoint}`;
    const defaultHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation', // Always return the updated/inserted object
    };

    const response = await fetch(url, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    // Should return 200/201 with representation, handle 204 defensively
    if (response.status === 204) {
        return []; 
    }

    return await response.json();
}

// --- API Handlers ---

/**
 * Registers a new user or updates ref_by and ensures constants are returned.
 * Protects against double referral credit by checking if ref_by is null.
 */
async function registerUser(req, res) {
    const { user_id, ref_by } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'User ID is required.' });

    try {
        const startOfDay = getStartOfDayTimestamp();
        
        // 1. Check if user exists
        let existingUser = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*`, {
            method: 'GET',
        });

        if (existingUser.length === 0) {
            // 2. Insert new user
            const userData = {
                user_id: user_id,
                points: 0,
                usdt: 0.0000,
                ton: 0.0000,
                refs: 0,
                ads_watched_today: 0,
                ads_last_watch: 0, 
                ads_date: startOfDay, // Daily reset timestamp
                ads_300_count: 0,
                ads_300_reset: 0, // 300 ads reset timestamp
                task_join_done: false, // New column for join task state
            };
            if (ref_by && user_id !== ref_by) {
                userData.ref_by = ref_by;
            }

            const newUserArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}`, {
                method: 'POST',
                body: JSON.stringify([userData]),
            });
            const newUser = newUserArray[0];

            // 3. Increase refs count for the referrer (Fetch-then-Update)
            if (ref_by && user_id !== ref_by) {
                const referrer = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}&select=refs`, { method: 'GET' });
                if (referrer.length > 0) {
                    const currentRefs = referrer[0].refs || 0;
                    await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ refs: currentRefs + 1 }),
                    });
                }
            }

            return res.status(201).json({ success: true, message: 'User registered.', data: { ...newUser, CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } });

        } else if (existingUser[0].ref_by === null && ref_by && user_id !== ref_by) {
            // 4. Update ref_by if it's null (ensures single attribution)
            await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
                method: 'PATCH',
                body: JSON.stringify({ ref_by: ref_by }),
            });

            // 5. Increase refs count for the referrer (Fetch-then-Update)
            const referrer = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}&select=refs`, { method: 'GET' });
            if (referrer.length > 0) {
                const currentRefs = referrer[0].refs || 0;
                await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ refs: currentRefs + 1 }),
                });
            }
            
            // Re-fetch to get the updated profile for the response
            const updatedUserArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*`, { method: 'GET' });
            
            return res.status(200).json({ success: true, message: 'User and referrer updated.', data: { ...updatedUserArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } });
        }
        
        // User already exists and ref_by is set or not provided
        return res.status(200).json({ success: true, message: 'User already exists.', data: { ...existingUser[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } });

    } catch (error) {
        console.error('Registration error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Fetches the user's profile and performs daily reset check using timestamps.
 */
async function getProfile(req, res) {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'User ID is required.' });

    try {
        let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*`, { method: 'GET' });

        if (profileArray.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found. Please register first.' });
        }
        
        let user = profileArray[0];
        const startOfDay = getStartOfDayTimestamp();
        
        // Check for daily ad reset
        if (user.ads_date < startOfDay) {
            // Perform the daily reset (Fetch-then-Update)
            const updateData = {
                ads_watched_today: 0, 
                ads_date: startOfDay,
            };
            
            const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
                method: 'PATCH',
                body: JSON.stringify(updateData),
            });
            
            user = updatedProfileArray[0]; // Use the freshly updated data
        }

        return res.status(200).json({ success: true, data: { ...user, CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } });

    } catch (error) {
        console.error('Get Profile error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Handles watching ads for both daily and 300 ads task (Fetch-then-Update).
 */
async function adWatch(req, res) {
    const { user_id, task_type } = req.body;
    if (!user_id || !task_type) return res.status(400).json({ success: false, error: 'User ID and task_type are required.' });
    
    try {
        // Fetch current data for safe calculations
        let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*,points,usdt`, { method: 'GET' });
        if (profileArray.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });
        
        const user = profileArray[0];
        const now = Date.now();
        const startOfDay = getStartOfDayTimestamp();
        const updateData = {};
        let message = 'Ad watched.';

        // 1. Daily Ad Reset Check
        if (user.ads_date < startOfDay) {
            user.ads_watched_today = 0;
            user.ads_date = startOfDay;
            updateData.ads_date = startOfDay;
        }

        if (task_type === 'daily') {
            // 2. Daily Ad Watch Logic
            if (user.ads_watched_today >= DAILY_MAX) {
                return res.status(403).json({ success: false, error: 'Daily max ads reached.' });
            }
            if ((now - user.ads_last_watch) / 1000 < COOLDOWN_SEC) {
                const remaining = COOLDOWN_SEC - Math.floor((now - user.ads_last_watch) / 1000);
                return res.status(429).json({ success: false, error: `Cooldown not finished. Wait ${remaining}s` });
            }
            
            // SAFE CALCULATION
            updateData.ads_watched_today = user.ads_watched_today + 1;
            updateData.ads_last_watch = now;
            updateData.points = user.points + AD_REWARD_DAILY;
            message = `Daily ad watched. +${AD_REWARD_DAILY} Points.`;

        } else if (task_type === 'ads_300') {
            // 3. 300 Ads Task Logic
            if (user.ads_300_reset > now) {
                 const remainingHours = ((user.ads_300_reset - now) / (3600 * 1000)).toFixed(1);
                 return res.status(403).json({ success: false, error: `Task already completed, resets in about ${remainingHours} hours.` });
            }
            
            // The client can watch up to TASK_ADS_COUNT
            if (user.ads_300_count >= TASK_ADS_COUNT) {
                 // This handles the edge case where the user hit 300, but the reward PATCH failed.
                 // We let them proceed to trigger the reward again.
                 // The next line resets it if reward is claimed.
            }
            
            const newCount = user.ads_300_count + 1;
            
            // SAFE CALCULATION
            if (newCount === TASK_ADS_COUNT) {
                // Reward and Reset Timer
                const resetTime = now + TASK_RESET_HOURS * 3600 * 1000;
                updateData.usdt = parseFloat(user.usdt) + AD_REWARD_300; 
                updateData.ads_300_reset = resetTime;
                updateData.ads_300_count = 0; // Reset for next cycle
                message = `🎉 Task Completed! Earned ${AD_REWARD_300} USDT. Resetting...`;
            } else if (newCount < TASK_ADS_COUNT) {
                updateData.ads_300_count = newCount;
                message = `Ad watched! ${newCount}/${TASK_ADS_COUNT}`;
            } else {
                 // Should not happen, but prevents count overflow
                 return res.status(403).json({ success: false, error: 'Task completed, waiting for timer reset.' });
            }
        } else {
            return res.status(400).json({ success: false, error: 'Invalid task_type.' });
        }

        // 4. Perform the update
        const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify(updateData),
        });

        // Return updated data and constants
        return res.status(200).json({ 
            success: true, 
            message: message,
            data: { ...updatedProfileArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } 
        });

    } catch (error) {
        console.error('Ad Watch error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * API handler to claim points for the one-time join task (Fetch-then-Update).
 * The server handles task completion state (`task_join_done`).
 */
async function taskClaim(req, res) {
     const { user_id, task_type } = req.body;
     if (!user_id || task_type !== 'join_channel') return res.status(400).json({ success: false, error: 'Invalid task claim request.' });

     try {
         // 1. Fetch current data
         let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=points,task_join_done`, { method: 'GET' });
         if (profileArray.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });
         
         const user = profileArray[0];

         if (user.task_join_done === true) {
             return res.status(403).json({ success: false, error: 'Join channel task already claimed.' });
         }

         // 2. SAFE CALCULATION
         const newPoints = user.points + TASK_JOIN_PTS;
         
         const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
             method: 'PATCH',
             body: JSON.stringify({ points: newPoints, task_join_done: true }),
         });
         
         return res.status(200).json({ 
             success: true, 
             message: `Points claimed. +${TASK_JOIN_PTS.toLocaleString()} Points.`,
             data: { ...updatedProfileArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } 
         });
     } catch (error) {
         console.error('Task Claim error:', error.message);
         return res.status(500).json({ success: false, error: error.message });
     }
}

/**
 * API handler to swap points for USDT (Fetch-then-Update).
 */
async function swap(req, res) {
    const { user_id, points_amount, usdt_amount } = req.body;
    if (!user_id || !points_amount || !usdt_amount) return res.status(400).json({ success: false, error: 'Missing parameters.' });

    try {
        // Fetch current data for safe calculation
        let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=points,usdt`, { method: 'GET' });
        if (profileArray.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profileArray[0];

        if (user.points < points_amount) {
            return res.status(403).json({ success: false, error: 'Insufficient points balance.' });
        }
        
        // SAFE CALCULATION
        const newPoints = user.points - points_amount;
        // Ensure usdt is treated as float for addition accuracy
        const newUsdt = parseFloat(user.usdt) + usdt_amount; 

        const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ points: newPoints, usdt: newUsdt.toFixed(4) }),
        });

        return res.status(200).json({ 
            success: true, 
            message: 'Swap successful.', 
            data: { ...updatedProfileArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } } 
        });

    } catch (error) {
        console.error('Swap error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Handles USDT withdrawal (Fetch-then-Update).
 */
async function withdraw(req, res) {
    const { user_id, amount } = req.body;
    
    try {
        let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=usdt`, { method: 'GET' });
        if (profileArray.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profileArray[0];

        if (user.usdt < amount) {
            return res.status(403).json({ success: false, error: 'Insufficient USDT balance.' });
        }

        // SAFE CALCULATION
        const newUsdt = parseFloat(user.usdt) - amount;

        const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ usdt: newUsdt.toFixed(4) }),
        });

        return res.status(200).json({ 
            success: true, 
            message: 'Withdrawal processed (simulated balance update).',
            data: { ...updatedProfileArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Handles payment for adding a TON task (Fetch-then-Update).
 */
async function addTonTask(req, res) {
    const { user_id, cost } = req.body;
    
    try {
        let profileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=ton`, { method: 'GET' });
        if (profileArray.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profileArray[0];

        if (user.ton < cost) {
            return res.status(403).json({ success: false, error: 'Insufficient TON balance.' });
        }

        // SAFE CALCULATION
        const newTon = parseFloat(user.ton) - cost;

        const updatedProfileArray = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ton: newTon.toFixed(4) }),
        });

        return res.status(200).json({ 
            success: true, 
            message: 'TON Task added (simulated payment).',
            data: { ...updatedProfileArray[0], CONSTANTS: { DAILY_MAX, COOLDOWN_SEC, TASK_ADS_COUNT, AD_REWARD_300, TASK_JOIN_PTS } }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}


/**
 * Main serverless function handler for Vercel.
 * Routes POST requests to the corresponding handler function.
 */
module.exports = async (req, res) => {
    // Determine the action from the URL path (e.g., /api/registerUser -> registerUser)
    const url = req.url.split('/');
    const action = url[url.length - 1];

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Only POST requests are allowed.' });
    }

    try {
        switch (action) {
            case 'registerUser':
                return await registerUser(req, res);
            case 'getProfile':
                return await getProfile(req, res);
            case 'adWatch':
                return await adWatch(req, res);
            case 'swap':
                return await swap(req, res);
            case 'withdraw':
                return await withdraw(req, res);
            case 'addTonTask':
                return await addTonTask(req, res);
            case 'taskClaim':
                return await taskClaim(req, res);
            default:
                return res.status(404).json({ success: false, error: `API endpoint ${action} not found.` });
        }
    } catch (error) {
        console.error('Unhandled Server Error:', error.message);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
};
