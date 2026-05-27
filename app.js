// ==========================================================================
// PHẦN REALTIME SYNC ENGINE & GAMEPLAY LOGIC
// ==========================================================================

// Khởi tạo cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBU4qK-JNs-QIxaH5wNBWD4Gltw85UnEA4",
    authDomain: "liarbar-4adbf.firebaseapp.com",
    databaseURL: "https://liarbar-4adbf-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "liarbar-4adbf",
    storageBucket: "liarbar-4adbf.firebasestorage.app",
    messagingSenderId: "700046094078",
    appId: "1:700046094078:web:bf30d4ee8a0b7dac8a7faf",
    measurementId: "G-MC835DGS7C"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// State quản lý cục bộ của người chơi
let myRoomId = "";
let mySlotId = ""; 
let myName = "";
let currentRoomState = null;
let selectedCardsIndices = [];
let isEyeOfGodEnabled = false;

let lastKnownCardsCount = {}; 
let currentShownRoundCount = -1; // Cờ theo dõi vòng để kích hoạt thông báo lớn

// Đăng ký sự kiện DOM khi tải trang
document.querySelectorAll(".open-settings-trigger").forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        document.getElementById("settings-modal-layer").style.display = "flex";
    };
});
document.getElementById("close-settings-btn").onclick = () => { document.getElementById("settings-modal-layer").style.display = "none"; };
document.getElementById("btn-close-announce").onclick = () => { document.getElementById("pool-announcement-overlay").classList.remove("show"); };

document.getElementById("btn-apply-cheat").onclick = () => {
    let code = document.getElementById("cheat-code-input").value.trim();
    if(code === "admin123") {
        isEyeOfGodEnabled = true;
        document.getElementById("cheat-status-text").style.display = "block";
        document.getElementById("cheat-pile-view").style.display = "block";
        if(currentRoomState) updateGameplayUI(currentRoomState);
    } else {
        alert("Mã sai!");
    }
};

document.getElementById("btn-lobby-create").onclick = () => handleLobby("create");
document.getElementById("btn-lobby-join").onclick = () => handleLobby("join");
document.getElementById("btn-ready-action").onclick = () => toggleReady();

document.getElementById("btn-leave-room-waiting").onclick = () => showLeaveConfirmation();
document.getElementById("btn-game-leave").onclick = () => showLeaveConfirmation();

document.getElementById("btn-confirm-cancel").onclick = () => hideLeaveConfirmation();
document.getElementById("btn-confirm-accept").onclick = () => {
    hideLeaveConfirmation();
    executeLeaveRoom();
};

document.getElementById("btn-pass").onclick = () => actionPass();
document.getElementById("btn-play").onclick = () => actionPlay();
document.getElementById("btn-call").onclick = () => actionCall();
document.getElementById("btn-trigger").onclick = () => executePullTrigger();

function showLeaveConfirmation() {
    if (!myRoomId || !mySlotId) return;
    document.getElementById("leave-confirm-modal").classList.add("show");
}
function hideLeaveConfirmation() {
    document.getElementById("leave-confirm-modal").classList.remove("show");
}

function handleLobby(type) {
    myName = document.getElementById("username-input").value.trim();
    let inputRoom = document.getElementById("roomid-input").value.trim();

    if (!myName) return alert("Vui lòng điền tên hiển thị!");

    if (type === "create") {
        myRoomId = Math.floor(1000 + Math.random() * 9000).toString();
        mySlotId = "slot1";
        createFreshRoomOnFirebase(myRoomId);
    } else {
        if (!inputRoom) return alert("Hãy điền mã phòng!");
        myRoomId = inputRoom;
        tryJoinExistingRoom(myRoomId);
    }
}

function createFreshRoomOnFirebase(roomId) {
    const initialData = {
        id: roomId, status: "waiting", current_turn: "slot1", target_card: "K", discard_pile: "", round_counter: 0,
        pool_stats: { q: 0, k: 0, a: 0 },
        roulette_phase: { active: false, target_slot: "", status_text: "" },
        slots: {
            slot1: { name: myName, is_alive: true, is_ready: false, cards: "" },
            slot2: { name: "", is_alive: true, is_ready: false, cards: "" },
            slot3: { name: "", is_alive: true, is_ready: false, cards: "" },
            slot4: { name: "", is_alive: true, is_ready: false, cards: "" }
        }
    };
    database.ref('rooms/' + roomId).set(initialData).then(() => setupConnectionGuard(roomId));
}

