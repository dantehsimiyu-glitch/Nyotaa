import fetch from "node-fetch";
import WebSocket from "ws";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const DERIV_TOKEN = process.env.DERIV_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

let running = false;
let balance = 0;
let initialBalance = 0;
let trades = [];
let lossStreak = 0;
let wsConnection = null;

function sendMessage(chatId, text) {
  return fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function connectDeriv(chatId) {
  wsConnection = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

  wsConnection.on("open", () => {
    wsConnection.send(JSON.stringify({ authorize: DERIV_TOKEN }));
  });

  wsConnection.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.msg_type === "authorize") {
      wsConnection.send(JSON.stringify({ balance: 1 }));
      wsConnection.send(JSON.stringify({ ticks: "R_75", subscribe: 1 }));
    }

    if (data.msg_type === "balance") {
      balance = parseFloat(data.balance.balance);
      if (!initialBalance) initialBalance = balance;
    }

    if (data.msg_type === "tick" && running) {
      const stake = Math.min(balance * 0.01, balance * 0.02);

      wsConnection.send(JSON.stringify({
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: "CALL",
        currency: "USD",
        duration: 5,
        duration_unit: "t",
        symbol: "R_75"
      }));
    }

    if (data.msg_type === "proposal") {
      wsConnection.send(JSON.stringify({
        buy: data.proposal.id,
        price: data.proposal.ask_price
      }));
    }

    if (data.msg_type === "proposal_open_contract") {
      if (data.proposal_open_contract.is_sold) {
        const result = parseFloat(data.proposal_open_contract.profit);
        balance += result;
        trades.push(result);

        if (result < 0) lossStreak++;
        else lossStreak = 0;

        sendMessage(chatId, `📊 Trade Result: ${result}\n💰 Balance: ${balance.toFixed(2)}`);

        if (lossStreak >= 3) {
          running = false;
          sendMessage(chatId, "🛑 Stopped: 3 loss streak reached.");
        }

        const drawdown = ((initialBalance - balance) / initialBalance) * 100;
        if (drawdown >= 5) {
          running = false;
          sendMessage(chatId, "🛑 Stopped: 5% drawdown reached.");
        }
      }
    }
  });
}

async function pollTelegram() {
  let offset = 0;

  while (true) {
    const res = await fetch(`${TELEGRAM_API}/getUpdates?timeout=100&offset=${offset}`);
    const data = await res.json();

    if (!data.result || !Array.isArray(data.result)) return;

for (const update of data.result) {

      if (!update.message) continue;

      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === "/start") {
        sendMessage(chatId, "🤖 Quant Bot Ready.\nUse /run to start trading.");
      }

      if (text === "/run") {
        running = true;
        sendMessage(chatId, "🚀 Trading started.");
        connectDeriv(chatId);
      }

      if (text === "/stop") {
        running = false;
        if (wsConnection) wsConnection.close();
        sendMessage(chatId, "🛑 Trading stopped.");
      }

      if (text === "/balance") {
        sendMessage(chatId, `💰 Current Balance: ${balance.toFixed(2)}`);
      }

      if (text === "/stats") {
        const wins = trades.filter(t => t > 0).length;
        const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : 0;
        sendMessage(chatId, `📈 Trades: ${trades.length}\n🏆 Win Rate: ${winRate}%`);
      }
    }
  }
}

console.log("🤖 Bot is running...");

async function startBot() {
  while (true) {
    try {
      await pollTelegram();
    } catch (err) {
      console.error("Polling error:", err);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Prevent crash shutdown
process.on("unhandledRejection", err => {
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught exception:", err);
});

startBot();
import http from "http";

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot running");
}).listen(PORT, () => {
  console.log("Web server running on port", PORT);
});
