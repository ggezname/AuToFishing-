"auto";

// =====================================================
// AuToFishing v0.3.0 - ROI Vision Diagnostic
// AutoX.js | User-defined scan region | NO GAME TAPS
// =====================================================

var APP_NAME = "AuToFishing";
var VERSION = "0.3.0";
var SCAN_DURATION_MS = 20000;
var SCAN_INTERVAL_MS = 70;

function say(s) {
    try { toastLog("[" + APP_NAME + "] " + s); }
    catch (e) { log("[" + APP_NAME + "] " + s); }
}
function logLine(s) { log("[" + APP_NAME + "] " + s); }
function fail(s, e) {
    var m = s + (e ? ": " + e : "");
    say(m);
    logLine(m);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function parseRegion(input, sw, sh) {
    var p = String(input || "").split(",");
    if (p.length !== 4) throw new Error("ต้องกรอก x,y,width,height");
    var r = {
        x: Math.floor(Number(p[0].trim())),
        y: Math.floor(Number(p[1].trim())),
        width: Math.floor(Number(p[2].trim())),
        height: Math.floor(Number(p[3].trim()))
    };
    if (!isFinite(r.x) || !isFinite(r.y) ||
        !isFinite(r.width) || !isFinite(r.height))
        throw new Error("พิกัดต้องเป็นตัวเลข");
    if (r.x < 0 || r.y < 0 || r.width < 30 || r.height < 12)
        throw new Error("กรอบเล็กเกินไปหรือมีพิกัดติดลบ");
    if (r.x + r.width > sw || r.y + r.height > sh)
        throw new Error("กรอบเกินขอบจอ " + sw + "x" + sh);
    return r;
}

function inside(x, y, r) {
    return x >= r.x && x < r.x + r.width &&
           y >= r.y && y < r.y + r.height;
}

function redPixel(c) {
    var r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
    return r >= 135 && g <= 85 && b <= 85 &&
           (r - g) >= 70 && (r - b) >= 70;
}
function whitePixel(c) {
    var r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
    return r >= 205 && g >= 205 && b >= 205;
}

// Read a row without creating per-pixel Java objects.
function readRow(bitmap, y, buffer, width) {
    bitmap.getPixels(buffer, 0, width, 0, y, width, 1);
}

// Find repeated red horizontal runs on several scanlines.
// Requiring agreement across lines rejects isolated red UI elements.
function detectRedZone(bitmap) {
    var w = bitmap.getWidth(), h = bitmap.getHeight();
    var ys = [
        Math.floor(h * 0.30), Math.floor(h * 0.38),
        Math.floor(h * 0.46), Math.floor(h * 0.54),
        Math.floor(h * 0.62), Math.floor(h * 0.70)
    ];
    var buf = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w);
    var runs = [];
    var minRun = Math.max(7, Math.floor(w * 0.025));
    var maxRun = Math.floor(w * 0.72);

    for (var yi = 0; yi < ys.length; yi++) {
        var y = clamp(ys[yi], 0, h - 1);
        readRow(bitmap, y, buf, w);
        var start = -1;
        for (var x = 0; x <= w; x++) {
            var hit = x < w && redPixel(buf[x]);
            if (hit && start < 0) start = x;
            if (!hit && start >= 0) {
                var len = x - start;
                if (len >= minRun && len <= maxRun)
                    runs.push({ x1: start, x2: x - 1, y: y, width: len });
                start = -1;
            }
        }
    }

    if (runs.length < 2) return null;

    // Group line detections that overlap horizontally.
    runs.sort(function(a, b) { return a.x1 - b.x1; });
    var groups = [];
    for (var i = 0; i < runs.length; i++) {
        var run = runs[i], found = null;
        for (var j = 0; j < groups.length; j++) {
            var g = groups[j];
            var overlap = Math.min(g.maxX, run.x2) - Math.max(g.minX, run.x1);
            if (overlap >= Math.min(g.maxX - g.minX, run.width) * 0.45) {
                found = g; break;
            }
        }
        if (!found) {
            found = { minX: run.x1, maxX: run.x2, ys: [], count: 0 };
            groups.push(found);
        }
        found.minX = Math.min(found.minX, run.x1);
        found.maxX = Math.max(found.maxX, run.x2);
        found.ys.push(run.y);
        found.count++;
    }

    groups.sort(function(a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return (b.maxX - b.minX) - (a.maxX - a.minX);
    });
    var best = groups[0];
    if (!best || best.count < 2) return null;

    var sumY = 0;
    for (var k = 0; k < best.ys.length; k++) sumY += best.ys[k];
    return {
        minX: best.minX, maxX: best.maxX,
        cy: Math.round(sumY / best.ys.length),
        confidence: best.count / ys.length,
        lineHits: best.count
    };
}

