"auto";
// AuToFishing v0.4.0 — restored v4.3 UI + core with strict user ROI guard and multi-scanline detection.
// Source reference: ggezname/autofish (read-only). All active development is in ggezname/AuToFishing-.

const storage = storages.create("babyz_autofish_v2");

let CFG = storage.get("cfg", {
    rod: { x: 350, y: 650 },
    fishBtn: { x: 1030, y: 450 },
    barStart: { x: 380, y: 310 },
    barEnd: { x: 900, y: 390 },
    vaultBtn: { x: 640, y: 380 },
    bagTopLeft: { x: 160, y: 220 },
    bagBottomRight: { x: 450, y: 500 },
    vaultDrop: { x: 900, y: 350 },
    returnBtn: { x: 150, y: 650 },
    fishRounds: 10,
    vaultHoldTime: 5200,
    dragCooldown: 1000,
    rodMode: "manual",
    leadPx: 0
});

if (!CFG.fishRounds) CFG.fishRounds = 10;
if (!CFG.vaultHoldTime) CFG.vaultHoldTime = 5200;
if (!CFG.dragCooldown) CFG.dragCooldown = 1000;
if (!CFG.rodMode) CFG.rodMode = "manual";
if (CFG.leadPx === undefined) CFG.leadPx = 0;

function saveCfg() { storage.put("cfg", CFG); }

let isRunning = false, isTesting = false, isMinimized = false, isDebugOpen = false;
let botThread = null, testThread = null, hasCapturePerm = false;
let activePickers = [];
let debugLogs = [];
let pixelBuf = null, pixelBufLen = 0;

// พารามิเตอร์แปลงพิกัดหน้าจอ -> พิกัดภาพแคป (คำนวณจากคาลิเบรต 3 จุด)
let CAL = { ok: false, x0: 0, y0: 0, u0: 0, v0: 0, dudx: 1, dudy: 0, dvdx: 0, dvdy: 1, tag: "ยังไม่คาลิเบรต" };

function styleView(view, bgHex, radiusDp, strokeHex, strokePx) {
    try {
        let d = new android.graphics.drawable.GradientDrawable();
        d.setColor(colors.parseColor(bgHex));
        let density = context.getResources().getDisplayMetrics().density;
        d.setCornerRadius(radiusDp * density);
        if (strokeHex && strokePx) d.setStroke(strokePx, colors.parseColor(strokeHex));
        view.setBackground(d);
    } catch (e) {}
}

function getScreenInfo() {
    try {
        let dm = new android.util.DisplayMetrics();
        let disp = context.getSystemService(context.WINDOW_SERVICE).getDefaultDisplay();
        disp.getRealMetrics(dm);
        return { w: dm.widthPixels, h: dm.heightPixels, rot: disp.getRotation() };
    } catch (e) {
        return { w: device.height, h: device.width, rot: 1 };
    }
}

function getViewCenter(view, win) {
    try {
        let loc = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
        view.getLocationOnScreen(loc);
        return { x: Math.round(loc[0] + view.getWidth() / 2), y: Math.round(loc[1] + view.getHeight() / 2) };
    } catch (e) {
        return { x: Math.round(win.getX() + 22), y: Math.round(win.getY() + 22) };
    }
}

function getWindowOffset(win, rootView) {
    try {
        let loc = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
        rootView.getLocationOnScreen(loc);
        return { ox: loc[0] - win.getX(), oy: loc[1] - win.getY() };
    } catch (e) { return { ox: 0, oy: 0 }; }
}

function closeAllPickers() {
    let list = activePickers.slice();
    activePickers = [];
    setTimeout(() => {
        for (let i = 0; i < list.length; i++) { try { list[i].close(); } catch (e) {} }
    }, 50);
}

function createMaskPanel() {
    let w = floaty.rawWindow(<frame id="root" bg="#FF000000" w="*" h="*"/>);
    w.setTouchable(false); w.setPosition(0, 0); w.setSize(1, 1);
    return w;
}
let maskTop = createMaskPanel(), maskBot = createMaskPanel();
let maskLeft = createMaskPanel(), maskRight = createMaskPanel();
let maskOff = { ox: 0, oy: 0 };

function setMaskRect(win, x, y, w, h) {
    try {
        if (w <= 0 || h <= 0) {
            win.root.setVisibility(android.view.View.GONE);
            win.setSize(0, 0);
        } else {
            win.root.setVisibility(android.view.View.VISIBLE);
            win.setPosition(Math.round(x - maskOff.ox), Math.round(y - maskOff.oy));
            win.setSize(Math.round(w), Math.round(h));
        }
    } catch (e) {}
}

function hideBlackMask() {
    ui.run(() => {
        setMaskRect(maskTop, 0, 0, 0, 0);
        setMaskRect(maskBot, 0, 0, 0, 0);
        setMaskRect(maskLeft, 0, 0, 0, 0);
        setMaskRect(maskRight, 0, 0, 0, 0);
    });
}

function showBlackMask(scr) {
    let rx = Math.max(0, Math.min(CFG.barStart.x, CFG.barEnd.x));
    let ry = Math.max(0, Math.min(CFG.barStart.y, CFG.barEnd.y));
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x));
    let rh = Math.max(12, Math.abs(CFG.barEnd.y - CFG.barStart.y));
    let hx1 = Math.max(0, rx - 4), hy1 = Math.max(0, ry - 4);
    let hx2 = Math.min(scr.w, rx + rw + 4), hy2 = Math.min(scr.h, ry + rh + 4);
    let pad = 120;
    ui.run(() => {
        setMaskRect(maskTop, -pad, -pad, scr.w + pad * 2, hy1 + pad);
        setMaskRect(maskBot, -pad, hy2, scr.w + pad * 2, (scr.h - hy2) + pad);
        setMaskRect(maskLeft, -pad, hy1, hx1 + pad, hy2 - hy1);
        setMaskRect(maskRight, hx2, hy1, (scr.w - hx2) + pad, hy2 - hy1);
    });
}

setTimeout(() => { maskOff = getWindowOffset(maskTop, maskTop.root); hideBlackMask(); }, 150);

let mainWin = floaty.window(
    <vertical id="rootCard" padding="8" w="186">
        <horizontal id="headerBar" gravity="center_vertical" padding="6 4">
            <text id="titleTxt" text="⚡ AutoFish v4.3" textColor="#F8FAFC" textSize="12sp" textStyle="bold" layout_weight="1"/>
            <text id="btnMin" text=" − " textColor="#94A3B8" textSize="14sp" textStyle="bold" padding="4 1"/>
        </horizontal>
        <vertical id="statusCard" padding="6 5" marginTop="5">
            <text id="statusTxt" text="พร้อมทำงาน (v4.3)" textColor="#38BDF8" textSize="11sp" textStyle="bold" gravity="center"/>
            <text id="subTxt" text="คาลิเบรต 3 จุด + Turbo Strip" textColor="#94A3B8" textSize="9sp" gravity="center" marginTop="2"/>
        </vertical>
        <vertical id="bodyBox" marginTop="6">
            <horizontal>
                <text id="btnStart" text="▶ เริ่ม" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginRight="3"/>
                <text id="btnStop" text="⏸ หยุด" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginLeft="3"/>
            </horizontal>
            <horizontal marginTop="5">
                <text id="btnSetting" text="⚙ ตั้งจุด" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginRight="3"/>
                <text id="btnDebug" text="🐞 ดีบัก" textColor="#FFFFFF" textSize="11sp" textStyle="bold" gravity="center" h="34" layout_weight="1" marginLeft="3"/>
            </horizontal>
            <text id="btnClose" text="✖ ปิดโปรแกรม" textColor="#CBD5E1" textSize="10sp" textStyle="bold" gravity="center" h="28" marginTop="5"/>
        </vertical>
    </vertical>
);
mainWin.setPosition(30, 90);