function tryJoinExistingRoom(roomId) {
    database.ref('rooms/' + roomId).get().then((snapshot) => {
        if (!snapshot.exists()) return alert("Không tìm thấy mã phòng này!");
        let room = snapshot.val();
        if (room.status !== "waiting") return alert("Phòng đã bắt đầu ván rồi!");

        if (!room.slots.slot2.name) mySlotId = "slot2";
        else if (!room.slots.slot3.name) mySlotId = "slot3";
        else if (!room.slots.slot4.name) mySlotId = "slot4";
        else return alert("Phòng đã đầy đủ 4 người!");

        database.ref(`rooms/${roomId}/slots/${mySlotId}/name`).set(myName).then(() => setupConnectionGuard(roomId));
    });
}

function setupConnectionGuard(roomId) {
    database.ref(`rooms/${roomId}/slots/${mySlotId}/name`).onDisconnect().set("");
    database.ref(`rooms/${roomId}/slots/${mySlotId}/is_ready`).onDisconnect().set(false);
    database.ref(`rooms/${roomId}/slots/${mySlotId}/cards`).onDisconnect().set("");
    listenToRoom(roomId);
}

function executeLeaveRoom() {
    if (!myRoomId || !mySlotId) return;
    
    let targetRoomId = myRoomId;
    let targetSlotId = mySlotId;

    database.ref('rooms/' + targetRoomId).off('value');
    
    database.ref(`rooms/${targetRoomId}/slots/${targetSlotId}/name`).set("");
    database.ref(`rooms/${targetRoomId}/slots/${targetSlotId}/is_ready`).set(false);
    database.ref(`rooms/${targetRoomId}/slots/${targetSlotId}/cards`).set("");

    myRoomId = ""; mySlotId = "";
    selectedCardsIndices = []; currentRoomState = null;
    lastKnownCardsCount = {}; currentShownRoundCount = -1;

    document.getElementById("lobby-wait-box").style.display = "none";
    document.getElementById("lobby-setup-box").style.display = "block";
    document.getElementById("username-input").value = myName; 
    document.getElementById("roomid-input").value = "";

    let lobbyScreen = document.getElementById("lobby-screen");
    lobbyScreen.style.display = "flex"; lobbyScreen.style.opacity = "1";
    
    document.getElementById("game-room-header").innerText = `LIAR'S BAR - CHƯA VÀO PHÒNG`;
    document.getElementById("round-info").innerText = "Đã rời phòng thành công!";
    document.getElementById("corner-stats-box").style.display = "none";
    document.getElementById("pool-announcement-overlay").classList.remove("show");
    
    resetTableToBlank();
}

function resetTableToBlank() {
    document.getElementById("target-display").innerText = "Bài Yêu Cầu: -";
    document.getElementById("pile-count").innerText = "0";
    document.getElementById("center-pile").classList.remove("has-cards");
    document.getElementById("log-container").innerHTML = "";
    document.getElementById("my-cards-container").innerHTML = "";
    ['slot-top-ui', 'slot-left-ui', 'slot-right-ui', 'slot-bottom-ui'].forEach(id => {
        let slot = document.getElementById(id);
        if(slot) {
            slot.className = `player-slot ${id.split("-")[0]}-${id.split("-")[1]}`;
            slot.querySelector(".player-name").innerHTML = "Trống...";
            let container = slot.querySelector(".cards-container");
            if(container) container.innerHTML = "";
        }
    });
    document.getElementById("btn-pass").disabled = true;
    document.getElementById("btn-play").disabled = true;
    document.getElementById("btn-call").disabled = true;
}

function listenToRoom(roomId) {
    document.getElementById("lobby-setup-box").style.display = "none";
    document.getElementById("lobby-wait-box").style.display = "block";
    document.getElementById("wait-box-title").innerText = `PHÒNG CHỜ #${roomId}`;
    document.getElementById("game-room-header").innerText = `LIAR'S BAR - PHÒNG #${roomId}`;

    database.ref('rooms/' + roomId).on('value', (snapshot) => {
        let room = snapshot.val();
        if (!room) return;
        currentRoomState = room;

        if (room.status === "waiting") {
            document.getElementById("lobby-screen").style.display = "flex";
            document.getElementById("lobby-screen").style.opacity = "1";
            document.getElementById("corner-stats-box").style.display = "none";
            updateLobbyUI(room);
        } else if (room.status === "playing") {
            document.getElementById("lobby-screen").style.opacity = "0";
            setTimeout(() => { if(myRoomId === room.id) document.getElementById("lobby-screen").style.display = "none"; }, 400);
            updateGameplayUI(room);
        }
    });
}

