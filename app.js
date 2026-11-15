"use strict";
/* ============ نظام إجازات شركة الحمد — النسخة المستقلة (تعمل بالضغط المزدوج) ============
   تنبيه أمني: هذه النسخة تعمل بالكامل داخل المتصفح وتحفظ البيانات في هذا الجهاز فقط.
   الحماية فيها أقوى من الأساسية (تشفير PBKDF2 + قفل المحاولات + مهلة الخمول)، لكنها
   لا تمنع شخصاً لديه وصول لجهاز التشغيل وخبرة تقنية من العبث بالبيانات.
   للحماية الكاملة استخدم نسخة الخادم (alhamad-leave-system). */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LEAVE_TYPES = { annual: "سنوية", sick: "مرضية", emergency: "عارضة", unpaid: "بدون راتب" };
const STATUS_LIST = ["pending", "approved", "rejected"];
const USERNAME_RE = /^[A-Za-z0-9_.]{3,32}$/;
const IDLE_MS = 30 * 60e3, PBKDF2_ITER = 210000;
const fmt = d => new Date(d + "T00:00:00").toLocaleDateString("ar-EG");

/* ---------- فحص دعم المتصفح ---------- */
let storageOk = true;
try { localStorage.setItem("hr2_test", "1"); localStorage.removeItem("hr2_test"); } catch { storageOk = false; }
if (!(window.crypto && crypto.subtle) || !storageOk) {
  document.body.innerHTML = `<section class="login-page"><div class="login-card"><div class="login-form-side">
    <h2 class="ttl">المتصفح غير مدعوم</h2>
    <p>افتح الملف بأحدث إصدار من Chrome أو Edge، وتأكد من السماح بحفظ بيانات الموقع (التخزين المحلي).</p>
  </div></div></section>`;
  throw new Error("unsupported browser");
}