ui.run(() => {
    styleView(mainWin.rootCard, "#EB0F172A", 14, "#38BDF8", 2);
    styleView(mainWin.headerBar, "#1E293B", 8, "#334155", 1);
    styleView(mainWin.btnMin, "#334155", 6);
    styleView(mainWin.statusCard, "#1E293B", 8, "#0F172A", 1);
    styleView(mainWin.btnStart, "#16A34A", 8);
    styleView(mainWin.btnStop, "#DC2626", 8);
    styleView(mainWin.btnSetting, "#2563EB", 8);
    styleView(mainWin.btnDebug, "#7C3AED", 8);
    styleView(mainWin.btnClose, "#334155", 8);
});

function bindWindowDrag(handleView, win) {
    let px = 0, py = 0, dx = 0, dy = 0;
    handleView.setOnTouchListener(function (view, event) {
        if (event.getAction() === event.ACTION_DOWN) { dx = event.getRawX(); dy = event.getRawY(); px = win.getX(); py = win.getY(); }
        else if (event.getAction() === event.ACTION_MOVE) { win.setPosition(Math.round(px + (event.getRawX() - dx)), Math.round(py + (event.getRawY() - dy))); }
        return true;
    });
}
bindWindowDrag(mainWin.titleTxt, mainWin);

mainWin.btnMin.click(() => {
    isMinimized = !isMinimized;
    ui.run(() => {
        mainWin.bodyBox.setVisibility(isMinimized ? android.view.View.GONE : android.view.View.VISIBLE);
        mainWin.btnMin.setText(isMinimized ? " + " : " − ");
    });
});

function setStatus(mainTxt, mainColor, subTxt) {
    ui.run(() => {
        mainWin.statusTxt.setText(mainTxt);
        mainWin.statusTxt.setTextColor(colors.parseColor(mainColor || "#F8FAFC"));
        if (subTxt !== undefined) mainWin.subTxt.setText(subTxt);
    });
}

let debugWin = floaty.window(
    <vertical id="dbgCard" padding="8" w="245">
        <horizontal id="dbgHead" gravity="center_vertical" padding="5 3">
            <text id="dbgTitle" text="🐞 Debug v4.3" textColor="#E9D5FF" textSize="11sp" textStyle="bold" layout_weight="1"/>
            <text id="dbgLiveBtn" text="สแกนสด" textColor="#FFFFFF" textSize="9sp" textStyle="bold" padding="6 3" marginRight="4"/>
            <text id="dbgHideBtn" text="✖" textColor="#CBD5E1" textSize="11sp" padding="5 2"/>
        </horizontal>
        <text id="dbgMeta" text="จอ:- | ภาพ:- | คาลิเบรต:-" textColor="#94A3B8" textSize="9sp" marginTop="4"/>
        <text id="dbgScan" text="ดำ:-% | แดง:- | ขาว:-" textColor="#FACC15" textSize="9sp" marginTop="2"/>
        <text id="dbgRgb" text="RGB:- | แคป:-ms สแกน:-ms" textColor="#38BDF8" textSize="9sp" marginTop="2"/>
        <text id="dbgLog" text="--- รอเริ่มทำงาน ---" textColor="#E2E8F0" textSize="9sp" marginTop="4" padding="5"/>
    </vertical>
);
debugWin.setPosition(230, 90);

ui.run(() => {
    styleView(debugWin.dbgCard, "#EB090D16", 12, "#7C3AED", 2);
    styleView(debugWin.dbgHead, "#1E1B4B", 6);
    styleView(debugWin.dbgLiveBtn, "#D97706", 6);
    styleView(debugWin.dbgHideBtn, "#334155", 6);
    styleView(debugWin.dbgLog, "#111827", 6, "#1F2937", 1);
    debugWin.dbgCard.setVisibility(android.view.View.GONE);
});
bindWindowDrag(debugWin.dbgTitle, debugWin);

function toggleDebugWin(forceState) {
    isDebugOpen = (forceState !== undefined) ? forceState : !isDebugOpen;
    ui.run(() => { debugWin.dbgCard.setVisibility(isDebugOpen ? android.view.View.VISIBLE : android.view.View.GONE); });
}

function addLog(msg) {
    let d = new Date();
    let p2 = (n) => (n < 10 ? "0" + n : "" + n);
    debugLogs.push("[" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + "] " + msg);
    if (debugLogs.length > 5) debugLogs.shift();
    if (!isDebugOpen) return;
    let joined = debugLogs.join("\n");
    ui.run(() => { debugWin.dbgLog.setText(joined); });
}

let lastDbgUi = 0;
function updateDebugMetrics(info, force) {
    if (!isDebugOpen) return;
    let now = new Date().getTime();
    if (!force && (now - lastDbgUi < 130)) return;
    lastDbgUi = now;
    ui.run(() => {
        if (info.meta) debugWin.dbgMeta.setText(info.meta);
        if (info.scan) debugWin.dbgScan.setText(info.scan);
        if (info.rgb) debugWin.dbgRgb.setText(info.rgb);
    });
}

debugWin.dbgHideBtn.click(() => { isTesting = false; toggleDebugWin(false); });

debugWin.dbgLiveBtn.click(() => {
    if (isRunning) { toast("บอทกำลังรันอยู่ ดูค่าสดได้เลยครับ"); return; }
    if (isTesting) {
        isTesting = false;
        ui.run(() => debugWin.dbgLiveBtn.setText("สแกนสด"));
        addLog("หยุดสแกนสด");
        return;
    }
    isTesting = true; closeAllPickers(); hideBlackMask();
    ui.run(() => debugWin.dbgLiveBtn.setText("หยุดสแกน"));
    addLog("เริ่มสแกนสด (ปาเบ็ดเองเพื่อเช็ก)");

    testThread = threads.start(function () {
        try {
            let scr = getScreenInfo();
            if (!ensureCapture(scr)) { isTesting = false; return; }
            while (isTesting && !isRunning) {
                let t0 = new Date().getTime();
                let img = captureScreen();
                let t1 = new Date().getTime();
                let bar = findBarFast(img);
                let hitRes = null;
                if (bar.open && bar.redZone) {
                    hitRes = checkCatchFast(img, bar.redZone, bar.rx, bar.rw, Math.max(CFG.leadPx, 35), true);
                }
                let t2 = new Date().getTime();
                let rgbTxt = hitRes ? hitRes.centerRgb : bar.midRgb;

                updateDebugMetrics({
                    meta: "จอ:" + scr.w + "x" + scr.h + " ภาพ:" + img.getWidth() + "x" + img.getHeight() + " " + CAL.tag,
                    scan: "ดำ:" + bar.darkPct + "% | แดง:" + (bar.redZone ? (bar.redZone.minX + "-" + bar.redZone.maxX + " y" + bar.redZone.cy) : "ไม่เจอ") + " | ขาว:" + (hitRes && hitRes.whiteX >= 0 ? hitRes.whiteX : "-"),
                    rgb: "RGB:" + rgbTxt + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
                }, false);

                if (hitRes && hitRes.hitInRed) setStatus("⚡ ทับแดงแล้ว!", "#22C55E", "ขาว X=" + hitRes.hitX);
                else if (bar.redZone) setStatus("เจอแดง รอขาว", "#FACC15", "สแกน " + (t2 - t1) + "ms");
                else setStatus("ยังไม่เจอแถบ", "#94A3B8", "ดำ " + bar.darkPct + "% | RGB:" + bar.midRgb);
                sleep(20);
            }
        } catch (e) { addLog("TestErr: " + e); }
        finally { isTesting = false; ui.run(() => debugWin.dbgLiveBtn.setText("สแกนสด")); }
    });
});