function updateLobbyUI(room) {
    let container = document.getElementById("room-wait-list-ui");
    container.innerHTML = "";
    let readyCount = 0; let totalPlayers = 0;

    for (let id in room.slots) {
        let slot = room.slots[id];
        if (slot.name) {
            totalPlayers++;
            if (slot.is_ready) readyCount++;
            let statusText = slot.is_ready ? `<span class="status-ready">ĐÃ SẴN SÀNG ✓</span>` : `<span class="status-not-ready">CHƯA SẴN SÀNG...</span>`;
            let item = document.createElement("div");
            item.className = "wait-player-item";
            item.innerHTML = `<span>👤 ${slot.name} ${id === mySlotId ? '(Bạn)' : ''}</span> ${statusText}`;
            container.appendChild(item);
        }
    }

    let myReady = room.slots[mySlotId] ? room.slots[mySlotId].is_ready : false;
    let btn = document.getElementById("btn-ready-action");
    if (btn) {
        if (myReady) { btn.innerText = "HỦY SẴN SÀNG 🟥"; btn.style.backgroundColor = "#dc3545"; }
        else { btn.innerText = "TÔI SẴN SÀNG 🟩"; btn.style.backgroundColor = "#28a745"; }
    }

    if (mySlotId === "slot1" && totalPlayers === 4 && readyCount === 4) {
        triggerStartMatch(room.id);
    }
}

function toggleReady() {
    if(!mySlotId || !currentRoomState) return;
    let currentStatus = currentRoomState.slots[mySlotId].is_ready;
    database.ref(`rooms/${myRoomId}/slots/${mySlotId}/is_ready`).set(!currentStatus);
}

// Hàm khởi tạo pool 20 lá ngẫu nhiên (Q, K, A)
function generateRandomPool20() {
    let options = ["Q", "K", "A"];
    let pool = [];
    let countQ = 0, countK = 0, countA = 0;

    for(let i = 0; i < 20; i++) {
        let card = options[Math.floor(Math.random() * 3)];
        pool.push(card);
        if (card === "Q") countQ++;
        else if (card === "K") countK++;
        else if (card === "A") countA++;
    }
    return { pool, countQ, countK, countA };
}

function triggerStartMatch(roomId) {
    let poolObj = generateRandomPool20();
    let pool = poolObj.pool;

    let updates = {};
    updates[`rooms/${roomId}/status`] = "playing";
    updates[`rooms/${roomId}/current_turn`] = "slot1";
    updates[`rooms/${roomId}/target_card`] = ["Q", "K", "A"][Math.floor(Math.random() * 3)];
    updates[`rooms/${roomId}/discard_pile`] = "";
    updates[`rooms/${roomId}/round_counter`] = 1;
    updates[`rooms/${roomId}/pool_stats`] = { q: poolObj.countQ, k: poolObj.countK, a: poolObj.countA };
    updates[`rooms/${roomId}/logs`] = "Hệ thống: Vòng đấu bắt đầu! Đã khởi tạo bộ bài 20 lá ngẫu nhiên.";

    for (let id of ['slot1', 'slot2', 'slot3', 'slot4']) {
        let hand = [pool.pop(), pool.pop(), pool.pop(), pool.pop(), pool.pop()];
        updates[`rooms/${roomId}/slots/${id}/cards`] = hand.join(",");
        updates[`rooms/${roomId}/slots/${id}/is_alive`] = true;
        
        let chambers = [false, false, false, false, false, false];
        chambers[Math.floor(Math.random() * 6)] = true;
        updates[`rooms/${roomId}/slots/${id}/gun_chambers`] = chambers.join(",");
        updates[`rooms/${roomId}/slots/${id}/gun_index`] = 0;
    }
    database.ref().update(updates);
}

function getUISlotElement(slotId) {
    const order = ['slot1', 'slot2', 'slot3', 'slot4'];
    let myIdx = order.indexOf(mySlotId);
    let targetIdx = order.indexOf(slotId);
    let diff = (targetIdx - myIdx + 4) % 4;

    if (diff === 0) return document.getElementById("slot-bottom-ui");
    if (diff === 1) return document.getElementById("slot-left-ui");
    if (diff === 2) return document.getElementById("slot-top-ui");
    return document.getElementById("slot-right-ui");
}