/* ---------- التخزين ---------- */
const load = k => { try { const v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const DB = {
  get users() { return load("hr2_users"); }, set users(v) { store("hr2_users", v); },
  get reqs() { return load("hr2_requests"); }, set reqs(v) { store("hr2_requests", v); }
};
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

/* ---------- التشفير: PBKDF2-SHA256 مع salt عشوائي ---------- */
const enc = new TextEncoder();
const b2h = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const h2b = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b2h(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b2h(salt)}$${await pbkdf2(pw, salt, PBKDF2_ITER)}`;
}
function sameStr(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function verifyPw(pw, stored) {
  const m = /^pbkdf2\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(stored || "");
  if (!m) return false;
  return sameStr(await pbkdf2(pw, h2b(m[2]), +m[1]), m[3]);
}
let dummyHash = null;
const getDummy = async () => dummyHash || (dummyHash = await hashPw("dummy-" + uid()));

function passwordProblem(pw, username) {
  if (typeof pw !== "string") return "كلمة المرور غير صالحة";
  if (pw.length < 10) return "كلمة المرور يجب ألا تقل عن 10 أحرف";
  if (pw.length > 128) return "كلمة المرور طويلة جداً";
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return "يجب أن تحتوي كلمة المرور على حروف وأرقام";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "لا تضع اسم المستخدم داخل كلمة المرور";
  return null;
}
function randomPassword(len = 12) {
  const all = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const p = [...crypto.getRandomValues(new Uint32Array(len))].map(n => all[n % all.length]).join("");
    if (/[A-Za-z]/.test(p) && /\d/.test(p)) return p;
  }
}

/* ---------- الجلسة (تنتهي بعد 30 دقيقة خمول أو بإغلاق التبويب) ---------- */
const SESS = "hr2_sess";
function getSess() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESS) || "null");
    if (!s) return null;
    if (Date.now() - s.last > IDLE_MS) { sessionStorage.removeItem(SESS); return null; }
    return s;
  } catch { return null; }
}
function touch() { const s = getSess(); if (s) { s.last = Date.now(); sessionStorage.setItem(SESS, JSON.stringify(s)); } }
const me = () => { const s = getSess(); return s ? (DB.users.find(u => u.id === s.userId && u.active) || null) : null; };
["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, touch, { passive: true }));
setInterval(() => { if (!$("#appPage").hidden && !me()) showLogin("انتهت الجلسة بسبب عدم النشاط، سجّل الدخول من جديد"); }, 15000);

/* ---------- قفل المحاولات الخاطئة ---------- */
const getFails = () => { try { return JSON.parse(localStorage.getItem("hr2_fails") || "{}") || {}; } catch { return {}; } };
const setFails = o => localStorage.setItem("hr2_fails", JSON.stringify(o));

/* ---------- أدوات ---------- */
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000);
}
const userById = id => DB.users.find(u => u.id === id);
const usedAnnual = id => DB.reqs.filter(r => r.userId === id && r.type === "annual" && r.status !== "rejected").reduce((s, r) => s + r.days, 0);
const remaining = u => u.balance - usedAnnual(u.id);
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const dayNum = s => Date.parse(s + "T00:00:00Z") / 864e5;
const todayStr = () => new Date().toLocaleDateString("en-CA");
const requireMgr = () => { const u = me(); if (!u || u.role !== "manager") { toast("ليست لديك صلاحية"); return null; } return u; };

/* ---------- عرض الصفحات الرئيسية ---------- */
function hideAll() { ["setupPage", "loginPage", "appPage"].forEach(id => $("#" + id).hidden = true); }
function showLogin(msg) {
  hideAll(); $("#loginPage").hidden = false;
  const err = $("#loginError"); err.hidden = !msg; err.textContent = msg || "";
}
function showSetup() { hideAll(); $("#setupPage").hidden = false; }

/* ---------- إعداد أول مرة ---------- */
$("#setupForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (DB.users.length) { boot(); return; }              // الإعداد مرة واحدة فقط
  const err = $("#setupError"), btn = $("#setupBtn"); err.hidden = true;
  const name = $("#sName").value.trim(), username = $("#sUser").value.trim(), pw = $("#sPass").value;
  const fail = m => { err.textContent = m; err.hidden = false; };
  if (name.length < 2) return fail("أدخل الاسم الكامل");
  if (!USERNAME_RE.test(username)) return fail("اسم المستخدم: 3–32 حرفاً إنجليزياً أو أرقاماً أو (_ .)");
  if (pw !== $("#sPass2").value) return fail("تأكيد كلمة المرور غير مطابق");
  const prob = passwordProblem(pw, username); if (prob) return fail(prob);
  btn.disabled = true;
  DB.users = [{ id: uid(), name, username, passHash: await hashPw(pw), role: "manager", branch: "الإدارة العامة",
    grade: "مدير", balance: 21, active: true, mustChange: false }];
  btn.disabled = false; $("#setupForm").reset(); toast("تم إنشاء حساب المدير، سجّل الدخول"); showLogin();
});

/* ---------- تسجيل الدخول / الخروج ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#loginBtn"), err = $("#loginError"); btn.disabled = true; err.hidden = true;
  const showErr = m => { err.textContent = m; err.hidden = false; };
  try {
    const username = $("#loginUser").value.trim().toLowerCase().slice(0, 64), pw = $("#loginPass").value.slice(0, 200);
    const fails = getFails(), f = fails[username] || { n: 0, until: 0 };
    if (f.until > Date.now()) return showErr(`تم قفل المحاولات مؤقتاً، حاول بعد ${Math.ceil((f.until - Date.now()) / 60000)} دقيقة`);
    const u = DB.users.find(x => x.username.toLowerCase() === username);
    const ok = await verifyPw(pw, u ? u.passHash : await getDummy());
    if (!u || !ok) {
      f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; }
      fails[username] = f; setFails(fails);
      return showErr("اسم المستخدم أو كلمة المرور غير صحيحة");
    }
    if (!u.active) return showErr("هذا الحساب موقوف، تواصل مع المدير");
    delete fails[username]; setFails(fails);
    sessionStorage.setItem(SESS, JSON.stringify({ userId: u.id, last: Date.now() }));
    tab = ""; $("#loginForm").reset(); boot();
  } finally { btn.disabled = false; }
});
$("#logoutBtn").onclick = () => { sessionStorage.removeItem(SESS); showLogin(); };
$("#homeBtn").onclick = () => { tab = "new"; boot(); };
$("#lockBtn").onclick = () => { tab = "password"; boot(); };
$("#menuBtn").onclick = () => $("#appPage").classList.toggle("side-closed");

/* ---------- القائمة والتنقل ---------- */
const MENU = {
  employee: [["new", "تقديم طلب اجازة"], ["accepted", "عرض الاجازات المقبولة"],
             ["rejected", "عرض الاجازات المرفوضة"], ["pending", "عرض الاجازات المعلقة"]],
  manager:  [["new", "تقديم طلب اجازة"], ["approvals", "عرض الاجازات التي تحتاج موافقة"],
             ["accepted", "عرض الاجازات المقبولة"], ["rejected", "عرض الاجازات المرفوضة"],
             ["employees", "الموظفون وإنشاء الحسابات"]]
};
let tab = "", sideInit = false;

function boot() {
  if (!DB.users.length) return showSetup();
  const u = me();
  if (!u) return showLogin();
  hideAll(); $("#appPage").hidden = false;
  if (!sideInit) { $("#appPage").classList.toggle("side-closed", innerWidth < 800); sideInit = true; }
  $("#whoami").textContent = `${u.name} (${u.role === "manager" ? "مدير" : "موظف"})`;
  const menu = u.mustChange ? [] : MENU[u.role];
  if (u.mustChange) tab = "password";
  else if (!menu.some(m => m[0] === tab) && tab !== "password") tab = menu[0][0];
  $("#nav").innerHTML = menu.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("");
  $("#nav").onclick = e => {
    if (!e.target.dataset.t) return;
    tab = e.target.dataset.t; if (innerWidth < 800) $("#appPage").classList.add("side-closed"); boot();
  };
  $("#view").onclick = null;
  ({ new: viewNew, password: viewPassword, employees: viewEmployees, approvals: viewApprovals,
     accepted: x => viewList(x, "approved", "الاجازات المقبولة"),
     rejected: x => viewList(x, "rejected", "الاجازات المرفوضة"),
     pending: x => viewList(x, "pending", "الاجازات المعلقة") })[tab](u);
}

/* ---------- تقديم طلب إجازة ---------- */
function viewNew(u) {
  const today = todayStr();
  $("#view").innerHTML = `
  <div class="card"><h2>تقديم طلب اجازة</h2>
  <form id="leaveForm">
    <div class="form-grid">
      <label>أسم الموظف<input value="${esc(u.name)}" readonly></label>
      <label>الفرع<input value="${esc(u.branch || "—")}" readonly></label>
      <label>الدرجة الوظيفية<input value="${esc(u.grade || "—")}" readonly></label>
      <label>عدد الايام المتبقية للاجازة<input value="${remaining(u)}" readonly></label>
      <label>نوع الاجازة<select id="lType" required>
        <option value="" disabled selected></option>
        ${Object.entries(LEAVE_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>تفاصيل الاجازة<input id="lReason" placeholder="ادخل تفاصيل الاجازة" maxlength="300"></label>
      <label>تاريخ بداية الاجازة<input type="date" id="lFrom" min="${today}" required></label>
      <label>تاريخ نهاية الاجازة<input type="date" id="lTo" min="${today}" required></label>
    </div>
    <div id="lErr" class="error" hidden></div>
    <button class="btn-grad">تقديم الطلب</button>
  </form></div>`;
  $("#leaveForm").onsubmit = e => {
    e.preventDefault();
    const cur = me(); if (!cur) return boot();
    const err = $("#lErr"), fail = m => { err.textContent = m; err.hidden = false; };
    const type = $("#lType").value, from = $("#lFrom").value, to = $("#lTo").value, reason = $("#lReason").value.trim();
    if (!LEAVE_TYPES[type]) return fail("نوع الإجازة غير صالح");
    if (!isDate(from) || !isDate(to)) return fail("التاريخ غير صالح");
    if (reason.length > 300) return fail("التفاصيل طويلة (الحد 300 حرف)");
    if (from < todayStr()) return fail("لا يمكن تقديم إجازة بتاريخ سابق");
    const days = dayNum(to) - dayNum(from) + 1;
    if (days < 1) return fail("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
    if (days > 60) return fail("الحد الأقصى للطلب الواحد 60 يوماً");
    if (type === "annual" && days > remaining(cur)) return fail(`الرصيد المتبقي (${remaining(cur)} يوم) لا يكفي`);
    if (DB.reqs.some(r => r.userId === cur.id && r.status !== "rejected" && from <= r.to && to >= r.from)) return fail("يوجد طلب آخر لك يتداخل مع هذه الفترة");
    DB.reqs = [...DB.reqs, { id: uid(), userId: cur.id, type, from, to, days, reason, status: "pending", note: "", createdAt: new Date().toISOString() }];
    toast("تم إرسال الطلب"); tab = cur.role === "manager" ? "approvals" : "pending"; boot();
  };
}

/* ---------- قوائم الإجازات ---------- */
function viewList(u, status, title) {
  const isMgr = u.role === "manager", canCancel = status === "pending";
  const rows = DB.reqs.filter(r => r.status === status && (isMgr || r.userId === u.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#view").innerHTML = `<div class="card wide"><h2>${title}</h2>${rows.length ? `<div class="table-wrap"><table>
    <tr>${isMgr ? "<th>الموظف</th>" : ""}<th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>التفاصيل</th>
    ${status === "rejected" ? "<th>سبب الرفض</th>" : ""}${canCancel ? "<th></th>" : ""}</tr>
    ${rows.map(r => `<tr>${isMgr ? `<td>${esc((userById(r.userId) || {}).name || "—")}</td>` : ""}
      <td>${LEAVE_TYPES[r.type]}</td><td>${fmt(r.from)}</td><td>${fmt(r.to)}</td><td>${r.days}</td>
      <td class="wrap">${esc(r.reason || "—")}</td>
      ${status === "rejected" ? `<td class="wrap">${esc(r.note || "—")}</td>` : ""}
      ${canCancel ? `<td>${r.userId === u.id ? `<button class="btn danger sm" data-cancel="${esc(r.id)}">إلغاء</button>` : ""}</td>` : ""}</tr>`).join("")}
    </table></div>` : `<div class="empty">لا توجد طلبات</div>`}</div>`;
  $("#view").onclick = e => {
    const id = e.target.dataset.cancel, cur = me(); if (!id || !cur) return;
    DB.reqs = DB.reqs.filter(r => !(r.id === id && r.userId === cur.id && r.status === "pending"));
    toast("تم إلغاء الطلب"); boot();
  };
}

/* ---------- المدير: الاجازات التي تحتاج موافقة ---------- */
function viewApprovals(cur) {
  if (cur.role !== "manager") return;
  const rows = DB.reqs.filter(r => r.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $("#view").innerHTML = `<div class="card wide"><h2>الاجازات التي تحتاج موافقة (${rows.length})</h2>${rows.length ? `<div class="table-wrap"><table>
    <tr><th>الموظف</th><th>الفرع</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>المتبقي</th><th>التفاصيل</th><th>إجراء</th></tr>
    ${rows.map(r => { const u = userById(r.userId) || {}; return `<tr><td>${esc(u.name || "—")}</td><td>${esc(u.branch || "—")}</td>
      <td>${LEAVE_TYPES[r.type]}</td><td>${fmt(r.from)}</td><td>${fmt(r.to)}</td><td>${r.days}</td>
      <td>${u.id ? remaining(u) : "—"}</td><td class="wrap">${esc(r.reason || "—")}</td>
      <td>${r.userId === cur.id ? "طلبك الخاص" : `<div class="actions"><button class="btn ok sm" data-act="approved" data-id="${esc(r.id)}">موافقة</button>
      <button class="btn danger sm" data-act="rejected" data-id="${esc(r.id)}">رفض</button></div>`}</td></tr>`; }).join("")}
    </table></div>` : `<div class="empty">لا توجد طلبات بانتظار الموافقة</div>`}</div>`;
  $("#view").onclick = e => {
    const { act, id } = e.target.dataset; if (!act) return;
    const mgr = requireMgr(); if (!mgr) return;
    const r = DB.reqs.find(x => x.id === id);
    if (!r || r.status !== "pending") return toast("تم البت في هذا الطلب مسبقاً");
    if (r.userId === mgr.id) return toast("لا يمكنك البت في طلبك الخاص، يلزم مدير آخر");
    let note = "";
    if (act === "rejected") { note = prompt("سبب الرفض (اختياري):"); if (note === null) return; }
    DB.reqs = DB.reqs.map(x => x.id === id ? { ...x, status: act, note: note.trim().slice(0, 300), decidedBy: mgr.id } : x);
    toast("تم تحديث الطلب"); boot();
  };
}

/* ---------- المدير: الموظفون وإنشاء الحسابات ---------- */
function viewEmployees(cur) {
  if (cur.role !== "manager") return;
  const list = DB.users;
  $("#view").innerHTML = `
  <div class="card"><h2>إنشاء حساب موظف جديد</h2>
  <form id="newUser"><div class="form-grid">
    <label>الاسم الكامل<input id="nName" maxlength="80" required></label>
    <label>الفرع<input id="nBranch" maxlength="80" required></label>
    <label>الدرجة الوظيفية<input id="nGrade" maxlength="80" required></label>
    <label>رصيد الإجازة السنوي (يوم)<input id="nBal" type="number" min="0" max="365" value="21" required></label>
    <label>اسم المستخدم<input id="nUser" required pattern="[A-Za-z0-9_.]{3,32}" maxlength="32" autocomplete="off" title="3 أحرف على الأقل (إنجليزي أو أرقام)"></label>
    <label>كلمة المرور المؤقتة<input id="nPass" type="text" minlength="10" maxlength="128" autocomplete="off" required></label>
    <label>الصلاحية<select id="nRole"><option value="employee">موظف</option><option value="manager">مدير</option></select></label>
  </div>
  <p class="pw-hint">كلمة المرور: 10 أحرف على الأقل وتحتوي على حروف وأرقام. سيُجبر الموظف على تغييرها عند أول دخول.</p>
  <div id="nErr" class="error" hidden></div>
  <button class="btn-grad">إنشاء الحساب</button></form></div>

  <div class="card wide"><h2>الموظفون (${list.length})</h2><div class="table-wrap"><table>
  <tr><th>الاسم</th><th>المستخدم</th><th>الفرع</th><th>الدرجة</th><th>الصلاحية</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr>
  ${list.map(u => `<tr><td>${esc(u.name)}</td><td dir="ltr">${esc(u.username)}</td><td>${esc(u.branch || "—")}</td><td>${esc(u.grade || "—")}</td>
    <td><span class="badge ${u.role === "manager" ? "manager" : ""}">${u.role === "manager" ? "مدير" : "موظف"}</span></td>
    <td>${remaining(u)} / ${u.balance}</td>
    <td>${u.active ? "نشط" : '<span class="badge off">موقوف</span>'}</td>
    <td>${u.id === cur.id ? "—" : `<div class="actions"><button class="btn ghost sm" data-reset="${esc(u.id)}" data-name="${esc(u.name)}">إعادة كلمة المرور</button>
    <button class="btn ghost sm" data-toggle="${esc(u.id)}">${u.active ? "إيقاف" : "تفعيل"}</button></div>`}</td></tr>`).join("")}
  </table></div></div>

  <div class="card"><h2>نسخة احتياطية</h2>
  <p>البيانات محفوظة في هذا المتصفح على هذا الجهاز فقط. احتفظ بنسخة احتياطية دورياً، وخزّنها في مكان آمن لأنها تحوي بيانات الموظفين.</p>
  <div class="row"><button class="btn primary" id="expBtn">تنزيل نسخة احتياطية</button>
  <button class="btn ghost" id="impBtn">استعادة نسخة</button></div></div>`;

  $("#newUser").onsubmit = async e => {
    e.preventDefault();
    const mgr = requireMgr(); if (!mgr) return;
    const err = $("#nErr"), fail = m => { err.textContent = m; err.hidden = false; }; err.hidden = true;
    const name = $("#nName").value.trim(), branch = $("#nBranch").value.trim(), grade = $("#nGrade").value.trim();
    const username = $("#nUser").value.trim(), balance = Number($("#nBal").value), role = $("#nRole").value, pw = $("#nPass").value;
    if (name.length < 2 || !branch || !grade) return fail("أكمل الاسم والفرع والدرجة الوظيفية");
    if (!USERNAME_RE.test(username)) return fail("اسم المستخدم: 3–32 حرفاً إنجليزياً أو أرقاماً أو (_ .)");
    if (!Number.isInteger(balance) || balance < 0 || balance > 365) return fail("رصيد الإجازة بين 0 و365");
    if (!["employee", "manager"].includes(role)) return fail("الصلاحية غير صالحة");
    const prob = passwordProblem(pw, username); if (prob) return fail(prob);
    const passHash = await hashPw(pw);
    if (DB.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return fail("اسم المستخدم مستخدم مسبقاً");
    DB.users = [...DB.users, { id: uid(), name, username, passHash, role, branch, grade, balance, active: true, mustChange: true }];
    toast("تم إنشاء الحساب"); boot();
  };
  $("#view").onclick = e => {
    const { reset, toggle, name } = e.target.dataset;
    if (reset) openReset(reset, name);
    if (toggle) {
      const mgr = requireMgr(); if (!mgr || toggle === mgr.id) return;
      const t = userById(toggle); if (!t) return;
      if (t.active && t.role === "manager" && !DB.users.some(u => u.role === "manager" && u.active && u.id !== t.id)) return toast("لا يمكن إيقاف آخر مدير");
      DB.users = DB.users.map(u => u.id === toggle ? { ...u, active: !u.active } : u); boot();
    }
  };
  $("#expBtn").onclick = () => {
    if (!requireMgr()) return;
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), users: DB.users, requests: DB.reqs })], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `alhamad-leave-backup-${todayStr()}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#impBtn").onclick = () => { if (requireMgr()) $("#impFile").click(); };
}
function validBackup(o) {
  return !!o && Array.isArray(o.users) && Array.isArray(o.requests) &&
    o.users.every(u => u && typeof u.id === "string" && typeof u.name === "string" && USERNAME_RE.test(u.username || "") &&
      /^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(u.passHash || "") && ["employee", "manager"].includes(u.role) &&
      Number.isInteger(u.balance) && typeof u.active === "boolean") &&
    o.requests.every(r => r && typeof r.id === "string" && typeof r.userId === "string" && LEAVE_TYPES[r.type] &&
      isDate(r.from) && isDate(r.to) && Number.isInteger(r.days) && STATUS_LIST.includes(r.status) && typeof r.createdAt === "string") &&
    o.users.some(u => u.role === "manager" && u.active);
}
$("#impFile").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !requireMgr()) return;
  if (f.size > 5 * 1024 * 1024) return toast("الملف كبير جداً");
  const rd = new FileReader();
  rd.onload = () => {
    let o; try { o = JSON.parse(rd.result); } catch { return toast("الملف غير صالح"); }
    if (!validBackup(o)) return toast("ملف النسخة الاحتياطية غير صالح أو تالف");
    if (!confirm("سيتم استبدال كل البيانات الحالية بمحتوى النسخة. هل أنت متأكد؟")) return;
    DB.users = o.users; DB.reqs = o.requests; sessionStorage.removeItem(SESS);
    toast("تمت الاستعادة، سجّل الدخول من جديد"); showLogin();
  };
  rd.readAsText(f);
});