function openPointPicker(keyName, labelName) {
    closeAllPickers();
    toast("ลากเป้าไปวางที่: " + labelName + " แล้วกด ยืนยัน");
    let win = floaty.rawWindow(
        <vertical id="root" gravity="center">
            <text id="crosshair" text="+" textSize="26sp" textColor="#FFFFFF" w="42" h="42" gravity="center"/>
            <text id="btnConfirm" text="✔ ยืนยัน" textSize="10sp" textStyle="bold" textColor="#FFFFFF" padding="8 5" marginTop="3" gravity="center"/>
        </vertical>
    );
    activePickers.push(win);
    ui.run(() => {
        styleView(win.crosshair, "#AAEF4444", 21, "#FFFFFF", 2);
        styleView(win.btnConfirm, "#16A34A", 8, "#FFFFFF", 1);
    });
    win.setPosition(Math.round(CFG[keyName] ? Math.max(0, CFG[keyName].x - 30) : 300), Math.round(CFG[keyName] ? Math.max(0, CFG[keyName].y - 21) : 200));
    bindWindowDrag(win.crosshair, win);
    win.btnConfirm.click(() => {
        try {
            CFG[keyName] = getViewCenter(win.crosshair, win);
            saveCfg();
            toast("บันทึกแล้ว: " + labelName);
            addLog("ตั้งจุด " + labelName);
        } catch (err) { toast("Error: " + err); }
        finally { closeAllPickers(); }
    });
}

function openDualPointPicker(key1, key2, labelName) {
    closeAllPickers();
    let isBagGrid = (key1 === "bagTopLeft" && key2 === "bagBottomRight");
    toast(isBagGrid
        ? "ลาก +1 และ +2 กำหนดกรอบกระเป๋า ดูจุด 1-16 ให้ตรงกลางแต่ละช่อง แล้วกดยืนยัน"
        : "ลาก +1 (ซ้ายบน) และ +2 (ขวาล่าง) ให้กรอบเขียวทับพอดี แล้วกด ยืนยัน");

    let boxWin = floaty.rawWindow(
        <frame id="root" w="*" h="*">
            <text id="boxLabel" text="กรอบสแกน" textColor="#FFFFFF" textSize="9sp" gravity="center"/>
        </frame>
    );
    boxWin.setTouchable(false);
    boxWin.setPosition(0, 0);
    boxWin.setSize(40, 40);

    let win1 = floaty.rawWindow(
        <vertical gravity="center">
            <text id="crosshair" text="+1" textSize="14sp" textStyle="bold" textColor="#FFFFFF" w="40" h="40" gravity="center"/>
            <text id="btnCancel" text="ยกเลิก" textSize="9sp" textColor="#FFFFFF" padding="6 4" marginTop="3" gravity="center"/>
        </vertical>
    );
    let win2 = floaty.rawWindow(
        <vertical gravity="center">
            <text id="crosshair" text="+2" textSize="14sp" textStyle="bold" textColor="#FFFFFF" w="40" h="40" gravity="center"/>
            <text id="btnConfirm" text="✔ ยืนยัน" textSize="9sp" textStyle="bold" textColor="#FFFFFF" padding="6 4" marginTop="3" gravity="center"/>
        </vertical>
    );
    activePickers.push(boxWin, win1, win2);

    ui.run(() => {
        styleView(boxWin.root, "#4422C55E", 4, "#22C55E", 3);
        styleView(win1.crosshair, "#CCEF4444", 20, "#FFFFFF", 2);
        styleView(win1.btnCancel, "#475569", 6);
        styleView(win2.crosshair, "#CC0EA5E9", 20, "#FFFFFF", 2);
        styleView(win2.btnConfirm, "#16A34A", 6);
        if (isBagGrid) boxWin.boxLabel.setText("กระเป๋า 4x4 • จุดเก็บ 1-16");
    });

    let x1 = CFG[key1] ? Math.max(0, CFG[key1].x - 25) : 250;
    let y1 = CFG[key1] ? Math.max(0, CFG[key1].y - 20) : 200;
    let x2 = CFG[key2] ? Math.max(0, CFG[key2].x - 25) : 550;
    let y2 = CFG[key2] ? Math.max(0, CFG[key2].y - 20) : 260;
    if (Math.abs(x2 - x1) < 50 && Math.abs(y2 - y1) < 30) {
        x2 = x1 + 200;
        y2 = y1 + 45;
    }
    win1.setPosition(Math.round(x1), Math.round(y1));
    win2.setPosition(Math.round(x2), Math.round(y2));

    let boxOff = { ox: 0, oy: 0 };
    let gridMarkers = [];
    let markerOffsets = [];

    if (isBagGrid) {
        for (let i = 0; i < 16; i++) {
            let marker = floaty.rawWindow(
                <text id="dot" text={String(i + 1)} textColor="#FFFFFF" textSize="9sp" textStyle="bold" gravity="center" w="30" h="30"/>
            );
            marker.setTouchable(false);
            marker.setPosition(0, 0);
            gridMarkers.push(marker);
            activePickers.push(marker);
            ui.run(() => styleView(marker.dot, (i % 2 === 0) ? "#DD16A34A" : "#DD2563EB", 15, "#FFFFFF", 1));
        }
    }

    function updateBox() {
        try {
            let p1 = getViewCenter(win1.crosshair, win1);
            let p2 = getViewCenter(win2.crosshair, win2);
            let left = Math.min(p1.x, p2.x);
            let top = Math.min(p1.y, p2.y);
            boxWin.setPosition(Math.round(left - boxOff.ox), Math.round(top - boxOff.oy));
            boxWin.setSize(Math.max(12, Math.abs(p2.x - p1.x)), Math.max(12, Math.abs(p2.y - p1.y)));

            if (isBagGrid && markerOffsets.length === 16) {
                let stepX = (p2.x - p1.x) / 3;
                let stepY = (p2.y - p1.y) / 3;
                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 4; col++) {
                        let index = row * 4 + col;
                        let px = p1.x + col * stepX;
                        let py = p1.y + row * stepY;
                        let off = markerOffsets[index];
                        gridMarkers[index].setPosition(
                            Math.round(px - off.ox - 15),
                            Math.round(py - off.oy - 15)
                        );
                    }
                }
            }
        } catch (e) {}
    }

    function dragUpdate(win) {
        let px = 0, py = 0, dx = 0, dy = 0;
        win.crosshair.setOnTouchListener(function (v, e) {
            if (e.getAction() === e.ACTION_DOWN) {
                dx = e.getRawX(); dy = e.getRawY();
                px = win.getX(); py = win.getY();
            } else if (e.getAction() === e.ACTION_MOVE) {
                win.setPosition(
                    Math.round(px + (e.getRawX() - dx)),
                    Math.round(py + (e.getRawY() - dy))
                );
                updateBox();
            }
            return true;
        });
    }
    dragUpdate(win1);
    dragUpdate(win2);

    setTimeout(() => {
        boxOff = getWindowOffset(boxWin, boxWin.root);
        if (isBagGrid) {
            markerOffsets = [];
            for (let i = 0; i < gridMarkers.length; i++) {
                markerOffsets.push(getWindowOffset(gridMarkers[i], gridMarkers[i].dot));
            }
        }
        updateBox();
    }, 180);

    win1.btnCancel.click(() => {
        toast("ยกเลิกการตั้งค่า");
        closeAllPickers();
    });
    win2.btnConfirm.click(() => {
        try {
            CFG[key1] = getViewCenter(win1.crosshair, win1);
            CFG[key2] = getViewCenter(win2.crosshair, win2);
            saveCfg();
            toast("บันทึกกรอบ " + labelName + " เรียบร้อย!");
            addLog("ตั้งกรอบ " + labelName);
        } catch (err) {
            toast("Error: " + err);
        } finally {
            closeAllPickers();
        }
    });
}
function previewScanBox() {
    let rx = Math.min(CFG.barStart.x, CFG.barEnd.x), ry = Math.min(CFG.barStart.y, CFG.barEnd.y);
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x)), rh = Math.max(15, Math.abs(CFG.barEnd.y - CFG.barStart.y));
    let boxWin = floaty.rawWindow(<frame id="root" w="*" h="*"><text text="กรอบสแกนจริง" textColor="#FFFFFF" textSize="9sp" gravity="center"/></frame>);
    boxWin.setTouchable(false); boxWin.setPosition(0, 0);
    ui.run(() => styleView(boxWin.root, "#4422C55E", 4, "#22C55E", 3));
    setTimeout(() => {
        let off = getWindowOffset(boxWin, boxWin.root);
        boxWin.setPosition(Math.round(rx - off.ox), Math.round(ry - off.oy));
        boxWin.setSize(rw, rh);
    }, 100);
    setTimeout(() => { try { boxWin.close(); } catch (e) {} }, 3500);
}