// Locate a bright white target in the same horizontal track as the red zone.
function detectWhite(bitmap, red) {
    var w = bitmap.getWidth(), h = bitmap.getHeight();
    var y0 = clamp(red.cy, 1, h - 2);
    var bufA = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w);
    var bufB = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w);
    var bufC = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, w);
    readRow(bitmap, y0 - 1, bufA, w);
    readRow(bitmap, y0, bufB, w);
    readRow(bitmap, y0 + 1, bufC, w);

    var active = [], x = 0;
    while (x < w) {
        var votes = 0;
        if (whitePixel(bufA[x])) votes++;
        if (whitePixel(bufB[x])) votes++;
        if (whitePixel(bufC[x])) votes++;
        if (votes >= 2) {
            var st = x, score = 0;
            while (x < w) {
                votes = 0;
                if (whitePixel(bufA[x])) votes++;
                if (whitePixel(bufB[x])) votes++;
                if (whitePixel(bufC[x])) votes++;
                if (votes < 2) break;
                score += votes;
                x++;
            }
            if (x - st >= 2)
                active.push({ x1: st, x2: x - 1, cx: Math.round((st + x - 1) / 2), score: score });
        } else x++;
    }

    if (!active.length) return null;

    // Prefer the strongest white cluster close to or inside the detected red zone.
    active.sort(function(a, b) {
        var da = a.cx < red.minX ? red.minX - a.cx :
                 (a.cx > red.maxX ? a.cx - red.maxX : 0);
        var db = b.cx < red.minX ? red.minX - b.cx :
                 (b.cx > red.maxX ? b.cx - red.maxX : 0);
        if (da !== db) return da - db;
        return b.score - a.score;
    });
    return active[0];
}

function scanOne(screen, region) {
    var roi = null;
    try {
        roi = images.clip(screen, region.x, region.y, region.width, region.height);
        if (!roi) return { ok: false, reason: "ROI clip failed" };
        var bmp = roi.getBitmap();
        var red = detectRedZone(bmp);
        if (!red) return { ok: true, red: null, white: null };

        var white = detectWhite(bmp, red);
        // Convert ROI-local detections to full-screen coordinates.
        red.minX += region.x;
        red.maxX += region.x;
        red.cy += region.y;
        if (white) {
            white.x1 += region.x;
            white.x2 += region.x;
            white.cx += region.x;
            white.y = red.cy;
        }

        // Hard boundary check: reject any detector output outside user ROI.
        if (!inside(red.minX, red.cy, region) ||
            !inside(red.maxX, red.cy, region))
            return { ok: false, reason: "red detection outside user ROI" };
        if (white && !inside(white.cx, white.y, region))
            white = null;

        return { ok: true, red: red, white: white };
    } finally {
        if (roi) try { roi.recycle(); } catch (e) {}
    }
}