/* ---------- إعادة تعيين كلمة المرور (المدير فقط) ---------- */
let resetId = null;
function openReset(id, name) {
  if (!requireMgr()) return;
  resetId = id; $("#resetFor").textContent = "الموظف: " + name;
  $("#resetResult").hidden = true; $("#resetConfirm").hidden = false; $("#resetDialog").showModal();
}
$("#resetCancel").onclick = () => { $("#resetDialog").close(); $("#resetResult").textContent = ""; };
$("#resetConfirm").onclick = async () => {
  const mgr = requireMgr(); if (!mgr) return;
  const t = userById(resetId); if (!t || t.id === mgr.id) return;
  const temp = randomPassword(), h = await hashPw(temp);
  DB.users = DB.users.map(u => u.id === t.id ? { ...u, passHash: h, mustChange: true } : u);
  const f = getFails(); delete f[t.username.toLowerCase()]; setFails(f);
  const box = $("#resetResult"); box.textContent = "كلمة المرور المؤقتة (تُعرض مرة واحدة، سلّمها للموظف): " + temp;
  box.hidden = false; $("#resetConfirm").hidden = true;
};

/* ---------- تغيير كلمة المرور ---------- */
function viewPassword(u) {
  $("#view").innerHTML = `<div class="card narrow"><h2>تغيير كلمة المرور</h2>
  ${u.mustChange ? `<div class="notice">لأسباب أمنية يجب تغيير كلمة المرور المؤقتة قبل متابعة استخدام النظام.</div>` : ""}
  <form id="pwForm">
    <label>كلمة المرور الحالية<input type="password" id="pOld" autocomplete="current-password" maxlength="200" required></label>
    <label>كلمة المرور الجديدة<input type="password" id="pNew" autocomplete="new-password" minlength="10" maxlength="128" required></label>
    <label>تأكيد كلمة المرور<input type="password" id="pNew2" autocomplete="new-password" minlength="10" maxlength="128" required></label>
    <p class="pw-hint">10 أحرف على الأقل وتحتوي على حروف وأرقام.</p>
    <div id="pErr" class="error" hidden></div>
    <button class="btn-grad">حفظ</button></form></div>`;
  $("#pwForm").onsubmit = async e => {
    e.preventDefault(); const err = $("#pErr"), fail = m => { err.textContent = m; err.hidden = false; }; err.hidden = true;
    const cur = me(); if (!cur) return boot();
    const old = $("#pOld").value, nw = $("#pNew").value;
    if (!(await verifyPw(old, cur.passHash))) return fail("كلمة المرور الحالية غير صحيحة");
    if (nw !== $("#pNew2").value) return fail("تأكيد كلمة المرور غير مطابق");
    const prob = passwordProblem(nw, cur.username); if (prob) return fail(prob);
    if (nw === old) return fail("اختر كلمة مرور مختلفة عن الحالية");
    const h = await hashPw(nw);
    DB.users = DB.users.map(x => x.id === cur.id ? { ...x, passHash: h, mustChange: false } : x);
    toast("تم تغيير كلمة المرور"); tab = "new"; boot();
  };
}

boot();