mainWin.btnSetting.click(() => {
    if (isRunning || isTesting) { toast("กรุณากดหยุดก่อนตั้งค่าครับ"); return; }
    hideBlackMask();
    let rodLabel = CFG.rodMode === "manual" ? "ถือเบ็ดเอง" : (CFG.rodMode === "always" ? "กดช่อง 3 เสมอ" : "เช็กปุ่มตก");
    let items = [
        "1. ช่องเบ็ดตกปลา (ช่อง 3)",
        "2. ปุ่มสีแดง 'ตก'",
        "3. แถบตกปลา (เลือก 2 จุดพร้อมกรอบ)",
        "4. ปุ่มเปิดคลัง (ACCESS VAULT)",
        "5. กระเป๋า 4x4 (เลือก 2 จุดพร้อมกรอบ)",
        "6. จุดวางของในคลัง (ฝั่งขวา)",
        "7. ปุ่ม RETURN TO GAME",
        "8. จำนวนรอบตกปลา (ตอนนี้ " + CFG.fishRounds + " รอบ)",
        "9. โหมดถือเบ็ดช่อง 3 (" + rodLabel + ")",
        "10. ระยะดักหน้าขีดขาว (ตอนนี้ " + CFG.leadPx + " px)",
        "🎯 คาลิเบรตหน้าจอใหม่",
        "🔍 ดูกรอบแถบตกปลาจริง (3.5 วิ)"
    ];
    dialogs.select("ตั้งค่า AutoFish v4.3", items, function (index) {
        switch (index) {
            case 0: openPointPicker("rod", "ช่องเบ็ดตกปลา"); break;
            case 1: openPointPicker("fishBtn", "ปุ่มสีแดง 'ตก'"); break;
            case 2: openDualPointPicker("barStart", "barEnd", "แถบตกปลา"); break;
            case 3: openPointPicker("vaultBtn", "ปุ่มเปิดคลัง"); break;
            case 4: openDualPointPicker("bagTopLeft", "bagBottomRight", "กระเป๋า 4x4"); break;
            case 5: openPointPicker("vaultDrop", "จุดวางของในคลัง"); break;
            case 6: openPointPicker("returnBtn", "ปุ่ม RETURN TO GAME"); break;
            case 7:
                dialogs.rawInput("จำนวนรอบตกปลาก่อนเปิดคลัง", String(CFG.fishRounds), function (v) {
                    let n = parseInt(v);
                    if (!isNaN(n) && n >= 1 && n <= 100) { CFG.fishRounds = n; saveCfg(); toast("ตั้งเป็น " + n + " รอบ"); }
                });
                break;
            case 8:
                dialogs.select("เลือกโหมดถือเบ็ดช่อง 3", ["ถือเบ็ดเอง (ไม่สแกนปุ่ม - แนะนำ)", "กดช่อง 3 ก่อนรอบ 1 เสมอ", "เช็กปุ่ม 'ตก' ก่อนปิดจอดำ"], function (m) {
                    if (m === 0) CFG.rodMode = "manual";
                    else if (m === 1) CFG.rodMode = "always";
                    else if (m === 2) CFG.rodMode = "check";
                    if (m >= 0) { saveCfg(); toast("บันทึกโหมดถือเบ็ดแล้ว"); }
                });
                break;
            case 9:
                dialogs.rawInput("ระยะดักหน้าขีดขาวเป็น px (0 = กดเมื่อทับแดง, 15-30 = กดล่วงหน้าแก้ดีเลย์)", String(CFG.leadPx), function (v) {
                    let n = parseInt(v);
                    if (!isNaN(n) && n >= 0 && n <= 80) { CFG.leadPx = n; saveCfg(); toast("ตั้งระยะดักหน้า " + n + " px"); }
                });
                break;
            case 10:
                CAL.ok = false;
                toast("จะคาลิเบรตหน้าจอใหม่ในรอบถัดไป");
                break;
            case 11: previewScanBox(); break;
        }
    });
});



// ===== AUTOFISH CORE (ROI + multi-scanline improvements) =====
// ==========================================
// 5. ระบบคาลิเบรต 3 จุดทั่วทั้งภาพ (แก้ Letterbox / หมุนจอ / สเกล 100%)
// ==========================================

