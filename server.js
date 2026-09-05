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
const REFINED_DEF_INDEX = 5000;
const DEFAULT_STOCK_STEAM_ID = "76561199526105710";

app.use(express.json());

const deposits = new Map();

const createRelyingParty = () => new RelyingParty(
    RETURN_URL,
    null,
    true,
    false,
    []
);

app.get("/", (req, res) => {
    res.json({ name: "Refinex.tf2 API", status: "online" });
});

app.get("/auth/steam", (req, res) => {
    const relyingParty = createRelyingParty();
    relyingParty.authenticate("https://steamcommunity.com/openid", false, (error, authUrl) => {
        if (error || !authUrl) {
            console.error("Steam authentication error:", error);
            return res.status(500).send("Steam Login error");
        }
        res.redirect(authUrl);
    });
});

app.get("/auth/steam/return", (req, res) => {
    const relyingParty = createRelyingParty();
    relyingParty.verifyAssertion(req, async (error, result) => {
        if (error || !result?.authenticated || !result.claimedIdentifier) {
            console.error("Steam verification error:", error);
            return res.status(401).send("Steam Login failed");
        }

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

app.get("/api/stock", async (req, res) => {
    const stockSteamId = String(process.env.STEAM_STOCK_ID || DEFAULT_STOCK_STEAM_ID).trim();

    if (!/^\d{5,20}$/.test(stockSteamId)) {
        return res.status(500).json({ stock: 0, refined: 0, limit: STOCK_LIMIT, source: "steam_inventory", configured: false, error: "Invalid stock Steam ID" });
    }

    try {
        const url = `https://steamcommunity.com/inventory/${stockSteamId}/${TF2_APP_ID}/${TF2_CONTEXT_ID}?l=english&count=5000`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Refinex.tf2 stock reader/1.0",
                "Accept": "application/json"
            }
        });

        if (!response.ok) throw new Error(`Steam inventory HTTP ${response.status}`);

        const data = await response.json();
        if (Number(data.success) !== 1) throw new Error(`Steam inventory returned success=${data.success}`);

        const descriptions = new Map();
        for (const description of data.descriptions || []) {
            const key = `${description.classid}_${description.instanceid || "0"}`;
            descriptions.set(key, description);
        }

        let refined = 0;
        let matchedAssets = 0;

        for (const asset of data.assets || []) {
            const key = `${asset.classid}_${asset.instanceid || "0"}`;
            const description = descriptions.get(key);
            const marketHashName = String(description?.market_hash_name || "").trim();
            const itemName = String(description?.name || "").trim();
            const defIndex = String(description?.commodity || "") === "1" ? Number(description?.classid) : Number(description?.defindex ?? description?.item_definition_index);

            const isRefined =
                marketHashName === "Refined Metal" ||
                itemName === "Refined Metal" ||
                defIndex === REFINED_DEF_INDEX;

            if (!isRefined) continue;

            matchedAssets += 1;
            const amount = Number(asset.amount);
            refined += Number.isFinite(amount) && amount > 0 ? amount : 1;
        }

        refined = Math.max(0, Math.min(STOCK_LIMIT, refined));

        return res.json({
            stock: refined,
            refined,
            limit: STOCK_LIMIT,
            source: "steam_inventory",
            configured: true,
            steamId: stockSteamId,
            matchedAssets
        });
    } catch (error) {
        console.error("Steam stock lookup error:", error);
        return res.status(502).json({
            stock: 0,
            refined: 0,
            limit: STOCK_LIMIT,
            source: "steam_inventory",
            configured: true,
            steamId: stockSteamId,
            error: "Steam inventory unavailable"
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

    res.json({
        requestId: request.requestId,
        status: request.status,
        refined: request.status === "verified" ? request.amount : 0,
        amount: request.amount,
        createdAt: request.createdAt
    });
});

app.listen(PORT, () => {
    console.log(`Refinex backend online on port ${PORT}`);
});
