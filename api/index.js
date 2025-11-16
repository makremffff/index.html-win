// /api/index.js — Backend (Vercel)

// === Constants ===
const POINTS_TO_USDT_RATE = 100000;
const AD_REWARD_POINTS = 400;
const DAILY_MAX_ADS = 100;
const COOLDOWN_SEC = 3;
const RESET_HOURS_UTC = 15;

// === Supabase Config ===
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const USERS_TABLE = "users_data";
const WITHDRAWALS_TABLE = "withdrawals";

// === Supabase Fetch ===
async function supabaseFetch(endpoint, method, headers = {}, body = null) {
    const url = `${SUPABASE_URL}${endpoint}`;

    const config = {
        method,
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            Prefer: method === "PATCH" || method === "POST" ? "return=representation" : "return=minimal",
            ...headers,
        },
        body: body ? JSON.stringify(body) : null,
    };

    const res = await fetch(url, config);
    const text = await res.text();

    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);

    // إصلاح bug 204 EMPTY BODY
    if (!text.trim()) return {};

    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

// === Main Handler ===
export default async function handler(req, res) {
    if (req.method !== "POST")
        return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const { action, ...params } = req.body;

    try {
        let result;
        switch (action) {
            case "register":
                result = await registerUser(params);
                break;
            case "profile":
                result = await getProfile(params);
                break;
            case "swap":
                result = await swapPoints(params);
                break;
            case "adStatus":
                result = await adStatus(params);
                break;
            case "adWatch":
                result = await adWatch(params);
                break;
            case "leaderboard":
                result = await leaderboard();
                break;
            case "withdraw":
                result = await withdraw(params);
                break;
            default:
                return res.status(400).json({ success: false, error: "Invalid action" });
        }

        res.status(200).json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

// === Helpers ===

// FIXED: Correct daily reset logic
async function checkAdReset(user_id) {
    const data = await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}&select=ads_date`,
        "GET"
    );

    if (!data[0]?.ads_date) return;

    const lastDate = new Date(data[0].ads_date);
    const now = new Date();

    const todayReset = new Date();
    todayReset.setUTCHours(RESET_HOURS_UTC, 0, 0, 0);

    // Only reset if:
    // last ad watch was BEFORE today's reset
    // AND now is AFTER today's reset
    if (lastDate < todayReset && now > todayReset) {
        await supabaseFetch(
            `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}`,
            "PATCH",
            {},
            { ads_watched_today: 0, ads_date: now.toISOString() }
        );
    }
}

// === Register User ===
async function registerUser({ user_id, ref_by, username, first_name, photo_url }) {
    if (!user_id) throw "user_id required";

    const existing = await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}&select=user_id`,
        "GET"
    );
    if (existing.length) return { success: true, message: "Exists" };

    await supabaseFetch(`/rest/v1/${USERS_TABLE}`, "POST", {}, {
        user_id,
        points: 50,
        usdt: 0,
        ref_by: ref_by || null,
        refs: 0,
        ads_watched_today: 0,
        ads_last_watch: 0,
        ads_date: new Date().toISOString(),
        username: username || null,
        first_name: first_name || null,
        photo_url: photo_url || null,
    });

    // FIXED: Correct referral increment
    if (ref_by && ref_by !== user_id) {
        const ref = await supabaseFetch(
            `/rest/v1/${USERS_TABLE}?user_id=eq.${ref_by}&select=refs`,
            "GET"
        );
        if (ref.length) {
            await supabaseFetch(
                `/rest/v1/${USERS_TABLE}?user_id=eq.${ref_by}`,
                "PATCH",
                {},
                { refs: ref[0].refs + 1 }
            );
        }
    }

    return { success: true };
}

// === Get Profile ===
async function getProfile({ user_id }) {
    if (!user_id) throw "user_id required";

    await checkAdReset(user_id);

    const data = await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}&select=*`,
        "GET"
    );

    if (!data.length) return { success: false, error: "Not found" };

    const u = data[0];
    const now = Date.now();
    const last = u.ads_last_watch || 0;

    const remaining = Math.max(0, COOLDOWN_SEC - Math.floor((now - last) / 1000));

    return {
        success: true,
        data: {
            ...u,
            remaining_cooldown_sec: remaining,
            can_watch: u.ads_watched_today < DAILY_MAX_ADS && remaining === 0,
        }
    };
}

// === Swap ===
async function swapPoints({ user_id, points_amount }) {
    if (points_amount <= 0) return { success: false, error: "Invalid amount" };

    const prof = await getProfile({ user_id });
    const u = prof.data;

    if (u.points < points_amount) return { success: false, error: "Insufficient points" };

    const usdt = points_amount / POINTS_TO_USDT_RATE;

    await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}`,
        "PATCH",
        {},
        {
            points: u.points - points_amount,
            usdt: +(u.usdt + usdt).toFixed(4)
        }
    );

    return getProfile({ user_id });
}

// === Ad Status ===
async function adStatus({ user_id }) {
    return getProfile({ user_id });
}

// === Watch Ad ===
async function adWatch({ user_id, reward = AD_REWARD_POINTS }) {
    const st = await adStatus({ user_id });
    if (!st.data.can_watch) return { success: false, error: "Cooldown or limit" };

    const u = st.data;
    const now = Date.now();

    await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}`,
        "PATCH",
        {},
        {
            points: u.points + reward,
            ads_watched_today: u.ads_watched_today + 1,
            ads_last_watch: now
        }
    );

    return getProfile({ user_id });
}

// === Leaderboard ===
async function leaderboard() {
    const data = await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?select=user_id,username,first_name,points&order=points.desc&limit=10`,
        "GET"
    );
    return { success: true, data };
}

// === Withdraw ===
async function withdraw({ user_id, binance_id, amount }) {
    if (amount <= 0) return { success: false, error: "Invalid amount" };

    const prof = await getProfile({ user_id });
    const u = prof.data;

    if (u.usdt < amount) return { success: false, error: "Insufficient balance" };

    await supabaseFetch(`/rest/v1/${WITHDRAWALS_TABLE}`, "POST", {}, {
        user_id,
        binance_id,
        amount,
        status: "pending"
    });

    await supabaseFetch(
        `/rest/v1/${USERS_TABLE}?user_id=eq.${user_id}`,
        "PATCH",
        {},
        { usdt: +(u.usdt - amount).toFixed(4) }
    );

    return getProfile({ user_id });
}