function updateGameplayUI(room) {
    if(!mySlotId) return;

    // Cập nhật giao diện thống kê số lượng bài
    if(room.pool_stats) {
        document.getElementById("corner-q-val").innerText = room.pool_stats.q || 0;
        document.getElementById("corner-k-val").innerText = room.pool_stats.k || 0;
        document.getElementById("corner-a-val").innerText = room.pool_stats.a || 0;
        document.getElementById("corner-stats-box").style.display = "block";

        if (room.round_counter !== currentShownRoundCount) {
            currentShownRoundCount = room.round_counter;
            document.getElementById("announce-q-val").innerText = room.pool_stats.q || 0;
            document.getElementById("announce-k-val").innerText = room.pool_stats.k || 0;
            document.getElementById("announce-a-val").innerText = room.pool_stats.a || 0;
            document.getElementById("pool-announcement-overlay").classList.add("show");
        }
    }

    document.getElementById("target-display").innerText = `Bài Yêu Cầu: Bộ [ ${room.target_card} ]`;
    document.getElementById("round-info").innerText = `Lượt hiện tại: ${room.slots[room.current_turn].name || 'Đang chờ'}`;
    
    let pile = room.discard_pile ? room.discard_pile.split(";") : [];
    document.getElementById("pile-count").innerText = room.discard_pile ? pile.length : 0;
    let pileBox = document.getElementById("center-pile");
    if (pile.length > 0) pileBox.classList.add("has-cards");
    else pileBox.classList.remove("has-cards");

    let cheatPileText = document.getElementById("cheat-pile-view");
    if (isEyeOfGodEnabled && pile.length > 0) {
        let lastEntry = pile[pile.length - 1]; 
        let value = lastEntry.split(":")[1];
        let sender = room.slots[lastEntry.split(":")[0]].name;
        cheatPileText.innerText = `Úp cuối: ${value} (bởi ${sender})`;
        cheatPileText.style.display = "block";
    } else { cheatPileText.style.display = "none"; }

    let centerRect = pileBox.getBoundingClientRect();

    for (let id of ['slot1', 'slot2', 'slot3', 'slot4']) {
        let slotData = room.slots[id];
        let uiSlot = getUISlotElement(id);
        if(!uiSlot) continue;
        
        uiSlot.className = `player-slot slot-${uiSlot.id.split("-")[1]}`;
        if (room.current_turn === id) uiSlot.classList.add("active-turn");
        if (!slotData.is_alive) uiSlot.classList.add("dead");

        let nameZone = uiSlot.querySelector(".player-name");
        let bulletNum = (slotData.gun_index || 0) + 1;
        nameZone.innerHTML = `<span>👤 ${slotData.name || 'Đang đợi...'}</span><span style='font-size:10px;'>Phát: ${bulletNum}/6</span>`;

        let cardZone = uiSlot.querySelector(".cards-container");
        if (cardZone) {
            let cardsArr = slotData.cards ? slotData.cards.split(",").filter(Boolean) : [];
            
            let shouldAnimate = (!lastKnownCardsCount[id] || lastKnownCardsCount[id] === 0) && cardsArr.length > 0;
            lastKnownCardsCount[id] = cardsArr.length;

            cardZone.innerHTML = "";
            
            let slotRect = cardZone.getBoundingClientRect();
            let fromX = centerRect.left - slotRect.left;
            let fromY = centerRect.top - slotRect.top;

            cardsArr.forEach((cVal, idx) => {
                let cDiv = document.createElement("div");
                cDiv.classList.add("card");

                if (shouldAnimate) {
                    cDiv.classList.add("deal-animate");
                    cDiv.style.setProperty('--fly-from-x', `${fromX}px`);
                    cDiv.style.setProperty('--fly-from-y', `${fromY}px`);
                    cDiv.style.setProperty('--deal-delay', `${idx * 0.1}s`); 
                }

                if (id === mySlotId) {
                    cDiv.innerText = cVal;
                    if (selectedCardsIndices.includes(idx)) cDiv.classList.add("selected");
                    cDiv.onclick = () => {
                        if (room.current_turn !== mySlotId || !slotData.is_alive || room.roulette_phase.active) return;
                        let pos = selectedCardsIndices.indexOf(idx);
                        if (pos > -1) selectedCardsIndices.splice(pos, 1);
                        else if (selectedCardsIndices.length < 3) selectedCardsIndices.push(idx);
                        updateGameplayUI(room);
                    };
                } else {
                    if (isEyeOfGodEnabled) {
                        cDiv.classList.add("cheat-reveal"); cDiv.innerText = cVal;
                    } else {
                        cDiv.classList.add("card-back"); cDiv.innerText = "?";
                    }
                }
                cardZone.appendChild(cDiv);
            });
        }
    }

    let logBox = document.getElementById("log-container");
    logBox.innerHTML = `<div class="log-entry system">${room.logs || ""}</div>`;
    logBox.scrollTop = logBox.scrollHeight;

    let isMyTurn = (room.current_turn === mySlotId && room.slots[mySlotId].is_alive && !room.roulette_phase.active);
    document.getElementById("btn-pass").disabled = !isMyTurn;
    document.getElementById("btn-play").disabled = !isMyTurn || selectedCardsIndices.length === 0;
    document.getElementById("btn-call").disabled = !isMyTurn || !room.discard_pile;

    let rPhase = room.roulette_phase;
    let overlay = document.getElementById("roulette-overlay");
    if (rPhase && rPhase.active) {
        overlay.classList.add("show");
        document.getElementById("roulette-user-desc").innerText = `${room.slots[rPhase.target_slot].name} đang đối diện họng súng!`;
        document.getElementById("roulette-status").innerText = rPhase.status_text;
        document.getElementById("btn-trigger").disabled = (rPhase.target_slot !== mySlotId);
    } else { overlay.classList.remove("show"); }
}

