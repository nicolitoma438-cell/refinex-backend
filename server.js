import express from "express";
import openid from "openid";

const { RelyingParty } = openid;

const app = express();
const PORT = process.env.PORT || 3000;
const RETURN_URL = process.env.STEAM_RETURN_URL || "https://refinex-backend-7i0n.onrender.com/auth/steam/return";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://refinex-tf2.onrender.com";
const STOCK_LIMIT = 300;
const TF2_APP_ID = 440;
const TF2_CONTEXT_ID = 2;
const DEFAULT_STOCK_STEAM_ID = "76561199526105710";

app.use(express.json());
const deposits = new Map();
const createRelyingParty = () => new RelyingParty(RETURN_URL, null, true, false, []);

app.get("/", (req, res) => res.json({ name: "Refinex.tf2 API", status: "online" }));

app.get("/auth/steam", (req, res) => {
    const relyingParty = createRelyingParty();
    relyingParty.authenticate("https://steamcommunity.com/openid", false, (error, authUrl) => {
        if (error || !authUrl) return res.status(500).send("Steam Login error");
        res.redirect(authUrl);
    });
});

app.get("/auth/steam/return", (req, res) => {
    const relyingParty = createRelyingParty();
    relyingParty.verifyAssertion(req, async (error, result) => {
        if (error || !result?.authenticated || !result.claimedIdentifier) return res.status(401).send("Steam Login failed");
        const steamId = result.claimedIdentifier.split("/").pop();
        let avatar = "";
        let personaName = "Steam User";
        try {
            const response = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`);
            const xml = await response.text();
            const avatarMatch = xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
            const nameMatch = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
            if (avatarMatch) avatar = avatarMatch[1];
            if (nameMatch) personaName = nameMatch[1];
        } catch (profileError) {
            console.error("Steam profile lookup error:", profileError);
        }
        const redirectUrl = new URL(FRONTEND_URL);
        redirectUrl.searchParams.set("steamId", steamId);
        redirectUrl.searchParams.set("login", "success");
        redirectUrl.searchParams.set("avatar", avatar);
        redirectUrl.searchParams.set("personaName", personaName);
        res.redirect(redirectUrl.toString());
    });
});

async function fetchSteamInventory(stockSteamId) {
    const url = `https://steamcommunity.com/inventory/${stockSteamId}/${TF2_APP_ID}/${TF2_CONTEXT_ID}?l=english&count=5000`;
    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://steamcommunity.com/"
        }
    });
    const bodyText = await response.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch {}
    return { url, response, bodyText, data };
}

async function readSteamStock() {
    const stockSteamId = String(process.env.STEAM_STOCK_ID || DEFAULT_STOCK_STEAM_ID).trim();
    if (!/^\d{5,20}$/.test(stockSteamId)) throw new Error("Invalid stock Steam ID");

    const { url, response, bodyText, data } = await fetchSteamInventory(stockSteamId);
    if (!response.ok) {
        const safeBody = bodyText.replace(/\s+/g, " ").slice(0, 500);
        const error = new Error(`Steam inventory HTTP ${response.status}`);
        error.status = response.status;
        error.steamResponse = safeBody;
        error.url = url;
        throw error;
    }
    if (!data) throw new Error(`Steam returned non-JSON response (HTTP ${response.status})`);
    if (Number(data.success) !== 1) throw new Error(`Steam inventory returned success=${data.success}`);

    const descriptions = new Map();
    for (const description of data.descriptions || []) {
        descriptions.set(`${description.classid}_${description.instanceid || "0"}`, description);
    }

    let refined = 0;
    let matchedAssets = 0;
    const matched = [];
    for (const asset of data.assets || []) {
        const description = descriptions.get(`${asset.classid}_${asset.instanceid || "0"}`);
        if (!description) continue;
        const marketHashName = String(description.market_hash_name || "").trim();
        const itemName = String(description.name || "").trim();
        const isRefined = marketHashName.toLowerCase() === "refined metal" || itemName.toLowerCase() === "refined metal";
        if (!isRefined) continue;
        const amount = Number(asset.amount);
        const count = Number.isFinite(amount) && amount > 0 ? amount : 1;
        refined += count;
        matchedAssets += 1;
        matched.push({ assetid: String(asset.assetid || ""), amount: count, name: itemName, market_hash_name: marketHashName });
    }

    return {
        stock: Math.max(0, Math.min(STOCK_LIMIT, refined)),
        refined: Math.max(0, Math.min(STOCK_LIMIT, refined)),
        limit: STOCK_LIMIT,
        source: "steam_inventory",
        steamId: stockSteamId,
        httpStatus: response.status,
        success: data.success,
        assetsReturned: Array.isArray(data.assets) ? data.assets.length : 0,
        descriptionsReturned: Array.isArray(data.descriptions) ? data.descriptions.length : 0,
        totalInventoryCount: Number(data.total_inventory_count || 0),
        moreItems: Boolean(data.more_items),
        lastAssetId: data.last_assetid || null,
        matchedAssets,
        matched,
        sampleNames: (data.descriptions || []).slice(0, 30).map(d => String(d.name || d.market_hash_name || "")).filter(Boolean)
    };
}

app.get("/api/stock", async (req, res) => {
    try {
        res.json(await readSteamStock());
    } catch (error) {
        console.error("Steam stock lookup error:", error);
        res.status(502).json({
            stock: 0,
            refined: 0,
            limit: STOCK_LIMIT,
            source: "steam_inventory",
            error: error.message,
            steamStatus: error.status || null,
            steamResponse: error.steamResponse || null
        });
    }
});

app.get("/api/stock/debug", async (req, res) => {
    const stockSteamId = String(process.env.STEAM_STOCK_ID || DEFAULT_STOCK_STEAM_ID).trim();
    try {
        res.json({ ok: true, ...await readSteamStock() });
    } catch (error) {
        console.error("Steam stock debug error:", error);
        res.status(502).json({
            ok: false,
            error: error.message,
            steamStatus: error.status || null,
            steamResponse: error.steamResponse || null,
            steamId: stockSteamId,
            steamInventoryUrl: error.url || `https://steamcommunity.com/inventory/${stockSteamId}/${TF2_APP_ID}/${TF2_CONTEXT_ID}?l=english&count=5000`
        });
    }
});

app.post("/api/deposit/create", (req, res) => {
    const steamId = String(req.body?.steamId || "").trim();
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (!/^\d{5,20}$/.test(steamId)) return res.status(400).json({ error: "Valid Steam ID is required." });
    if (amount < 1 || amount > STOCK_LIMIT) return res.status(400).json({ error: `Deposit amount must be between 1 and ${STOCK_LIMIT}.` });
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const request = { requestId, steamId, amount, status: "pending", refined: 0, createdAt: new Date().toISOString() };
    deposits.set(requestId, request);
    res.status(201).json({ requestId, status: request.status, amount: request.amount });
});

app.get("/api/deposit/status", (req, res) => {
    const requestId = String(req.query?.requestId || "").trim();
    if (!requestId) return res.json({ status: "pending", refined: 0, message: "No deposit request ID supplied." });
    const request = deposits.get(requestId);
    if (!request) return res.status(404).json({ status: "not_found", refined: 0 });
    res.json({ requestId: request.requestId, status: request.status, refined: request.status === "verified" ? request.amount : 0, amount: request.amount, createdAt: request.createdAt });
});

app.listen(PORT, () => console.log(`Refinex backend online on port ${PORT}`));
