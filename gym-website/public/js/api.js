const API = {
  base: "",

  getToken() { return localStorage.getItem("hm_token"); },
  setToken(t) { localStorage.setItem("hm_token", t); },
  clearToken() { localStorage.removeItem("hm_token"); },
  getAdminToken() { return localStorage.getItem("hm_admin_token"); },
  setAdminToken(t) { localStorage.setItem("hm_admin_token", t); },
  clearAdminToken() { localStorage.removeItem("hm_admin_token"); },

  async request(path, { method = "GET", body, admin = false, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = admin ? this.getAdminToken() : this.getToken();
    if (auth && token) headers.Authorization = "Bearer " + token;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  },

  getSettings()          { return this.request("/api/settings", { auth: false }); },
  signup(p)              { return this.request("/api/signup", { method: "POST", body: p, auth: false }); },
  login(p)               { return this.request("/api/login", { method: "POST", body: p, auth: false }); },
  me()                   { return this.request("/api/me"); },
  buyPlan(plan)          { return this.request("/api/buy-plan", { method: "POST", body: { plan } }); },
  getContent()           { return this.request("/api/content"); },
  forgotPassword(email)  { return this.request("/api/forgot-password", { method: "POST", body: { email }, auth: false }); },
  resetPassword(t, p)    { return this.request("/api/reset-password", { method: "POST", body: { token: t, newPassword: p }, auth: false }); },

  adminLogin(p)              { return this.request("/api/admin/login", { method: "POST", body: p, auth: false }); },
  adminGetUsers()            { return this.request("/api/admin/users", { admin: true }); },
  adminVerifyUser(id)        { return this.request(`/api/admin/users/${id}/verify`, { method: "POST", admin: true }); },
  adminRejectUser(id)        { return this.request(`/api/admin/users/${id}/reject`, { method: "POST", admin: true }); },
  adminUpdateSettings(p)     { return this.request("/api/admin/settings", { method: "PUT", body: p, admin: true }); },
  adminGetContent()          { return this.request("/api/admin/content", { admin: true }); },
  adminUpdateContent(p)      { return this.request("/api/admin/content", { method: "PUT", body: p, admin: true }); },
  adminChangePassword(pw)    { return this.request("/api/admin/password", { method: "PUT", body: { newPassword: pw }, admin: true }); },
  adminGetEmailConfig()      { return this.request("/api/admin/email-config", { admin: true }); },
  adminUpdateEmailConfig(p)  { return this.request("/api/admin/email-config", { method: "PUT", body: p, admin: true }); },
  adminTestEmail()           { return this.request("/api/admin/email-test", { method: "POST", admin: true }); },
};

function money(n) {
  return "Rs " + Number(n).toLocaleString("en-PK");
}
function showMsg(el, text, type = "error") {
  el.textContent = text;
  el.className = "msg show " + type;
}
function hideMsg(el) {
  el.className = "msg";
}
