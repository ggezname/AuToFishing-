"auto";
// AuToFishing GitHub Loader — ggezname/AuToFishing-
var URL = "https://raw.githubusercontent.com/ggezname/AuToFishing-/main/main.js";
try {
    toastLog("กำลังดาวน์โหลด AuToFishing...");
    var res = http.get(URL);
    if (!res || res.statusCode !== 200) throw new Error("HTTP " + (res ? res.statusCode : "ไม่มีการตอบกลับ"));
    var code = res.body.string();
    if (!code || code.length < 10000) throw new Error("ไฟล์ดาวน์โหลดไม่สมบูรณ์");
    toastLog("ดาวน์โหลดสำเร็จ กำลังเปิด UI...");
    engines.execScript("AuToFishing", code);
} catch (e) {
    toastLog("AuToFishing Error: " + e);
    log("AuToFishing Loader Error: " + e);
}
