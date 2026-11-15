"use strict";
/* ============ نظام إجازات شركة الحمد ============
   ملاحظة: البيانات تُحفظ في متصفح الجهاز (localStorage) كنسخة تجريبية.
   للاستخدام الفعلي بين عدة أجهزة يلزم ربط الموقع بخادم وقاعدة بيانات.
   الحساب الافتراضي للمدير:  admin  /  admin123
*/

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LEAVE_TYPES = { annual: "سنوية", sick: "مرضية", emergency: "عارضة", unpaid: "بدون راتب" };
const STATUS = { pending: "قيد المراجعة", approved: "موافق عليها", rejected: "مرفوضة" };

/* ---------- التخزين ---------- */
const DB = {
  get users() { return JSON.parse(localStorage.getItem("hr_users") || "[]"); },
  set users(v) { localStorage.setItem("hr_users", JSON.stringify(v)); },
  get reqs() { return JSON.parse(localStorage.getItem("hr_requests") || "[]"); },
  set reqs(v) { localStorage.setItem("hr_requests", JSON.stringify(v)); },
  get session() { return sessionStorage.getItem("hr_session"); },
  set session(v) { v ? sessionStorage.setItem("hr_session", v) : sessionStorage.removeItem("hr_session"); }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- التشفير ---------- */
async function hashPass(username, pass) {
  const text = "alhamad|" + username.toLowerCase() + "|" + pass;
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381; for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; // بديل بسيط
  return "x" + h.toString(16);
}

async function seed() {
  if (DB.users.length) return;
  DB.users = [{ id: uid(), name: "مدير شؤون العاملين", username: "admin",
    passHash: await hashPass("admin", "admin123"), role: "manager",
    branch: "الإدارة العامة", grade: "مدير", balance: 21, active: true }];
}

/* ---------- أدوات ---------- */
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800);
}
const me = () => DB.users.find(u => u.id === DB.session && u.active);
const userName = id => (DB.users.find(u => u.id === id) || {}).name || "—";
const userById = id => DB.users.find(u => u.id === id);
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5) + 1; }
function usedAnnual(userId) {
  return DB.reqs.filter(r => r.userId === userId && r.type === "annual" && r.status !== "rejected")
    .reduce((s, r) => s + r.days, 0);
}
const remaining = u => u.balance - usedAnnual(u.id);
const fmt = d => new Date(d).toLocaleDateString("ar-EG");

