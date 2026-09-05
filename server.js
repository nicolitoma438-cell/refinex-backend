import express from "express";
import openid from "openid";

const { RelyingParty } = openid;

const app = express();
const PORT = process.env.PORT || 3000;
const RETURN_URL = process.env.STEAM_RETURN_URL || "https://refinex-backend-7i0n.onrender.com/auth/steam/return";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://refinex-tf2.onrender.com";
const STOCK_LIMIT = 300;

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
    res.json({
        name: "Refinex.tf2 API",
        status: "online"
    });
});

app.get("/auth/steam", (req, res) => {
    const relyingParty = createRelyingParty();

    relyingParty.authenticate(
        "https://steamcommunity.com/openid",
        false,
        (error, authUrl) => {
            if (error || !authUrl) {
                console.error("Steam authentication error:", error);
                return res.status(500).send("Steam Login error");
            }

            res.redirect(authUrl);
        }
    );
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

app.get("/api/stock", (req, res) => {
    const refined = Math.max(0, Math.min(STOCK_LIMIT, Number(process.env.STOCK_REFINED) || 0));

    res.json({
        stock: refined,
        refined,
        limit: STOCK_LIMIT
    });
});

app.post("/api/deposit/create", (req, res) => {
    const steamId = String(req.body?.steamId || "").trim();
    const amount = Math.floor(Number(req.body?.amount) || 0);

    if (!/^\d{5,20}$/.test(steamId)) {
        return res.status(400).json({ error: "Valid Steam ID is required." });
    }

    if (amount < 1 || amount > STOCK_LIMIT) {
        return res.status(400).json({ error: `Deposit amount must be between 1 and ${STOCK_LIMIT}.` });
    }

    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const request = {
        requestId,
        steamId,
        amount,
        status: "pending",
        refined: 0,
        createdAt: new Date().toISOString()
    };

    deposits.set(requestId, request);

    res.status(201).json({
        requestId,
        status: request.status,
        amount: request.amount
    });
});

app.get("/api/deposit/status", (req, res) => {
    const requestId = String(req.query?.requestId || "").trim();

    if (!requestId) {
        return res.json({
            status: "pending",
            refined: 0,
            message: "No deposit request ID supplied."
        });
    }

    const request = deposits.get(requestId);

    if (!request) {
        return res.status(404).json({
            status: "not_found",
            refined: 0
        });
    }

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
