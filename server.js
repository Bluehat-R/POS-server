import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import linebot from "linebot";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import PDFDocument from "pdfkit";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fontPath = path.join(__dirname, "fonts", "NotoSansJP-Regular.ttf");

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://pos.ryuuu-app.com", "http://localhost:8080"],
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
});

// =====================
// SQLite init
// =====================
const dbPromise = open({
  filename: path.join(__dirname, "orders.db"),
  driver: sqlite3.Database,
});

(async () => {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      num INTEGER,
      qty INTEGER,
      toppings TEXT,
      coupon INTEGER,
      total INTEGER,
      status TEXT,
      time TEXT,
      userId TEXT
    )
  `);
})();

// =====================
// Utility
// =====================
const nowJP = () =>
  new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: false,
  });

// =====================
// LINE BOT
// =====================
const bot = linebot({
  channelId: process.env.LINE_CHANNEL_ID,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
});

app.post("/webhook", bot.parser());

// =====================
// Static
// =====================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let kitchenOrders = [];

// =====================
// 起動時ロード（DB → 表示）
// =====================
(async () => {
  const db = await dbPromise;
  const rows = await db.all(
    "SELECT * FROM orders WHERE status != 'キャンセル済'"
  );

  kitchenOrders = rows
    .map(o => ({ ...o, num: Number(o.num || 0) }))
    .sort((a, b) => b.num - a.num);

  console.log(`📦 起動時ロード: ${kitchenOrders.length}件`);
})();

// =====================
// レシート保存フォルダ
// =====================
const receiptDir = path.join(__dirname, "public", "receipts");
if (!fs.existsSync(receiptDir)) {
  fs.mkdirSync(receiptDir, { recursive: true });
}

// =====================
// PDFレシート生成（明細付き・高さ可変）
// =====================
app.get("/api/receipt-print", (req, res) => {
  const { num, qty, toppings, total } = req.query;
  const now = nowJP();

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>Receipt</title>
    <style>
      body {
        width: 180px;
        margin: 0;
        padding: 10px;
        font-family: "Noto Sans JP", sans-serif;
        font-size: 12px;
      }
      .center { text-align: center; }
      hr { border: none; border-top: 1px dashed #555; margin: 8px 0; }
    </style>
  </head>
  <body>
    <div class="center">${now}</div>
    <div class="center"><strong>じゃがバター屋</strong></div>
    <hr>

    <p>数量: ${qty}個</p>
    <p>合計: ${total}円</p>
    <p>トッピング: ${toppings}</p>

    <hr>
    <div class="center"><strong>No.${num}</strong></div>
    <div class="center">ご利用ありがとうございました！</div>

    <script>
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
          window.print();
          window.close();
        }, 200);
      });
    </script>
  </body>
  </html>
  `;

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  res.send(html);
});

// =====================
// Socket.io
// =====================
io.on("connection", (socket) => {
  console.log("🧑‍🍳 Client connected");

  socket.on("registerClient", () => {
    socket.emit("init", {
      kitchenOrders,
      customerCount: kitchenOrders.length,
    });
  });

  socket.on("newOrder", async (order) => {
    try {
      const saved = await saveAndBroadcast(order);
      io.emit("printReceipt", saved);
    } catch (e) {
      console.error("newOrder 保存失敗:", e);
    }
  });

  socket.on("updateStatus", async ({ id, action }) => {
    const db = await dbPromise;
    const order = kitchenOrders.find((o) => o.id === id);
    if (!order) return;

    switch (action) {
      case "toCooking":
        order.status = "調理中";
        break;

      case "toServing":
        order.status = "お渡し中";
        await sendLineNotify(order, "🍠 ご注文ができました！");
        break;

      case "toComplete":
        order.status = "完了";
        await sendLineNotify(order, "🙌 ご来店ありがとうございました！");
        break;

      case "toUncooked":
        if (order.status === "完了") order.status = "お渡し中";
        else if (order.status === "お渡し中") order.status = "調理中";
        else if (order.status === "調理中") order.status = "未調理";
        break;

      case "hide":
        console.log("🗑 hide リクエスト:", id);

        const before = kitchenOrders.length;
        kitchenOrders = kitchenOrders.filter((o) => o.id !== id);
        const after = kitchenOrders.length;

        console.log(`🧹 キッチン配列: ${before} → ${after}`);

        io.emit("updateOrders", {
          kitchenOrders,
          customerCount: kitchenOrders.length,
        });

        return;

      case "cancel":
        order.status = "キャンセル済";
        order.total = 0;
        await db.run("UPDATE orders SET status=?, total=? WHERE id=?", [
          order.status,
          order.total,
          id,
        ]);

        kitchenOrders = kitchenOrders.filter((o) => o.id !== id);

        io.emit("updateOrders", {
          kitchenOrders,
          customerCount: kitchenOrders.length,
        });
        return;
    }

    await db.run("UPDATE orders SET status=? WHERE id=?", [
      order.status,
      id,
    ]);

    io.emit("updateOrders", {
      kitchenOrders,
      customerCount: kitchenOrders.length,
    });
  });
});


