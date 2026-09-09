// ✅ サーバーを明示的に指定（WebSocket限定）
const socket = io("https://pos.ryuuu-app.com", {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// ✅ デバッグログ
socket.on("connect", () => {
  console.log("✅ Socket接続成功");
  socket.emit("registerClient", "kitchen");
});

socket.on("disconnect", () => console.warn("⚠️ Socket切断"));
socket.on("connect_error", err => console.error("❌ 接続エラー:", err));

const kitchenList = document.getElementById("kitchenList");
let kitchenOrders = [];

// 時計
setInterval(() => {
  const now = new Date();
  const z = n => String(n).padStart(2, "0");
  document.getElementById("clock").textContent = `${z(now.getHours())}:${z(now.getMinutes())}`;
}, 1000);

// データ同期
socket.on("init", (d) => {
  kitchenOrders = (d.kitchenOrders ?? []).sort((a, b) => b.num - a.num);
  render();
});

socket.on("updateOrders", (d) => {
  kitchenOrders = (d.kitchenOrders ?? []).sort((a, b) => b.num - a.num);
  render();
});

// 表示更新
function render() {

  kitchenOrders = kitchenOrders
    .map(o => ({ ...o, num: Number(o.num || 0) }))
    .sort((a, b) => b.num - a.num);

  kitchenList.innerHTML = "";

  kitchenOrders.forEach(o => {
    const li = document.createElement("li");

    let summary = "";

    if (o.toppings && o.toppings.trim() !== "") {
      summary = `${o.qty}個 （${o.toppings}）`;
    } else {
      summary = `${o.qty}個`;
    }

    li.innerHTML = `
      <div class="order-content">
        <div class="order-no">№${o.num}</div>
        <div class="order-summary">${summary}</div>
        <div class="order-status">${o.status}</div>
      </div>
      <div class="kitchen-buttons">
        ${o.status === "未調理" ? `<button class="to-cooking">▶️ 調理開始</button>` : ""}
        ${o.status === "調理中" ? `
          <button class="to-serving">🍽 お渡しへ</button>
          <button class="to-uncooked">↩ 戻す</button>` : ""}
        ${o.status === "お渡し中" ? `
          <button class="to-complete">✅ 完了</button>
          <button class="to-cooking">↩ 戻す</button>` : ""}
        ${o.status === "完了" ? `<button class="delete">🗑 削除</button>` : ""}
      </div>
    `;

    const emit = (action) => socket.emit("updateStatus", { id: o.id, action });

    li.querySelectorAll("button").forEach(btn => {
      if (btn.classList.contains("to-cooking")) btn.onclick = () => emit("toCooking");
      if (btn.classList.contains("to-serving")) btn.onclick = () => emit("toServing");
      if (btn.classList.contains("to-uncooked")) btn.onclick = () => emit("toUncooked");
      if (btn.classList.contains("to-complete")) btn.onclick = () => emit("toComplete");
      if (btn.classList.contains("delete")) btn.onclick = () => {
        if (confirm(`№${o.num} を削除しますか？`)) emit("hide");
      };
    });

    kitchenList.appendChild(li);
  });
}