function actionPass() {
    selectedCardsIndices = [];
    if (checkAllOutCards()) reDealNewRound();
    else passTurnToNext();
}

function actionPlay() {
    let room = currentRoomState;
    let cardsArr = room.slots[mySlotId].cards.split(",");
    
    selectedCardsIndices.sort((a, b) => b - a);
    let played = [];
    selectedCardsIndices.forEach(idx => { played.push(cardsArr.splice(idx, 1)[0]); });

    let currentPile = room.discard_pile ? room.discard_pile.split(";") : [];
    played.forEach(c => currentPile.push(`${mySlotId}:${c}`));

    let updates = {};
    updates[`rooms/${myRoomId}/slots/${mySlotId}/cards`] = cardsArr.join(",");
    updates[`rooms/${myRoomId}/discard_pile`] = currentPile.join(";");
    updates[`rooms/${myRoomId}/logs`] = `${room.slots[mySlotId].name} đánh ${played.length} lá (Khai: Bộ ${room.target_card}).`;
    
    selectedCardsIndices = [];
    database.ref().update(updates).then(() => passTurnToNext());
}

function actionCall() {
    let room = currentRoomState;
    let pileArr = room.discard_pile.split(";");
    let lastEntry = pileArr[pileArr.length - 1]; 
    let targetSlot = lastEntry.split(":")[0];

    let lastPlayerCardsPlayed = pileArr.filter(e => e.split(":")[0] === targetSlot);
    let isLying = lastPlayerCardsPlayed.some(e => e.split(":")[1] !== room.target_card);

    let updates = {};
    let loserSlot = isLying ? targetSlot : mySlotId;
    
    updates[`rooms/${myRoomId}/logs`] = `🚨 ${room.slots[mySlotId].name} BÓC PHỐT ${room.slots[targetSlot].name}! Kết quả: ${isLying ? 'Thành công!' : 'Thất bại!'}`;
    updates[`rooms/${myRoomId}/roulette_phase`] = { active: true, target_slot: loserSlot, status_text: "Chuẩn bị bóp cò súng..." };
    database.ref().update(updates);
}