/* ---------- تسجيل الدخول ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = $("#loginUser").value.trim().toLowerCase();
  const hash = await hashPass(username, $("#loginPass").value);
  const u = DB.users.find(x => x.username.toLowerCase() === username && x.passHash === hash);
  const err = $("#loginError");
  if (!u) { err.textContent = "اسم المستخدم أو كلمة المرور غير صحيحة"; err.hidden = false; return; }
  if (!u.active) { err.textContent = "هذا الحساب موقوف، تواصل مع المدير"; err.hidden = false; return; }
  err.hidden = true; DB.session = u.id; tab = ""; $("#loginForm").reset(); boot();
});
$("#logoutBtn").onclick = () => { DB.session = null; boot(); };
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
  const u = me();
  $("#loginPage").hidden = !!u; $("#appPage").hidden = !u;
  if (!u) { sideInit = false; return; }
  if (!sideInit) { $("#appPage").classList.toggle("side-closed", innerWidth < 800); sideInit = true; }
  $("#whoami").textContent = `${u.name} (${u.role === "manager" ? "مدير" : "موظف"})`;

  const menu = MENU[u.role];
  if (!menu.some(m => m[0] === tab) && tab !== "password") tab = menu[0][0];
  $("#nav").innerHTML = menu.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("");
  $("#nav").onclick = e => {
    if (!e.target.dataset.t) return;
    tab = e.target.dataset.t; if (innerWidth < 800) $("#appPage").classList.add("side-closed"); boot();
  };

  $("#view").onclick = null;
  const views = {
    new: viewNew, password: viewPassword, employees: viewEmployees, approvals: viewApprovals,
    accepted: x => viewList(x, "approved", "الاجازات المقبولة"),
    rejected: x => viewList(x, "rejected", "الاجازات المرفوضة"),
    pending: x => viewList(x, "pending", "الاجازات المعلقة")
  };
  views[tab](u);
}

/* ---------- تقديم طلب إجازة ---------- */
function viewNew(u) {
  const today = new Date().toISOString().slice(0, 10);
  $("#view").innerHTML = `
  <div class="card"><h2>تقديم طلب اجازة</h2>
  <form id="leaveForm">
    <div class="form-grid">
      <label>أسم الموظف<input value="${esc(u.name)}" readonly></label>
      <label>الفرع<input value="${esc(u.branch || u.dept || "—")}" readonly></label>
      <label>الدرجة الوظيفية<input value="${esc(u.grade || (u.role === "manager" ? "مدير" : "—"))}" readonly></label>
      <label>عدد الايام المتبقية للاجازة<input value="${remaining(u)}" readonly></label>
      <label>نوع الاجازة<select id="lType" required>
        <option value="" disabled selected></option>
        ${Object.entries(LEAVE_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>تفاصيل الاجازة<input id="lReason" placeholder="ادخل تفاصيل الاجازة"></label>
      <label>تاريخ بداية الاجازة<input type="date" id="lFrom" min="${today}" required></label>
      <label>تاريخ نهاية الاجازة<input type="date" id="lTo" min="${today}" required></label>
    </div>
    <div id="lErr" class="error" hidden></div>
    <button class="btn-grad">تقديم الطلب</button>
  </form></div>`;
  $("#leaveForm").onsubmit = e => {
    e.preventDefault();
    const from = $("#lFrom").value, to = $("#lTo").value, type = $("#lType").value, err = $("#lErr");
    const days = daysBetween(from, to);
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (days < 1) return fail("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
    if (type === "annual" && days > remaining(u)) return fail(`الرصيد المتبقي (${remaining(u)} يوم) لا يكفي`);
    DB.reqs = [...DB.reqs, { id: uid(), userId: u.id, type, from, to, days, reason: $("#lReason").value.trim(),
      status: "pending", createdAt: new Date().toISOString() }];
    toast("تم إرسال الطلب"); tab = u.role === "manager" ? "approvals" : "pending"; boot();
  };
}

/* ---------- قوائم الإجازات (مقبولة / مرفوضة / معلقة) ---------- */
function viewList(u, status, title) {
  const isMgr = u.role === "manager";
  const rows = DB.reqs.filter(r => r.status === status && (isMgr || r.userId === u.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const canCancel = status === "pending";
  $("#view").innerHTML = `<div class="card wide"><h2>${title}</h2>${rows.length ? `<div class="table-wrap"><table>
    <tr>${isMgr ? "<th>الموظف</th>" : ""}<th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>التفاصيل</th>
    ${status === "rejected" ? "<th>سبب الرفض</th>" : ""}${canCancel ? "<th></th>" : ""}</tr>
    ${rows.map(r => `<tr>${isMgr ? `<td>${esc(userName(r.userId))}</td>` : ""}
      <td>${LEAVE_TYPES[r.type]}</td><td>${fmt(r.from)}</td><td>${fmt(r.to)}</td><td>${r.days}</td>
      <td class="wrap">${esc(r.reason || "—")}</td>
      ${status === "rejected" ? `<td class="wrap">${esc(r.note || "—")}</td>` : ""}
      ${canCancel ? `<td>${r.userId === u.id ? `<button class="btn danger sm" data-cancel="${r.id}">إلغاء</button>` : ""}</td>` : ""}</tr>`).join("")}
    </table></div>` : `<div class="empty">لا توجد طلبات</div>`}</div>`;
  $("#view").onclick = e => {
    const id = e.target.dataset.cancel; if (!id) return;
    DB.reqs = DB.reqs.filter(r => r.id !== id || r.userId !== u.id); toast("تم إلغاء الطلب"); boot();
  };
}

/* ---------- المدير: الاجازات التي تحتاج موافقة ---------- */
function viewApprovals(cur) {
  if (cur.role !== "manager") return;
  const rows = DB.reqs.filter(r => r.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $("#view").innerHTML = `<div class="card wide"><h2>الاجازات التي تحتاج موافقة (${rows.length})</h2>${rows.length ? `<div class="table-wrap"><table>
    <tr><th>الموظف</th><th>الفرع</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>المتبقي</th><th>التفاصيل</th><th>إجراء</th></tr>
    ${rows.map(r => { const u = userById(r.userId) || {}; return `<tr><td>${esc(u.name || "—")}</td>
      <td>${esc(u.branch || u.dept || "—")}</td><td>${LEAVE_TYPES[r.type]}</td><td>${fmt(r.from)}</td>
      <td>${fmt(r.to)}</td><td>${r.days}</td><td>${u.id ? remaining(u) : "—"}</td>
      <td class="wrap">${esc(r.reason || "—")}</td>
      <td><div class="actions"><button class="btn ok sm" data-act="approved" data-id="${r.id}">موافقة</button>
      <button class="btn danger sm" data-act="rejected" data-id="${r.id}">رفض</button></div></td></tr>`; }).join("")}
    </table></div>` : `<div class="empty">لا توجد طلبات بانتظار الموافقة</div>`}</div>`;
  $("#view").onclick = e => {
    const { act, id } = e.target.dataset; if (!act || me()?.role !== "manager") return;
    let note = "";
    if (act === "rejected") { note = prompt("سبب الرفض (اختياري):") ?? null; if (note === null) return; }
    DB.reqs = DB.reqs.map(r => r.id === id ? { ...r, status: act, note, decidedBy: cur.id } : r);
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
    <label>الاسم الكامل<input id="nName" required></label>
    <label>الفرع<input id="nBranch" required></label>
    <label>الدرجة الوظيفية<input id="nGrade" required></label>
    <label>رصيد الإجازة السنوي (يوم)<input id="nBal" type="number" min="0" value="21" required></label>
    <label>اسم المستخدم<input id="nUser" required pattern="[A-Za-z0-9_.]{3,}" title="3 أحرف على الأقل (إنجليزي أو أرقام)"></label>
    <label>كلمة المرور<input id="nPass" type="text" minlength="6" required></label>
    <label>الصلاحية<select id="nRole"><option value="employee">موظف</option><option value="manager">مدير</option></select></label>
  </div>
  <div id="nErr" class="error" hidden></div>
  <button class="btn-grad">إنشاء الحساب</button></form></div>

  <div class="card wide"><h2>الموظفون (${list.length})</h2><div class="table-wrap"><table>
  <tr><th>الاسم</th><th>المستخدم</th><th>الفرع</th><th>الدرجة</th><th>الصلاحية</th><th>المتبقي</th><th>الحالة</th><th>إجراءات</th></tr>
  ${list.map(u => `<tr><td>${esc(u.name)}</td><td dir="ltr">${esc(u.username)}</td>
    <td>${esc(u.branch || u.dept || "—")}</td><td>${esc(u.grade || "—")}</td>
    <td><span class="badge ${u.role === "manager" ? "manager" : ""}">${u.role === "manager" ? "مدير" : "موظف"}</span></td>
    <td>${remaining(u)} / ${u.balance}</td>
    <td>${u.active ? "نشط" : '<span class="badge off">موقوف</span>'}</td>
    <td><div class="actions"><button class="btn ghost sm" data-reset="${u.id}">إعادة كلمة المرور</button>
    ${u.id !== cur.id ? `<button class="btn ghost sm" data-toggle="${u.id}">${u.active ? "إيقاف" : "تفعيل"}</button>` : ""}</div></td></tr>`).join("")}
  </table></div></div>`;

  $("#newUser").onsubmit = async e => {
    e.preventDefault();
    if (me()?.role !== "manager") return;
    const username = $("#nUser").value.trim(), err = $("#nErr");
    if (DB.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      err.textContent = "اسم المستخدم مستخدم مسبقاً"; err.hidden = false; return;
    }
    DB.users = [...DB.users, { id: uid(), name: $("#nName").value.trim(), username,
      passHash: await hashPass(username, $("#nPass").value), role: $("#nRole").value,
      branch: $("#nBranch").value.trim(), grade: $("#nGrade").value.trim(),
      balance: +$("#nBal").value, active: true }];
    toast("تم إنشاء الحساب"); boot();
  };
  $("#view").onclick = e => {
    const { reset, toggle } = e.target.dataset;
    if (reset) openReset(reset);
    if (toggle && me()?.role === "manager") {
      DB.users = DB.users.map(u => u.id === toggle ? { ...u, active: !u.active } : u); boot();
    }
  };
}

/* ---------- إعادة تعيين كلمة المرور (المدير فقط) ---------- */
let resetId = null;
function openReset(id) {
  if (!me() || me().role !== "manager") return; // حماية الصلاحية
  const u = DB.users.find(x => x.id === id); resetId = id;
  $("#resetFor").textContent = `الموظف: ${u.name} (${u.username})`;
  $("#resetPass").value = ""; $("#resetDialog").showModal();
}
$("#genPass").onclick = () => {
  const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  $("#resetPass").value = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => c[b % c.length]).join("");
};
$("#resetCancel").onclick = () => $("#resetDialog").close();
$("#resetForm").onsubmit = async e => {
  e.preventDefault();
  if (!me() || me().role !== "manager") return;
  const u = DB.users.find(x => x.id === resetId), pass = $("#resetPass").value;
  const h = await hashPass(u.username, pass);
  DB.users = DB.users.map(x => x.id === resetId ? { ...x, passHash: h } : x);
  $("#resetDialog").close();
  alert(`تم تعيين كلمة المرور الجديدة للموظف ${u.name}:\n\n${pass}\n\nسلّمها للموظف.`);
  boot();
};

/* ---------- تغيير كلمة مروري ---------- */
function viewPassword(u) {
  $("#view").innerHTML = `<div class="card" style="max-width:480px"><h2>تغيير كلمة المرور</h2>
  <form id="pwForm">
    <label>كلمة المرور الحالية<input type="password" id="pOld" required></label>
    <label>كلمة المرور الجديدة<input type="password" id="pNew" minlength="6" required></label>
    <label>تأكيد كلمة المرور<input type="password" id="pNew2" minlength="6" required></label>
    <div id="pErr" class="error" hidden></div>
    <button class="btn-grad">حفظ</button></form></div>`;
  $("#pwForm").onsubmit = async e => {
    e.preventDefault(); const err = $("#pErr");
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (await hashPass(u.username, $("#pOld").value) !== u.passHash) return fail("كلمة المرور الحالية غير صحيحة");
    if ($("#pNew").value !== $("#pNew2").value) return fail("تأكيد كلمة المرور غير مطابق");
    const h = await hashPass(u.username, $("#pNew").value);
    DB.users = DB.users.map(x => x.id === u.id ? { ...x, passHash: h } : x);
    toast("تم تغيير كلمة المرور"); $("#pwForm").reset(); err.hidden = true;
  };
}

seed().then(boot);
