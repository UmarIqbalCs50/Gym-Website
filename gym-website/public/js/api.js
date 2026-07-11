const API = {
  base: "",

  getToken() {
    return sessionStorage.getItem("hm_token");
  },
  setToken(token) {
    sessionStorage.setItem("hm_token", token);
  },
  clearToken() {
    sessionStorage.removeItem("hm_token");
  },
  getAdminToken() {
    return sessionStorage.getItem("hm_admin_token");
  },
  setAdminToken(token) {
    sessionStorage.setItem("hm_admin_token", token);
  },
  clearAdminToken() {
    sessionStorage.removeItem("hm_admin_token");
  },

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
    if (!res.ok) {
      throw new Error(data.error || "Something went wrong. Please try again.");
    }
    return data;
  },

  getSettings() { return this.request("/api/settings", { auth: false }); },
  signup(payload) { return this.request("/api/signup", { method: "POST", body: payload, auth: false }); },
  login(payload) { return this.request("/api/login", { method: "POST", body: payload, auth: false }); },
  me() { return this.request("/api/me"); },
  buyPlan(plan) { return this.request("/api/buy-plan", { method: "POST", body: { plan } }); },
  getContent() { return this.request("/api/content"); },

  adminLogin(payload) { return this.request("/api/admin/login", { method: "POST", body: payload, auth: false }); },
  adminGetUsers() { return this.request("/api/admin/users", { admin: true }); },
  adminVerifyUser(id) { return this.request(`/api/admin/users/${id}/verify`, { method: "POST", admin: true }); },
  adminRejectUser(id) { return this.request(`/api/admin/users/${id}/reject`, { method: "POST", admin: true }); },
  adminUpdateSettings(payload) { return this.request("/api/admin/settings", { method: "PUT", body: payload, admin: true }); },
  adminGetContent() { return this.request("/api/admin/content", { admin: true }); },
  adminUpdateContent(payload) { return this.request("/api/admin/content", { method: "PUT", body: payload, admin: true }); },
  adminChangePassword(newPassword) { return this.request("/api/admin/password", { method: "PUT", body: { newPassword }, admin: true }); },
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