function executePullTrigger() {
    database.ref(`rooms/${myRoomId}/roulette_phase/status_text`).set("Đang kéo búa khai hỏa...");
    document.getElementById("gun-wheel").classList.add("spinning");

    setTimeout(() => {
        let room = currentRoomState;
        if(!room || !myRoomId) return;
        
        let targetSlot = room.roulette_phase.target_slot;
        let slotData = room.slots[targetSlot];
        
        let chambers = slotData.gun_chambers.split(",").map(e => e === "true");
        let currentIndex = parseInt(slotData.gun_index || 0);

        let isDead = chambers[currentIndex];
        let finalStatusText = isDead ? "💥 ĐOÀNG!!! ĐẠN NỔ TUNG!" : "🔒 CẠCH! PHÁT ĐẠN XỊT!";
        let logText = isDead ? `💥 ĐOÀNG!!! Đan nổ tung. ${slotData.name} ĐÃ TỬ TRẬN!` : `🔒 CẠCH! Vỏ đạn rỗng. ${slotData.name} may mắn thoát chết!`;

        let visualUpdates = {};
        visualUpdates[`rooms/${myRoomId}/roulette_phase/status_text`] = finalStatusText;
        visualUpdates[`rooms/${myRoomId}/logs`] = logText;
        if (isDead) { visualUpdates[`rooms/${myRoomId}/slots/${targetSlot}/is_alive`] = false; }
        else { visualUpdates[`rooms/${myRoomId}/slots/${targetSlot}/gun_index`] = currentIndex + 1; }
        
        database.ref().update(visualUpdates);
        document.getElementById("gun-wheel").classList.remove("spinning");

        setTimeout(() => {
            if(!myRoomId) return;

            let clearUpdates = {};
            clearUpdates[`rooms/${myRoomId}/roulette_phase`] = { active: false, target_slot: "", status_text: "" };
            clearUpdates[`rooms/${myRoomId}/discard_pile`] = "";

            database.ref().update(clearUpdates).then(() => {
                if (!checkMatchOver()) {
                    if (checkAllOutCards()) reDealNewRound();
                    else {
                        database.ref(`rooms/${myRoomId}/target_card`).set(["Q", "K", "A"][Math.floor(Math.random() * 3)]);
                        passTurnToNext();
                    }
                }
            });
        }, 2000); 

    }, 1500); 
}

function passTurnToNext() {
    let room = currentRoomState;
    const order = ['slot1', 'slot2', 'slot3', 'slot4'];
    let currIdx = order.indexOf(room.current_turn);

    for (let i = 1; i <= 4; i++) {
        let nextIdx = (currIdx + i) % 4;
        let nextSlot = order[nextIdx];
        if (room.slots[nextSlot].is_alive && room.slots[nextSlot].name) {
            database.ref(`rooms/${myRoomId}/current_turn`).set(nextSlot);
            break;
        }
    }
}

function checkAllOutCards() {
    let room = currentRoomState;
    for (let id of ['slot1', 'slot2', 'slot3', 'slot4']) {
        let slot = room.slots[id];
        if (slot.name && slot.is_alive && slot.cards && slot.cards.split(",").filter(Boolean).length > 0) {
            return false;
        }
    }
    return true;
}

function reDealNewRound() {
    let poolObj = generateRandomPool20();
    let pool = poolObj.pool;
    let room = currentRoomState;

    let updates = {};
    updates[`rooms/${myRoomId}/target_card`] = ["Q", "K", "A"][Math.floor(Math.random() * 3)];
    updates[`rooms/${myRoomId}/discard_pile`] = "";
    updates[`rooms/${myRoomId}/round_counter`] = room.round_counter + 1;
    updates[`rooms/${myRoomId}/pool_stats`] = { q: poolObj.countQ, k: poolObj.countK, a: poolObj.countA };
    updates[`rooms/${myRoomId}/logs`] = "🔄 Cả bàn hết bài! Tự động tạo lại pool 20 lá ngẫu nhiên mới và phát bài.";

    for (let id of ['slot1', 'slot2', 'slot3', 'slot4']) {
        if (room.slots[id].is_alive && room.slots[id].name) {
            let hand = [pool.pop(), pool.pop(), pool.pop(), pool.pop(), pool.pop()];
            updates[`rooms/${myRoomId}/slots/${id}/cards`] = hand.join(",");
        } else {
            updates[`rooms/${myRoomId}/slots/${id}/cards`] = "";
        }
    }
    database.ref().update(updates);
}

function checkMatchOver() {
    let room = currentRoomState;
    let survivors = Object.keys(room.slots).filter(id => room.slots[id].name && room.slots[id].is_alive);

    if (survivors.length <= 1) {
        let winnerName = survivors.length === 1 ? room.slots[survivors[0]].name : "Không có ai";
        alert(`👑 TRẬN ĐẤU KẾT THÚC!\nNgười chiến thắng: ${winnerName}`);

        let updates = {};
        updates[`rooms/${myRoomId}/status`] = "waiting";
        updates[`rooms/${myRoomId}/round_counter`] = 0;
        for (let id of ['slot1', 'slot2', 'slot3', 'slot4']) {
            updates[`rooms/${myRoomId}/slots/${id}/is_ready`] = false;
            updates[`rooms/${myRoomId}/slots/${id}/is_alive`] = true;
            updates[`rooms/${myRoomId}/slots/${id}/cards`] = "";
        }
        database.ref().update(updates);
        return true;
    }
    return false;
}