// Validate the user's scan ROI before calibration or any game automation.
function validateUserScanRegion(scr) {
    if (!CFG.barStart || !CFG.barEnd) throw new Error("ยังไม่ได้กำหนดกรอบแถบตกปลา");
    let x1 = Math.min(CFG.barStart.x, CFG.barEnd.x);
    let y1 = Math.min(CFG.barStart.y, CFG.barEnd.y);
    let x2 = Math.max(CFG.barStart.x, CFG.barEnd.x);
    let y2 = Math.max(CFG.barStart.y, CFG.barEnd.y);
    if (![x1, y1, x2, y2].every(function(v) { return isFinite(v); })) throw new Error("พิกัดกรอบสแกนไม่ถูกต้อง");
    if (x1 < 0 || y1 < 0 || x2 - x1 < 20 || y2 - y1 < 12 || x2 > scr.w || y2 > scr.h) {
        throw new Error("กรอบสแกนอยู่นอกจอหรือเล็กเกินไป (" + scr.w + "x" + scr.h + ")");
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function ensureCapture(scr) {
    validateUserScanRegion(scr);
    if (!hasCapturePerm) {
        if (!requestScreenCapture(scr.w >= scr.h)) { toast("ไม่ได้รับสิทธิ์จับภาพหน้าจอ"); return false; }
        hasCapturePerm = true;
        sleep(800);
    }
    if (!CAL.ok) {
        calibrate3Points(scr);
    }
    return true;
}

function findMagentaCentroid(img) {
    let pt = images.findColor(img, "#FF00FF", { threshold: 40 });
    if (!pt) return null;
    let imgW = img.getWidth(), imgH = img.getHeight();
    let x1 = Math.max(0, pt.x - 45), y1 = Math.max(0, pt.y - 45);
    let x2 = Math.min(imgW - 1, pt.x + 45), y2 = Math.min(imgH - 1, pt.y + 45);
    let w = x2 - x1 + 1, h = y2 - y1 + 1;
    let buf = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w * h);
    img.getBitmap().getPixels(buf, 0, w, x1, y1, w, h);
    let sx = 0, sy = 0, cnt = 0;
    for (let ly = 0; ly < h; ly++) {
        let rowOff = ly * w;
        for (let lx = 0; lx < w; lx++) {
            let px = buf[rowOff + lx];
            let r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            if (r >= 200 && g <= 65 && b >= 200) { sx += (x1 + lx); sy += (y1 + ly); cnt++; }
        }
    }
    return cnt >= 8 ? { u: sx / cnt, v: sy / cnt } : null;
}

function calibrate3Points(scr) {
    hideBlackMask();
    let calWin = null;
    try {
        calWin = floaty.rawWindow(<frame id="box" bg="#FFFF00FF" w="44" h="44"/>);
        calWin.setTouchable(false);
        ui.run(() => { try { calWin.box.setBackgroundColor(colors.parseColor("#FFFF00FF")); } catch (e) {} });

        let targets = [
            { x: Math.round(scr.w * 0.28), y: Math.round(scr.h * 0.28) },
            { x: Math.round(scr.w * 0.74), y: Math.round(scr.h * 0.28) },
            { x: Math.round(scr.w * 0.28), y: Math.round(scr.h * 0.72) }
        ];
        let P = [], Q = [];

        for (let i = 0; i < 3; i++) {
            calWin.setPosition(targets[i].x, targets[i].y);
            sleep(240);
            let realP = getViewCenter(calWin.box, calWin);
            sleep(100);
            let q = findMagentaCentroid(captureScreen());
            if (!q) { sleep(180); q = findMagentaCentroid(captureScreen()); }
            if (!q) throw "ไม่พบจุดคาลิเบรตที่ " + (i + 1);
            P.push(realP);
            Q.push(q);
        }

        try { calWin.close(); } catch (e) {}
        calWin = null;

        let dx1 = P[1].x - P[0].x, dy1 = P[1].y - P[0].y;
        let dx2 = P[2].x - P[0].x, dy2 = P[2].y - P[0].y;
        let det = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(det) < 1000) throw "det เล็กเกินไป";

        let du1 = Q[1].u - Q[0].u, dv1 = Q[1].v - Q[0].v;
        let du2 = Q[2].u - Q[0].u, dv2 = Q[2].v - Q[0].v;

        let dudx = (dy2 * du1 - dy1 * du2) / det;
        let dudy = (-dx2 * du1 + dx1 * du2) / det;
        let dvdx = (dy2 * dv1 - dy1 * dv2) / det;
        let dvdy = (-dx2 * dv1 + dx1 * dv2) / det;
        let scale = Math.sqrt(dudx * dudx + dvdx * dvdx);

        CAL = {
            ok: true, x0: P[0].x, y0: P[0].y, u0: Q[0].u, v0: Q[0].v,
            dudx: dudx, dudy: dudy, dvdx: dvdx, dvdy: dvdy,
            tag: "CAL✅" + scale.toFixed(2)
        };
        addLog("คาลิเบรตสำเร็จ! สเกล " + scale.toFixed(2));
        return;
    } catch (e) {
        if (calWin) { try { calWin.close(); } catch (e2) {} }
        addLog("CalFail: " + e);
        let img2 = captureScreen();
        let imgW = img2.getWidth(), imgH = img2.getHeight();
        if ((imgW >= imgH) === (scr.w >= scr.h)) {
            CAL = { ok: true, x0: 0, y0: 0, u0: 0, v0: 0, dudx: imgW / scr.w, dudy: 0, dvdx: 0, dvdy: imgH / scr.h, tag: "สำรองNORM" };
        } else {
            let s = imgW / scr.w;
            let topBar = (imgH - scr.h * s) / 2;
            CAL = { ok: true, x0: 0, y0: 0, u0: 0, v0: topBar, dudx: s, dudy: 0, dvdx: 0, dvdy: s, tag: "สำรองBOX" };
        }
    }
}