// =====================
// LINE 通知
// =====================
async function sendLineNotify(order, message) {
  try {
    if (!order.userId || order.userId === "POS") return;

    const text = `${message}\n\nNo.${order.num}\n数量:${order.qty}\nトッピング:${order.toppings}`;
    await bot.push(order.userId, text);
  } catch (err) {
    console.error("LINE通知失敗:", err);
  }
}


// =====================
// DB保存
// =====================
async function saveAndBroadcast(order) {
  const db = await dbPromise;

  const saveOrder = {
    id: order.id ?? crypto.randomUUID(),
    num:
      order.num ??
      ((await db.get("SELECT MAX(num) AS max FROM orders"))?.max || 0) + 1,
    qty: order.qty,
    toppings: order.toppings,
    coupon: order.coupon ? 1 : 0,
    total: order.total,
    status: order.status || "未調理",
    time: nowJP(),
    userId: order.userId || "POS",
  };

  await db.run(
    `INSERT INTO orders (id, num, qty, toppings, coupon, total, status, time, userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      saveOrder.id,
      saveOrder.num,
      saveOrder.qty,
      saveOrder.toppings,
      saveOrder.coupon,
      saveOrder.total,
      saveOrder.status,
      saveOrder.time,
      saveOrder.userId,
    ]
  );

  kitchenOrders.push(saveOrder);
  kitchenOrders.sort((a, b) => b.num - a.num);

  io.emit("updateOrders", {
    kitchenOrders,
    customerCount: kitchenOrders.length,
  });

  console.log(`保存完了: No.${saveOrder.num}`);
  return saveOrder;
}

// =====================
// 管理画面
// =====================
app.get("/admin/orders", async (req, res) => {
  const db = await dbPromise;
  const rows = await db.all("SELECT * FROM orders ORDER BY num DESC");

  const totalSales = rows.reduce((s, o) => s + (o.total || 0), 0);
  const qtySum = rows.reduce((s, o) => s + (o.qty || 0), 0);
  const couponCount = rows.filter((o) => o.coupon === 1).length;

  let html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <title>注文一覧 管理画面</title>
    <style>
      body { font-family: sans-serif; padding: 20px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
      th, td { border: 1px solid #aaa; padding: 6px; text-align: center; }
      th { background: #eee; }
      h2 { margin-top: 40px; }
    </style>
  </head>
  <body>

    <h1>注文一覧（管理者）</h1>

    <table>
      <tr>
        <th>No</th>
        <th>数量</th>
        <th>トッピング</th>
        <th>クーポン</th>
        <th>金額</th>
        <th>状態</th>
        <th>時間</th>
      </tr>
  `;

  rows.forEach((o) => {
    html += `
      <tr>
        <td>${o.num}</td>
        <td>${o.qty}</td>
        <td>${o.toppings}</td>
        <td>${o.coupon ? "あり" : "なし"}</td>
        <td>${o.total}円</td>
        <td>${o.status}</td>
        <td>${o.time}</td>
      </tr>
    `;
  });

  html += `
    </table>

    <h2>集計</h2>
    <p>総注文数: ${rows.length}件</p>
    <p>総販売個数: ${qtySum}個</p>
    <p>クーポン使用数: ${couponCount}回</p>
    <p>売上合計: ${totalSales}円</p>

  </body>
  </html>
  `;

  res.send(html);
});

// =====================
// 起動
// =====================
const PORT = 8443;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🍟 POSサーバー起動: http://localhost:${PORT}`);
});
