document.addEventListener("DOMContentLoaded", () => {
  // =====================
  // UUID 生成（古いブラウザ対策）
  // =====================
  const uuid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  // =====================
  // Socket.IO
  // =====================
  const socket = io({
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("Socket接続成功");
    socket.emit("registerClient", "pos");
  });
  socket.on("disconnect", () => console.warn("Socket切断"));
  socket.on("connect_error", (err) => console.error("接続エラー:", err));

  // =====================
  // DOM ヘルパ
  // =====================
  const $ = (id) => document.getElementById(id);

  let tempOrders = [];
  let kitchenOrders = [];
  let qty = 1;

  // =====================
  // 数量
  // =====================
  const elQty = $("qty");
  const elTotal = $("total");
  const elPlus = $("plus");
  const elMinus = $("minus");

  const recalcTotal = () => {
    const cheese = $("cheese").classList.contains("active");
    const coupon = $("coupon").classList.contains("active");

    const base = qty * 400;
    const add = cheese ? 100 : 0;
    const discount = coupon ? 100 : 0;

    if (elTotal) elTotal.innerText = base + add - discount;
  };

  const updateQty = (n) => {
    qty = Math.max(1, n);
    if (elQty) elQty.innerText = qty;
    recalcTotal();
  };

  if (elPlus) elPlus.onclick = () => updateQty(qty + 1);
  if (elMinus) elMinus.onclick = () => updateQty(qty - 1);

  updateQty(qty);

  // =====================
  // トッピング（チーズ / クーポン）
  // =====================
  const elCheese = $("cheese");
  const elCoupon = $("coupon");

  [elCheese, elCoupon].forEach((btn) => {
    if (!btn) return;
    btn.onclick = () => {
      btn.classList.toggle("active");
      recalcTotal();
    };
  });

  // =====================
  // 注文追加ボタン
  // =====================
  const elAdd = $("add");
  if (elAdd) {
    elAdd.onclick = () => {
      const cheese = elCheese.classList.contains("active");
      const coupon = elCoupon.classList.contains("active");

      const order = {
        id: uuid(),
        qty,
        cheese,
        coupon,
        total: qty * 400 + (cheese ? 100 : 0) - (coupon ? 100 : 0),
      };

      tempOrders.push(order);
      renderMiddle();
    };
  }

  // =====================
  // 注文確定（サーバへ送信）
  // =====================
  const elConfirmAll = $("confirmAll");

  if (elConfirmAll) {
    elConfirmAll.onclick = () => {
      if (tempOrders.length === 0) return alert("注文がありません！");

      const qtyAll = tempOrders.reduce((s, o) => s + o.qty, 0);
      const cheeseAll = tempOrders.filter((o) => o.cheese).length;
      const couponUsed = tempOrders.some((o) => o.coupon); // 1注文につき1回だけ適用

      const total =
        qtyAll * 400 +
        cheeseAll * 100 -
        (couponUsed ? 100 : 0);

      const toppingsList = tempOrders
        .map((o) => {
          const t = [
            o.cheese ? "チーズ" : "",
            o.coupon ? "クーポン" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return t || "なし";
        })
        .join(" / ");

      const newOrder = {
        id: uuid(),
        qty: qtyAll,
        toppings: toppingsList,
        total,
        status: "未調理",
        coupon: couponUsed ? 1 : 0,
        items: tempOrders.map((o) => ({
          qty: o.qty,
          cheese: o.cheese,
          coupon: o.coupon,
          total: o.total,
        })),
      };

      socket.emit("newOrder", newOrder);

      tempOrders = [];
      renderMiddle();
    };
  }

  // =====================
  // 中央：注文一覧
  // =====================
  const renderMiddle = () => {
    const tbody = document.querySelector("#orderTable tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    tempOrders.forEach((o, i) => {
      const toppings =
        [
          o.cheese ? "チーズ" : "",
          o.coupon ? "クーポン" : "",
        ]
          .filter(Boolean)
          .join(" ") || "なし";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${o.qty}</td>
        <td>${toppings}</td>
        <td>未確定</td>
        <td><button class="delete-temp" data-index="${i}">削除</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".delete-temp").forEach((btn) => {
      btn.onclick = (e) => {
        const i = Number(e.target.dataset.index);
        tempOrders.splice(i, 1);
        renderMiddle();
      };
    });
  };

  // =====================
  // サーバ同期
  // =====================
  const elCustomerCount = $("customerCount");

  socket.on("init", (d) => {
    kitchenOrders = Array.isArray(d.kitchenOrders) ? d.kitchenOrders.slice() : [];
    sortKitchenDesc();
    if (elCustomerCount)
      elCustomerCount.innerText = d.customerCount ?? kitchenOrders.length;
    renderKitchen();
  });

  socket.on("updateOrders", (d) => {
    console.log("🔥 updateOrders 受信:", d);

    kitchenOrders = Array.isArray(d.kitchenOrders) ? d.kitchenOrders.slice() : [];
    sortKitchenDesc();

    const elCustomerCount = document.getElementById("customerCount");
    if (elCustomerCount)
      elCustomerCount.innerText = d.customerCount ?? kitchenOrders.length;

    renderKitchen();
  });

  const sortKitchenDesc = () => {
    kitchenOrders = kitchenOrders
      .map((o) => ({ ...o, num: Number(o.num || 0) }))
      .sort((a, b) => b.num - a.num);
  };

  // =====================
  // 調理リスト
  // =====================
  const elKitchenList = $("kitchenList");

  const renderKitchen = () => {
    if (!elKitchenList) return;

    elKitchenList.innerHTML = "";

    kitchenOrders.forEach((o) => {
      const summary = Array.isArray(o.items)
        ? o.items
          .map((it) => {
            const t = [
              it.cheese ? "チーズ" : "",
              it.coupon ? "クーポン" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `${it.qty}個 ${t || "なし"}`;
          })
          .join(" / ")
        : `${o.qty || 1}個 ${o.toppings || "なし"}`;

      const li = document.createElement("li");
      li.innerHTML = `
        <span>№${o.num}｜${summary}｜${o.status}</span>
        <button class="delete-btn">🗑 削除</button>
      `;

      li.querySelector(".delete-btn").onclick = () => {
        if (confirm(`№${o.num} をキャンセルしますか？`)) {
          socket.emit("updateStatus", { id: o.id, action: "cancel" });
        }
      };

      elKitchenList.appendChild(li);
    });
  };

  // =====================
  // 時計
  // =====================
  const elClock = $("clock");
  if (elClock) {
    const tick = () =>
    (elClock.innerText = new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    }));
    tick();
    setInterval(tick, 1000);
  }

  // =====================
  // レシート印刷（PDF）
  // =====================
  socket.on("printReceipt", (order) => {
    console.log("レシート印刷受信", order);

    const url =
      `/api/receipt-print?num=${order.num}` +
      `&qty=${order.qty}` +
      `&toppings=${encodeURIComponent(order.toppings)}` +
      `&total=${order.total}`;

    window.open(url, "_blank");
  });

});