// ดึงพิกเซลจาก Bitmap เฉพาะกรอบเล็กๆ ที่สแกน (เร็ว 1-4ms ไม่สร้าง Object ในลูป)
function grabStrip(img, rx, ry, rw, rh) {
    let imgW = img.getWidth(), imgH = img.getHeight();
    let x1 = rx, y1 = ry, x2 = rx + Math.max(0, rw - 1), y2 = ry + Math.max(0, rh - 1);
    let c0x = CAL.u0 + (x1 - CAL.x0) * CAL.dudx + (y1 - CAL.y0) * CAL.dudy;
    let c0y = CAL.v0 + (x1 - CAL.x0) * CAL.dvdx + (y1 - CAL.y0) * CAL.dvdy;
    let c1x = CAL.u0 + (x2 - CAL.x0) * CAL.dudx + (y1 - CAL.y0) * CAL.dudy;
    let c1y = CAL.v0 + (x2 - CAL.x0) * CAL.dvdx + (y1 - CAL.y0) * CAL.dvdy;
    let c2x = CAL.u0 + (x1 - CAL.x0) * CAL.dudx + (y2 - CAL.y0) * CAL.dudy;
    let c2y = CAL.v0 + (x1 - CAL.x0) * CAL.dvdx + (y2 - CAL.y0) * CAL.dvdy;
    let c3x = CAL.u0 + (x2 - CAL.x0) * CAL.dudx + (y2 - CAL.y0) * CAL.dudy;
    let c3y = CAL.v0 + (x2 - CAL.x0) * CAL.dvdx + (y2 - CAL.y0) * CAL.dvdy;

    let minIx = Math.max(0, Math.min(imgW - 1, Math.floor(Math.min(c0x, c1x, c2x, c3x)) - 1));
    let maxIx = Math.max(0, Math.min(imgW - 1, Math.ceil(Math.max(c0x, c1x, c2x, c3x)) + 1));
    let minIy = Math.max(0, Math.min(imgH - 1, Math.floor(Math.min(c0y, c1y, c2y, c3y)) - 1));
    let maxIy = Math.max(0, Math.min(imgH - 1, Math.ceil(Math.max(c0y, c1y, c2y, c3y)) + 1));

    let iw = Math.max(1, maxIx - minIx + 1);
    let ih = Math.max(1, maxIy - minIy + 1);
    let need = iw * ih;
    if (!pixelBuf || pixelBufLen < need) {
        pixelBuf = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, need);
        pixelBufLen = need;
    }
    img.getBitmap().getPixels(pixelBuf, 0, iw, minIx, minIy, iw, ih);
    return { buf: pixelBuf, ix: minIx, iy: minIy, iw: iw, ih: ih };
}

function getPix(st, x, y) {
    let lx = Math.round(CAL.u0 + (x - CAL.x0) * CAL.dudx + (y - CAL.y0) * CAL.dudy) - st.ix;
    let ly = Math.round(CAL.v0 + (x - CAL.x0) * CAL.dvdx + (y - CAL.y0) * CAL.dvdy) - st.iy;
    if (lx < 0) lx = 0; else if (lx >= st.iw) lx = st.iw - 1;
    if (ly < 0) ly = 0; else if (ly >= st.ih) ly = st.ih - 1;
    return st.buf[ly * st.iw + lx];
}

function isDark(c) {
    return (((c >> 16) & 0xFF) <= 95 && ((c >> 8) & 0xFF) <= 90 && (c & 0xFF) <= 90);
}
function isPureRed(c) {
    let r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
    return (r >= 135 && g <= 85 && b <= 85 && (r - g) >= 70 && (r - b) >= 70);
}
function isWhiteOnRed(c) {
    return (((c >> 16) & 0xFF) >= 185 && ((c >> 8) & 0xFF) >= 150 && (c & 0xFF) >= 150);
}
function isBrightWhite(c) {
    return (((c >> 16) & 0xFF) >= 210 && ((c >> 8) & 0xFF) >= 210 && (c & 0xFF) >= 210);
}

function isHoldingRod() {
    let img = captureScreen();
    let cx = CFG.fishBtn.x, cy = CFG.fishBtn.y;
    let st = grabStrip(img, cx - 22, cy - 22, 45, 45);
    let pts = [[18, 0], [-18, 0], [0, 18], [0, -18], [13, 13], [-13, -13]];
    let hits = 0;
    for (let i = 0; i < pts.length; i++) {
        let c = getPix(st, cx + pts[i][0], cy + pts[i][1]);
        let r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
        if (r >= 130 && (r - g) >= 50 && (r - b) >= 50) hits++;
    }
    return hits >= 3;
}

// Multi-scanline detector: only scans the exact user-defined barStart/barEnd ROI.
function findBarFast(img) {
    let rx = Math.max(0, Math.min(CFG.barStart.x, CFG.barEnd.x));
    let ry = Math.max(0, Math.min(CFG.barStart.y, CFG.barEnd.y));
    let rw = Math.max(20, Math.abs(CFG.barEnd.x - CFG.barStart.x));
    let rh = Math.max(12, Math.abs(CFG.barEnd.y - CFG.barStart.y));
    let imgW = img.getWidth(), imgH = img.getHeight();
    if (rx < 0 || ry < 0 || rx + rw > imgW || ry + rh > imgH) {
        return { open: false, darkPct: 0, redZone: null, rx: rx, ry: ry, rw: rw, rh: rh, midRgb: "ROI_OUT_OF_SCREEN" };
    }

    let st = grabStrip(img, rx, ry, rw, rh);
    let ratios = [0.30, 0.38, 0.46, 0.54, 0.62, 0.70];
    let maxDarkPct = 0, midRgb = "-";
    let maxValidW = Math.floor(rw * 0.72);
    let minRun = Math.max(8, Math.floor(rw * 0.025));
    let runs = [];

    for (let i = 0; i < ratios.length; i++) {
        let y = Math.round(ry + rh * ratios[i]);
        if (i === 0) {
            let mc = getPix(st, rx + Math.floor(rw / 2), y);
            midRgb = ((mc >> 16) & 0xFF) + "," + ((mc >> 8) & 0xFF) + "," + (mc & 0xFF);
        }
        let darkCnt = 0, total = 0, runStart = -1;
        for (let x = rx; x <= rx + rw; x += 2) {
            let valid = x < rx + rw;
            let c = valid ? getPix(st, x, y) : 0;
            if (valid) {
                total++;
                if (isDark(c)) darkCnt++;
            }
            let red = valid && isPureRed(c);
            if (red && runStart < 0) runStart = x;
            if (!red && runStart >= 0) {
                let runEnd = Math.min(rx + rw - 1, x - 2);
                let runWidth = runEnd - runStart + 1;
                if (runWidth >= minRun && runWidth <= maxValidW) {
                    runs.push({ minX: runStart, maxX: runEnd, y: y, width: runWidth });
                }
                runStart = -1;
            }
        }
        let pct = total > 0 ? Math.round((darkCnt / total) * 100) : 0;
        if (pct > maxDarkPct) maxDarkPct = pct;
    }

    // Combine overlapping red runs from different scanlines.
    let groups = [];
    runs.sort(function(a, b) { return a.minX - b.minX; });
    for (let i = 0; i < runs.length; i++) {
        let run = runs[i], group = null;
        for (let j = 0; j < groups.length; j++) {
            let g = groups[j];
            let overlap = Math.min(g.maxX, run.maxX) - Math.max(g.minX, run.minX) + 1;
            let threshold = Math.max(4, Math.min(g.maxX - g.minX + 1, run.width) * 0.35);
            if (overlap >= threshold) { group = g; break; }
        }
        if (!group) {
            group = { minX: run.minX, maxX: run.maxX, ys: [], count: 0 };
            groups.push(group);
        }
        group.minX = Math.min(group.minX, run.minX);
        group.maxX = Math.max(group.maxX, run.maxX);
        group.ys.push(run.y);
        group.count++;
    }
    groups.sort(function(a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return (b.maxX - b.minX) - (a.maxX - a.minX);
    });

    let best = groups.length ? groups[0] : null;
    if (!best || best.count < 2) {
        return { open: maxDarkPct >= 20, darkPct: maxDarkPct, redZone: null, rx: rx, ry: ry, rw: rw, rh: rh, midRgb: midRgb };
    }
    let sumY = 0;
    for (let k = 0; k < best.ys.length; k++) sumY += best.ys[k];
    let cy = Math.round(sumY / best.ys.length);
    let redZone = { minX: best.minX, maxX: best.maxX, cy: cy, confidence: best.count / ratios.length, lineHits: best.count };

    // Hard ROI boundary guard: reject every detector result outside the user's selected scan box.
    if (redZone.minX < rx || redZone.maxX >= rx + rw || cy < ry || cy >= ry + rh) redZone = null;
    return { open: maxDarkPct >= 20 || !!redZone, darkPct: maxDarkPct, redZone: redZone, rx: rx, ry: ry, rw: rw, rh: rh, midRgb: midRgb };
}
function checkCatchFast(img, redZone, rx, rw, leadPx, needDbg) {
    let cy = redZone.cy;
    let rwZone = redZone.maxX - redZone.minX;
    let pad = Math.max(3, Math.floor(rwZone * 0.15));
    let inMin = redZone.minX + pad;
    let inMax = redZone.maxX - pad;
    if (inMax <= inMin) { inMin = redZone.minX + 2; inMax = redZone.maxX - 2; }

    let sMin = leadPx > 0 ? Math.max(rx + 2, redZone.minX - leadPx - 16) : inMin;
    let sMax = leadPx > 0 ? Math.min(rx + rw - 2, redZone.maxX + leadPx + 16) : inMax;
    let st = grabStrip(img, sMin, cy - 1, (sMax - sMin) + 1, 3);

    let hitInRed = false, hitX = -1, whiteX = -1, centerRgb = "-";
    for (let x = inMin; x <= inMax; x++) {
        let h = 0;
        if (isWhiteOnRed(getPix(st, x, cy))) h++;
        if (isWhiteOnRed(getPix(st, x, cy - 1))) h++;
        if (isWhiteOnRed(getPix(st, x, cy + 1))) h++;
        if (h >= 2) { hitInRed = true; hitX = x; whiteX = x; break; }
    }

    if (!hitInRed && leadPx > 0) {
        for (let x = sMin; x <= sMax; x += 2) {
            if (Math.abs(x - redZone.minX) <= 4 || Math.abs(x - redZone.maxX) <= 4) continue;
            if (isBrightWhite(getPix(st, x, cy)) && (isBrightWhite(getPix(st, x, cy - 1)) || isBrightWhite(getPix(st, x, cy + 1)))) {
                whiteX = x; break;
            }
        }
    }

    if (needDbg) {
        let mc = getPix(st, Math.round((inMin + inMax) / 2), cy);
        centerRgb = ((mc >> 16) & 0xFF) + "," + ((mc >> 8) & 0xFF) + "," + (mc & 0xFF);
    }
    let roiLeft = Math.min(CFG.barStart.x, CFG.barEnd.x);
    let roiRight = Math.max(CFG.barStart.x, CFG.barEnd.x);
    if (whiteX < roiLeft || whiteX > roiRight) whiteX = -1;
    if (hitX < roiLeft || hitX > roiRight) { hitInRed = false; hitX = -1; }
    return { hitInRed: hitInRed, hitX: hitX, whiteX: whiteX, centerRgb: centerRgb };
}

