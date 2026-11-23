"auto";

// =====================================
// AuToFishing - Safety Diagnostic Starter
// AutoX.js | No automatic game taps
// =====================================

var APP_NAME = "AuToFishing";
var VERSION = "0.1.0";

function say(message) {
    try {
        toastLog("[" + APP_NAME + "] " + message);
    } catch (e) {
        log("[" + APP_NAME + "] " + message);
    }
}

function stopWithError(message, error) {
    var detail = message;
    if (error) detail += ": " + error;
    say(detail);
    log(detail);
}

function runDiagnostic() {
    say("เริ่มโหมดตรวจสอบความปลอดภัย v" + VERSION);
    say("โหมดนี้ยังไม่ส่งคำสั่งแตะหน้าจอ");

    var granted = false;

    try {
        granted = requestScreenCapture(false);
    } catch (e) {
        stopWithError("ขอสิทธิ์จับภาพหน้าจอไม่สำเร็จ", e);
        return;
    }

    if (!granted) {
        say("ไม่ได้รับสิทธิ์จับภาพหน้าจอ จึงหยุดการทำงาน");
        return;
    }

    sleep(500);

    var screen = null;

    try {
        var start = new Date().getTime();
        screen = captureScreen();
        var captureMs = new Date().getTime() - start;

        if (!screen) {
            say("จับภาพหน้าจอไม่สำเร็จ");
            return;
        }

        var width = screen.getWidth();
        var height = screen.getHeight();

        log("[" + APP_NAME + "] Screen: " + width + "x" + height);
        log("[" + APP_NAME + "] Capture time: " + captureMs + " ms");

        say("ตรวจพบหน้าจอ " + width + "x" + height);
        say("เวลาจับภาพ " + captureMs + " ms");
        say("ผลตรวจสอบเบื้องต้นสำเร็จ");
    } catch (e) {
        stopWithError("เกิดข้อผิดพลาดระหว่างตรวจสอบหน้าจอ", e);
    } finally {
        if (screen) {
            try {
                screen.recycle();
            } catch (ignore) {}
        }
    }

    say("จบการตรวจสอบ — ยังไม่มีการกดตกปลาอัตโนมัติ");
}

try {
    runDiagnostic();
} catch (e) {
    stopWithError("ระบบหยุดเพื่อความปลอดภัย", e);
}
