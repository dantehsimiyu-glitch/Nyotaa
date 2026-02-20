import fetch from "node-fetch";
import WebSocket from "ws";
import http from "http";

/* =========================
   ENV VARIABLES
========================= */

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN = process.env.DERIV_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN is missing!");
  process.exit(1);
}

if (!DERIV_TOKEN) {
  console.error("❌ DERIV_TOKEN is missing!");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   GLOBAL STATE
========================= */

let running = false;
let balance = 0;
let initialBalance = 0;
let trades = [];
let lossStreak = 0;
let wsConnection = null;

/* =========================
   TELEGRAM
========================= */

function sendMessage(chatId, text) {
  return fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

/* =========================
   DERIV CONNECTION
========================= */

function connectDeriv(chatId) {
  wsConnection = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

  wsConnection.on("open", () => {
    wsConnection.send(JSON.stringify({ authorize: DERIV_TOKEN }));
  });

  wsConnection.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.msg_type === "authorize") {
      wsConnection.send(JSON.stringify({ balance: 1 }));
    }

    if (data.msg_type === "balance") {
      balance = parseFloat(data.balance.balance);
      if (!initialBalance) initialBalance = balance;
    }
  });

  wsConnection.on("error", (err) => {
    console.error("WebSocket error:", err);
  });

  wsConnection.on("close", () => {
    console.log("WebSocket closed");
  });
}

/* =========================
   TELEGRAM POLLING
========================= */

async function pollTelegram() {
  let offset = 0;

  while (true) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?timeout=100&offset=${offset}`);
      const data = await res.json();

      if (!data.result) continue;

      for (const update of data.result) {
        offset = update.update_id + 1;

        if (!update.message) continue;

        const chatId = update.message.chat.id;
        const text = update.message.text;

        if (text === "/start") {
          sendMessage(chatId, "🤖 Bot Ready.\nUse /run to connect.");
        }

        if (text === "/run") {
          running = true;
          connectDeriv(chatId);
          sendMessage(chatId, "🚀 Connected to Deriv.");
        }

        if (text === "/stop") {
          running = false;
          if (wsConnection) wsConnection.close();
          sendMessage(chatId, "🛑 Stopped.");
        }

        if (text === "/balance") {
          sendMessage(chatId, `💰 Balance: ${balance}`);
        }
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }
}

/* =========================
   START BOT
========================= */

console.log("🤖 Bot is running...");

pollTelegram();

/* =========================
   WEB SERVER (Railway needs this)
========================= */

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot running");
}).listen(PORT, () => {
  console.log("Web server running on port", PORT);
});