// ติดตามตำแหน่งแถบขาวตลอดแนวแถบ เพื่อวัดความเร็วจริงจากเวลาแต่ละเฟรม
function findWhiteOnTrack(img, rx, rw, cy) {
    let x1 = Math.max(rx + 2, 0);
    let x2 = Math.min(rx + rw - 2, img.getWidth() - 1);
    if (x2 <= x1) return -1;

    let st = grabStrip(img, x1, cy - 1, x2 - x1 + 1, 3);
    let bestX = -1, bestScore = 0;

    for (let x = x1; x <= x2; x += 2) {
        let score = 0;
        if (isBrightWhite(getPix(st, x, cy))) score++;
        if (isBrightWhite(getPix(st, x, cy - 1))) score++;
        if (isBrightWhite(getPix(st, x, cy + 1))) score++;
        if (score >= 2 && score > bestScore) {
            bestScore = score;
            bestX = x;
        }
    }
    return bestX;
}

function checkBarStillOpen(img, rx, rw, cy) {
    let st = grabStrip(img, rx, cy, rw, 1);
    let darkCnt = 0, totCnt = 0;
    for (let x = rx; x < rx + rw; x += 8) {
        totCnt++;
        if (isDark(getPix(st, x, cy))) darkCnt++;
    }
    return (totCnt > 0 && (darkCnt / totCnt) >= 0.15);
}

mainWin.btnDebug.click(() => { toggleDebugWin(); });

mainWin.btnStart.click(() => {
    if (isRunning) { toast("บอทกำลังทำงานอยู่แล้ว"); return; }
    isTesting = false; closeAllPickers(); isRunning = true;
    addLog("เริ่มทำงาน v4.3");
    setStatus("กำลังคาลิเบรต 3 จุด...", "#FACC15", "รอสักครู่ (ห้ามแตะจอ)");

    botThread = threads.start(function () {
        try {
            let scr = getScreenInfo();
            if (!ensureCapture(scr)) {
                isRunning = false;
                setStatus("หยุดอยู่", "#94A3B8", "ไม่ได้รับสิทธิ์จอ");
                return;
            }
            runBotLoop(scr);
        } catch (e) {
            if (isRunning) {
                addLog("ERR: " + e);
                toast("Error: " + e);
                setStatus("เกิดข้อผิดพลาด!", "#EF4444", String(e).substring(0, 26));
                isRunning = false;
            }
        } finally { hideBlackMask(); }
    });
});

mainWin.btnStop.click(() => {
    isRunning = false; isTesting = false;
    if (botThread && botThread.isAlive()) botThread.interrupt();
    if (testThread && testThread.isAlive()) testThread.interrupt();
    hideBlackMask();
    addLog("หยุดทำงาน (ปิดม่านดำ)");
    setStatus("หยุดการทำงานแล้ว", "#F87171", "กด ▶ เริ่ม เพื่อทำงานต่อ");
});

mainWin.btnClose.click(() => {
    isRunning = false; isTesting = false;
    if (botThread && botThread.isAlive()) botThread.interrupt();
    if (testThread && testThread.isAlive()) testThread.interrupt();
    hideBlackMask(); closeAllPickers();
    try { maskTop.close(); maskBot.close(); maskLeft.close(); maskRight.close(); } catch (e) {}
    try { debugWin.close(); } catch (e) {}
    mainWin.close(); exit();
});

function runBotLoop(scr) {
    while (isRunning) {
        if (CFG.rodMode === "always") {
            addLog("กดเบ็ดช่อง 3 (โหมดกดเสมอ)");
            click(CFG.rod.x, CFG.rod.y);
            sleep(900);
        } else if (CFG.rodMode === "check") {
            if (!isHoldingRod()) {
                addLog("ไม่พบปุ่มตก -> กดช่อง 3");
                click(CFG.rod.x, CFG.rod.y);
                sleep(900);
            }
        }

        showBlackMask(scr);
        addLog("เปิดม่านดำ (" + CAL.tag + ")");
        sleep(250);

        for (let r = 1; r <= CFG.fishRounds; r++) {
            if (!isRunning) return;
            playFishingRound(r, scr);
        }

        if (!isRunning) return;
        hideBlackMask();
        addLog("ครบรอบ -> ปิดม่านดำเข้าคลัง");
        sleep(350);
        storeItemsToVault();
    }
}

