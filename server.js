import express from "express";
import openid from "openid";

const { RelyingParty } = openid;

const app = express();
const PORT = process.env.PORT || 3000;
const RETURN_URL = process.env.STEAM_RETURN_URL || "https://refinex-backend-7i0n.onrender.com/auth/steam/return";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://refinex-tf2.onrender.com";

app.use(express.json());

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

    relyingParty.verifyAssertion(req, (error, result) => {
        if (error || !result?.authenticated || !result.claimedIdentifier) {
            console.error("Steam verification error:", error);
            return res.status(401).send("Steam Login failed");
        }

        const steamId = result.claimedIdentifier.split("/").pop();
        const redirectUrl = new URL(FRONTEND_URL);
        redirectUrl.searchParams.set("steamId", steamId);
        redirectUrl.searchParams.set("login", "success");

        res.redirect(redirectUrl.toString());
    });
});

app.get("/api/deposit/status", (req, res) => {
    res.json({
        status: "pending",
        refined: 0
    });
});

app.listen(PORT, () => {
    console.log(`Refinex backend online on port ${PORT}`);
});
