/**
 * /api/index.js
 * Serverless functions for all backend operations using Supabase REST API and fetch.
 */

// Configuration loaded from environment variables (Vercel)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Table name and constants
const TABLE_NAME = 'users_data';
const AD_REWARD_DAILY = 400;
const DAILY_MAX = 100;
const COOLDOWN_SEC = 3; // 30 seconds cooldown
const AD_REWARD_300 = 0.015;
const TASK_ADS_COUNT = 300;
const TASK_RESET_HOURS = 24;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment variables are not set.');
}

/**
 * Generic function to make requests to the Supabase REST API.
 * @param {string} endpoint - The Supabase path (e.g., '/rest/v1/users_data').
 * @param {Object} options - Fetch options.
 * @returns {Promise<Object>} The API response data.
 */
async function supabaseFetch(endpoint, options) {
    const url = `${SUPABASE_URL}${endpoint}`;
    const defaultHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
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

    if (response.status === 204) {
        return []; // No content for successful updates/deletes
    }

    return await response.json();
}

/**
 * API handler to register a new user or update ref_by if not set.
 */
async function registerUser(req, res) {
    const { user_id, ref_by } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'User ID is required.' });

    try {
        // 1. Check if user exists
        let existingUser = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*`, {
            method: 'GET',
            headers: { 'Prefer': 'return=representation,count=exact' }
        });

        if (existingUser.length === 0) {
            // 2. Insert new user
            const userData = {
                user_id: user_id,
                points: 0,
                usdt: 0,
                ton: 0,
                refs: 0,
                ads_watched_today: 0,
                ads_last_watch: 0,
                ads_date: new Date().toDateString(),
                ads_300_count: 0,
            };
            if (ref_by && user_id !== ref_by) {
                userData.ref_by = ref_by;
            }

            const newUser = await supabaseFetch(`/rest/v1/${TABLE_NAME}`, {
                method: 'POST',
                body: JSON.stringify([userData]),
            });

            // 3. Increase refs count for the referrer
            if (ref_by && user_id !== ref_by) {
                await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ refs: 'increment(1)' }),
                });
            }

            return res.status(201).json({ success: true, message: 'User registered.', data: newUser[0] });

        } else if (existingUser[0].ref_by === null && ref_by && user_id !== ref_by) {
            // 4. Update ref_by if it's null
            await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
                method: 'PATCH',
                body: JSON.stringify({ ref_by: ref_by }),
            });

            // 5. Increase refs count for the referrer
            await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${ref_by}`, {
                method: 'PATCH',
                body: JSON.stringify({ refs: 'increment(1)' }),
            });
            
            return res.status(200).json({ success: true, message: 'User and referrer updated.', data: existingUser[0] });
        }

        return res.status(200).json({ success: true, message: 'User already exists.', data: existingUser[0] });

    } catch (error) {
        console.error('Registration error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * API handler to fetch the user's profile.
 */
async function getProfile(req, res) {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'User ID is required.' });

    try {
        let profile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*`, { method: 'GET' });

        if (profile.length === 0) {
            // This should not happen if registerUser runs first, but handles edge cases.
            return res.status(404).json({ success: false, error: 'Profile not found. Please re-register.' });
        }
        
        // Check for daily ad reset
        const user = profile[0];
        const today = new Date().toDateString();
        
        if (user.ads_date !== today) {
            await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    ads_watched_today: 0, 
                    ads_date: today 
                }),
            });
            user.ads_watched_today = 0;
            user.ads_date = today;
        }

        return res.status(200).json({ success: true, data: user });

    } catch (error) {
        console.error('Get Profile error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * API handler to watch an ad and update balance/counters.
 */
async function adWatch(req, res) {
    const { user_id, task_type } = req.body;
    if (!user_id || !task_type) return res.status(400).json({ success: false, error: 'User ID and task_type are required.' });
    
    try {
        let profile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=*,ads_300_count,ads_300_reset`, { method: 'GET' });
        if (profile.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });
        
        const user = profile[0];
        const now = Date.now();
        const updateData = {};
        
        if (task_type === 'daily') {
            // Daily Ad Watch Logic
            const today = new Date().toDateString();
            if (user.ads_date !== today) {
                user.ads_watched_today = 0;
            }

            if (user.ads_watched_today >= DAILY_MAX) {
                return res.status(403).json({ success: false, error: 'Daily max ads reached.' });
            }
            if ((now - user.ads_last_watch) / 1000 < COOLDOWN_SEC) {
                return res.status(429).json({ success: false, error: 'Cooldown not finished.' });
            }
            
            updateData.ads_watched_today = user.ads_watched_today + 1;
            updateData.ads_last_watch = now;
            updateData.ads_date = today;
            updateData.points = user.points + AD_REWARD_DAILY;

        } else if (task_type === 'ads_300') {
            // 300 Ads Task Logic
            if (user.ads_300_reset && now < user.ads_300_reset) {
                 return res.status(403).json({ success: false, error: 'Task already completed, reset timer active.' });
            }
            
            const newCount = user.ads_300_count + 1;
            
            if (newCount > TASK_ADS_COUNT) {
                 return res.status(403).json({ success: false, error: 'Task completed, waiting for timer reset.' });
            }

            updateData.ads_300_count = newCount;

            if (newCount === TASK_ADS_COUNT) {
                // Reward and Reset Timer
                const resetTime = now + TASK_RESET_HOURS * 3600 * 1000;
                updateData.usdt = user.usdt + AD_REWARD_300;
                updateData.ads_300_reset = resetTime;
            }
        } else {
            return res.status(400).json({ success: false, error: 'Invalid task_type.' });
        }

        const updatedProfile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify(updateData),
        });

        // Return updated data for UI re-render
        return res.status(200).json({ success: true, data: { ...user, ...updateData } });

    } catch (error) {
        console.error('Ad Watch error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * API handler to swap points for USDT.
 */
async function swap(req, res) {
    const { user_id, points_amount, usdt_amount } = req.body;
    if (!user_id || !points_amount || !usdt_amount) return res.status(400).json({ success: false, error: 'Missing parameters.' });

    try {
        let profile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=points,usdt`, { method: 'GET' });
        if (profile.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profile[0];

        if (user.points < points_amount) {
            return res.status(403).json({ success: false, error: 'Insufficient points balance.' });
        }

        const newPoints = user.points - points_amount;
        const newUsdt = parseFloat(user.usdt) + usdt_amount;

        const updatedProfile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ points: newPoints, usdt: newUsdt.toFixed(4) }),
        });

        return res.status(200).json({ success: true, message: 'Swap successful.', data: updatedProfile[0] });

    } catch (error) {
        console.error('Swap error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// NOTE: Withdraw and Ton Task handlers are simplified as they involve external systems (Binance/TON).
// They mainly perform local balance updates and verification here.

async function withdraw(req, res) {
    const { user_id, amount } = req.body;
    
    try {
        let profile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=usdt`, { method: 'GET' });
        if (profile.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profile[0];

        if (user.usdt < amount) {
            return res.status(403).json({ success: false, error: 'Insufficient USDT balance.' });
        }

        const newUsdt = parseFloat(user.usdt) - amount;

        await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ usdt: newUsdt.toFixed(4) }),
        });

        return res.status(200).json({ success: true, message: 'Withdrawal processed (simulated).' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function addTonTask(req, res) {
    const { user_id, cost } = req.body;
    
    try {
        let profile = await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}&select=ton`, { method: 'GET' });
        if (profile.length === 0) return res.status(404).json({ success: false, error: 'User not found.' });

        const user = profile[0];

        if (user.ton < cost) {
            return res.status(403).json({ success: false, error: 'Insufficient TON balance.' });
        }

        const newTon = parseFloat(user.ton) - cost;

        await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ton: newTon.toFixed(4) }),
        });

        return res.status(200).json({ success: true, message: 'TON Task added (simulated payment).' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function taskClaim(req, res) {
     const { user_id, task_type, points } = req.body;
     if (!user_id || task_type !== 'join_channel' || !points) return res.status(400).json({ success: false, error: 'Invalid task claim request.' });

     try {
         // Simply add points for the one-time Telegram join task
         await supabaseFetch(`/rest/v1/${TABLE_NAME}?user_id=eq.${user_id}`, {
             method: 'PATCH',
             body: JSON.stringify({ points: 'add(' + points + ')' }),
         });
         return res.status(200).json({ success: true, message: 'Points claimed.' });
     } catch (error) {
         return res.status(500).json({ success: false, error: error.message });
     }
}


/**
 * Main serverless function handler for Vercel
 */
module.exports = async (req, res) => {
    const url = req.url.split('/');
    const action = url[url.length - 1];

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Only POST requests are allowed.' });
    }

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
            return res.status(404).json({ success: false, error: 'API endpoint not found.' });
    }
};