function playFishingRound(roundNum, scr) {
    setStatus("ปาเบ็ด...", "#4ADE80", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    addLog("รอบ " + roundNum + ": ปาเบ็ด");
    click(CFG.fishBtn.x, CFG.fishBtn.y);
    sleep(1100);

    setStatus("รอปลากินเบ็ด...", "#FACC15", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    let barState = null;
    let waitStart = new Date().getTime();

    while (isRunning && (new Date().getTime() - waitStart < 22000)) {
        let t0 = new Date().getTime();
        let img = captureScreen();
        let t1 = new Date().getTime();
        let st = findBarFast(img);
        let t2 = new Date().getTime();

        if (isDebugOpen) {
            updateDebugMetrics({
                meta: "จอ:" + scr.w + "x" + scr.h + " ภาพ:" + img.getWidth() + "x" + img.getHeight() + " " + CAL.tag,
                scan: "ดำ:" + st.darkPct + "% | แดง:" + (st.redZone ? (st.redZone.minX + "-" + st.redZone.maxX) : "รอ..."),
                rgb: "RGB:" + st.midRgb + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
            }, false);
        }

        if (st.open && st.redZone) {
            barState = st;
            addLog("เจอแดง X=" + st.redZone.minX + "-" + st.redZone.maxX + " (สแกน " + (t2 - t1) + "ms)");
            break;
        }
        sleep(25);
    }

    if (!barState || !isRunning) {
        addLog("หมดเวลารอปลากิน");
        return;
    }

    let redZone = barState.redZone;
    setStatus("🎯 เจอแดง! โหมด Turbo", "#FB923C", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
    let catchStart = new Date().getTime();
    let prevWhiteX = -1, frameCnt = 0, closedCnt = 0;
    let whiteSamples = [];
    let lastDirection = 0;

    while (isRunning && (new Date().getTime() - catchStart < 10000)) {
        let t0 = new Date().getTime();
        let img = captureScreen();
        let t1 = new Date().getTime();
        let res = checkCatchFast(img, redZone, barState.rx, barState.rw, CFG.leadPx, isDebugOpen);
        let whiteX = res.whiteX;
        if (whiteX < 0) whiteX = findWhiteOnTrack(img, barState.rx, barState.rw, redZone.cy);
        let t2 = new Date().getTime();
        let sampleTime = t2;

        let leadHit = false;
        if (whiteX >= 0) {
            if (whiteSamples.length > 0) {
                let last = whiteSamples[whiteSamples.length - 1];
                let dx = whiteX - last.x;
                let dt = sampleTime - last.t;
                if (dt > 0 && Math.abs(dx) >= 1) {
                    let dir = dx > 0 ? 1 : -1;
                    // ทิศกลับตัวมักเกิดเมื่อแถบขาวเด้งที่ขอบสนาม ให้เริ่มเก็บตัวอย่างใหม่
                    if (lastDirection !== 0 && dir !== lastDirection) whiteSamples = [];
                    lastDirection = dir;
                }
            }
            whiteSamples.push({ x: whiteX, t: sampleTime });
            if (whiteSamples.length > 5) whiteSamples.shift();
        }

        // ใช้เวลาจริงระหว่างภาพ ไม่สมมติว่า FPS คงที่
        if (!res.hitInRed && whiteSamples.length >= 3) {
            let first = whiteSamples[0];
            let last = whiteSamples[whiteSamples.length - 1];
            let dt = last.t - first.t;
            let vx = dt > 0 ? (last.x - first.x) / dt : 0; // pixels/ms
            if (Math.abs(vx) >= 0.015) {
                let eta = vx > 0
                    ? (redZone.minX - whiteX) / vx
                    : (redZone.maxX - whiteX) / vx;
                // ชดเชยเวลาจับภาพ + สแกน + เวลาสั่งแตะ โดยเผื่อเพิ่มเล็กน้อย
                let actionLeadMs = Math.max(25, (t2 - t0) + 20);
                if (eta >= 0 && eta <= actionLeadMs) leadHit = true;
            }
        }
        if (whiteX >= 0) prevWhiteX = whiteX;

        if (isDebugOpen) {
            updateDebugMetrics({
                scan: "แดง:" + redZone.minX + "-" + redZone.maxX + " | ขาว:" + (whiteX >= 0 ? whiteX : "-"),
                rgb: "RGB:" + res.centerRgb + " | แคป:" + (t1 - t0) + "ms สแกน:" + (t2 - t1) + "ms"
            }, false);
        }

        if (res.hitInRed || leadHit) {
            click(CFG.fishBtn.x, CFG.fishBtn.y);
            let tag = res.hitInRed ? ("ทับ X=" + res.hitX) : ("คาดการณ์ X=" + whiteX);
            addLog("⚡ กดตก! (" + tag + " " + (t1 - t0) + "+" + (t2 - t1) + "ms)");
            setStatus("⚡ กดจับปลาแล้ว!", "#22C55E", "รอบที่ " + roundNum + " / " + CFG.fishRounds);
            sleep(1800);
            return;
        }

        frameCnt++;
        if (frameCnt >= 12) {
            frameCnt = 0;
            if (!checkBarStillOpen(img, barState.rx, barState.rw, redZone.cy)) {
                closedCnt++;
                if (closedCnt >= 2) { addLog("แถบตกปลาปิดแล้ว"); sleep(900); return; }
            } else { closedCnt = 0; }
        }
    }
    addLog("หมดเวลา 10 วิ");
}

function storeItemsToVault() {
    setStatus("เปิดคลัง (5 วิ)...", "#C084FC", "กดค้าง ACCESS VAULT");
    addLog("กดเปิดคลังค้าง 5.2 วิ");
    press(CFG.vaultBtn.x, CFG.vaultBtn.y, CFG.vaultHoldTime);
    sleep(1500);

    let gapX = (CFG.bagBottomRight.x - CFG.bagTopLeft.x) / 3;
    let gapY = (CFG.bagBottomRight.y - CFG.bagTopLeft.y) / 3;
    let itemCount = 0;

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            if (!isRunning) return;
            itemCount++;
            setStatus("กำลังเก็บของเข้าคลัง", "#C084FC", "ช่องที่ " + itemCount + " / 16");
            swipe(Math.round(CFG.bagTopLeft.x + (col * gapX)), Math.round(CFG.bagTopLeft.y + (row * gapY)), CFG.vaultDrop.x, CFG.vaultDrop.y, 350);
            sleep(CFG.dragCooldown);
        }
    }

    setStatus("กลับเข้าเกม...", "#38BDF8", "กด RETURN TO GAME");
    addLog("เก็บครบ 16 ช่อง -> ปิดคลัง");
    click(CFG.returnBtn.x, CFG.returnBtn.y);
    sleep(1200);
}

setInterval(() => {}, 1000);
