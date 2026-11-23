"auto";

// =====================================
// AuToFishing - User ROI Diagnostic
// AutoX.js | Region-limited capture | No game taps
// =====================================

var APP_NAME = "AuToFishing";
var VERSION = "0.2.0";

function say(message) {
    try { toastLog("[" + APP_NAME + "] " + message); }
    catch (e) { log("[" + APP_NAME + "] " + message); }
}

function stopWithError(message, error) {
    var detail = message + (error ? ": " + error : "");
    say(detail);
    log(detail);
}

// Parse "x,y,width,height" and reject unsafe/out-of-screen regions.
function parseRegion(text, screenWidth, screenHeight) {
    var parts = String(text || "").split(",");
    if (parts.length !== 4) throw new Error("กรุณากรอก 4 ค่า: x,y,width,height");

    var r = {
        x: Math.floor(Number(parts[0].trim())),
        y: Math.floor(Number(parts[1].trim())),
        width: Math.floor(Number(parts[2].trim())),
        height: Math.floor(Number(parts[3].trim()))
    };

    if (!isFinite(r.x) || !isFinite(r.y) ||
        !isFinite(r.width) || !isFinite(r.height)) {
        throw new Error("พิกัดต้องเป็นตัวเลขทั้งหมด");
    }
    if (r.x < 0 || r.y < 0 || r.width < 20 || r.height < 10) {
        throw new Error("กรอบพื้นที่เล็กเกินไปหรือมีพิกัดติดลบ");
    }
    if (r.x + r.width > screenWidth || r.y + r.height > screenHeight) {
        throw new Error("กรอบพื้นที่เกินขอบหน้าจอ " + screenWidth + "x" + screenHeight);
    }
    return r;
}

// Every candidate returned by a future detector MUST pass this guard.
function isPointInsideUserRegion(px, py, region) {
    return px >= region.x && px < region.x + region.width &&
           py >= region.y && py < region.y + region.height;
}

function runDiagnostic() {
    say("โหมดกำหนดพื้นที่สแกน v" + VERSION);
    say("ยังไม่ส่งคำสั่งแตะหน้าจอหรือกดตกปลา");

    var granted = false;
    try { granted = requestScreenCapture(false); }
    catch (e) {
        stopWithError("ขอสิทธิ์จับภาพหน้าจอไม่สำเร็จ", e);
        return;
    }
    if (!granted) {
        say("ไม่ได้รับสิทธิ์จับภาพหน้าจอ จึงหยุด");
        return;
    }

    sleep(500);

    var screen = null;
    var roi = null;

    try {
        var started = new Date().getTime();
        screen = captureScreen();
        var captureMs = new Date().getTime() - started;
        if (!screen) {
            say("จับภาพหน้าจอไม่สำเร็จ");
            return;
        }

        var sw = screen.getWidth();
        var sh = screen.getHeight();
        say("ขนาดหน้าจอ " + sw + "x" + sh);
        say("เวลาจับภาพ " + captureMs + " ms");

        var guide = "กำหนดกรอบแถบตกปลาในภาพหน้าจอ\n" +
            "กรอก x,y,width,height (หน่วยพิกเซล)\n" +
            "ตัวอย่าง: 180,620,520,100\n" +
            "x,y คือมุมซ้ายบนของกรอบ";
        var input = dialogs.rawInput(guide, "0,0," + sw + "," + sh);
        if (input === null || input === undefined || String(input).trim() === "") {
            say("ยกเลิกการกำหนดพื้นที่ — ไม่มีการสแกนต่อ");
            return;
        }

        var region = parseRegion(input, sw, sh);
        say("รับกรอบพื้นที่: x=" + region.x + " y=" + region.y +
            " w=" + region.width + " h=" + region.height);

        // Only this cropped bitmap is passed to subsequent vision processing.
        roi = images.clip(screen, region.x, region.y, region.width, region.height);
        if (!roi) {
            say("ตัดภาพเฉพาะพื้นที่ไม่สำเร็จ จึงหยุด");
            return;
        }

        log("[" + APP_NAME + "] ROI size: " +
            roi.getWidth() + "x" + roi.getHeight());
        log("[" + APP_NAME + "] Region guard ready: " +
            JSON.stringify(region));

        // Sanity-check the region boundary guard.
        var centerX = region.x + Math.floor(region.width / 2);
        var centerY = region.y + Math.floor(region.height / 2);
        var centerAccepted = isPointInsideUserRegion(centerX, centerY, region);
        var outsideRejected = !isPointInsideUserRegion(
            region.x + region.width, centerY, region
        );

        if (!centerAccepted || !outsideRejected) {
            say("ตรวจสอบขอบเขตพื้นที่ไม่ผ่าน — ปิดระบบเพื่อความปลอดภัย");
            return;
        }

        say("ผ่านการตรวจสอบกรอบพื้นที่และตัดภาพ ROI สำเร็จ");
        say("จุดที่ตรวจพบในอนาคตต้องอยู่ในกรอบนี้เท่านั้น");
        say("หมายเหตุ: รุ่นนี้ยังไม่มีตัวตรวจจับแถบแดง/ขาว และยังไม่กดเกม");
    } catch (e) {
        stopWithError("เกิดข้อผิดพลาดในการกำหนดพื้นที่สแกน", e);
    } finally {
        if (roi) {
            try { roi.recycle(); } catch (ignore1) {}
        }
        if (screen) {
            try { screen.recycle(); } catch (ignore2) {}
        }
    }

    say("จบการทดสอบพื้นที่ — ไม่มีการแตะหน้าจอเกม");
}

try { runDiagnostic(); }
catch (e) { stopWithError("ระบบหยุดเพื่อความปลอดภัย", e); }