function run() {
    say("เริ่มตรวจจับภาพ v" + VERSION + " (โหมดไม่กดเกม)");
    var granted = false;
    try { granted = requestScreenCapture(false); }
    catch (e) { fail("ขอสิทธิ์จับภาพไม่สำเร็จ", e); return; }
    if (!granted) { say("ไม่ได้รับสิทธิ์จับภาพ"); return; }
    sleep(600);

    var first = null;
    try {
        first = captureScreen();
        if (!first) { say("จับภาพหน้าจอไม่สำเร็จ"); return; }
        var sw = first.getWidth(), sh = first.getHeight();
        say("หน้าจอ " + sw + "x" + sh);

        var prompt = "กำหนดกรอบให้ครอบคลุมแถบตกปลาทั้งแนว\n" +
            "กรอก x,y,width,height หน่วยพิกเซล\n" +
            "ตัวอย่างรูปแบบ: 180,620,520,100\n" +
            "ใช้พิกัดจากภาพหน้าจอขนาด " + sw + "x" + sh;
        var input = dialogs.rawInput(prompt, "0,0," + sw + "," + sh);
        if (input === null || String(input).trim() === "") {
            say("ยกเลิก — ไม่มีการสแกน");
            return;
        }

        var region = parseRegion(input, sw, sh);
        say("กำหนด ROI: (" + region.x + "," + region.y + ") " +
            region.width + "x" + region.height);
        logLine("ROI=" + JSON.stringify(region));
    } catch (e) {
        fail("กำหนดพื้นที่ไม่สำเร็จ", e);
        return;
    } finally {
        if (first) try { first.recycle(); } catch (e) {}
    }

    say("เริ่มสแกนเฉพาะกรอบที่เลือก 20 วินาที");
    say("ห้ามย้าย/หมุนจอระหว่างทดสอบ");
    var endAt = new Date().getTime() + SCAN_DURATION_MS;
    var frames = 0, redFrames = 0, whiteFrames = 0;
    var lastNotice = 0, totalCapture = 0, totalScan = 0;
    var lastRed = null, lastWhite = null;

    while (new Date().getTime() < endAt) {
        var screen = null;
        try {
            var t0 = new Date().getTime();
            screen = captureScreen();
            var t1 = new Date().getTime();
            if (!screen) {
                logLine("FRAME rejected: captureScreen returned null");
                sleep(SCAN_INTERVAL_MS);
                continue;
            }
            if (screen.getWidth() !== sw || screen.getHeight() !== sh) {
                say("ขนาดหน้าจอเปลี่ยนระหว่างทดสอบ — หยุดเพื่อความปลอดภัย");
                break;
            }

            var result = scanOne(screen, region);
            var t2 = new Date().getTime();
            frames++;
            totalCapture += (t1 - t0);
            totalScan += (t2 - t1);

            if (result.ok && result.red) {
                redFrames++;
                lastRed = result.red;
                if (result.white) {
                    whiteFrames++;
                    lastWhite = result.white;
                }
            }

            var now = new Date().getTime();
            if (now - lastNotice >= 1000) {
                lastNotice = now;
                if (result.red) {
                    var msg = "พบแดง X:" + result.red.minX + "-" + result.red.maxX +
                        " Y:" + result.red.cy + " | ";
                    msg += result.white ? ("ขาว X:" + result.white.cx) : "ยังไม่พบขาว";
                    say(msg);
                    logLine(msg + " redConfidence=" +
                        result.red.confidence.toFixed(2) +
                        " capture=" + (t1 - t0) + "ms scan=" + (t2 - t1) + "ms");
                } else {
                    say("กำลังสแกน ROI — ยังไม่พบแถบแดง");
                }
            }
        } catch (e) {
            logLine("Scan frame error: " + e);
        } finally {
            if (screen) try { screen.recycle(); } catch (e) {}
        }
        sleep(SCAN_INTERVAL_MS);
    }

    var avgCapture = frames ? Math.round(totalCapture / frames) : 0;
    var avgScan = frames ? Math.round(totalScan / frames) : 0;
    say("สแกนเสร็จ: " + frames + " เฟรม");
    say("พบแดง " + redFrames + " เฟรม | พบขาว " + whiteFrames + " เฟรม");
    say("เวลาเฉลี่ยจับภาพ " + avgCapture + "ms / วิเคราะห์ " + avgScan + "ms");
    if (lastRed) {
        say("ตำแหน่งแดงล่าสุด X " + lastRed.minX + "-" +
            lastRed.maxX + " Y " + lastRed.cy);
    }
    if (lastWhite) say("ตำแหน่งขาวล่าสุด X " + lastWhite.cx);
    say("จบโหมดทดสอบ — ไม่มีการกดเกมอัตโนมัติ");
}

try { run(); }
catch (e) { fail("ระบบหยุดเพื่อความปลอดภัย", e); }
