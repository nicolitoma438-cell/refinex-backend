import express from "express";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        name: "Refinex.tf2 API",
        status: "online"
    });
});

app.get("/api/deposit/status", (req, res) => {
    res.json({
        status: "pending",
        refined: 0
    });
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Refinex backend online");
});
