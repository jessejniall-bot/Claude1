/* =====================================================================
   Skool Community Copilot — minimal Supabase client (fetch-based)
   ---------------------------------------------------------------------
   MV3 forbids remote code and we ship zero dependencies, so instead of
   supabase-js this is a small client for the two Supabase surfaces we
   use: GoTrue auth (email/password) and PostgREST. Sessions are stored
   via SC.storage under "sc_session" and auto-refreshed before expiry.
   Requires config.js to be loaded first.
   ===================================================================== */
(function (SC) {
  "use strict";

  var SESSION_KEY = "sc_session";

  function SupabaseError(message, status, details) {
    var err = new Error(message);
    err.name = "SupabaseError";
    err.status = status;
    err.details = details;
    return err;
  }

  async function parseJsonSafe(res) {
    var text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return { raw: text };
    }
  }

  function errorMessage(body, fallback) {
    if (!body) return fallback;
    return (
      body.msg || body.message || body.error_description || body.error ||
      body.hint || fallback
    );
  }

  /* ------------------------- query builder ------------------------- */

  function QueryBuilder(client, table) {
    this.client = client;
    this.table = table;
    this._filters = [];
    this._select = "*";
    this._order = [];
    this._limit = null;
    this._single = false;
    this._method = "GET";
    this._body = null;
    this._prefer = [];
    this._onConflict = null;
  }

  QueryBuilder.prototype.select = function (cols) {
    this._select = cols || "*";
    return this;
  };
  QueryBuilder.prototype._filter = function (col, op, val) {
    this._filters.push(
      encodeURIComponent(col) + "=" + op + "." + encodeURIComponent(val)
    );
    return this;
  };
  QueryBuilder.prototype.eq = function (c, v) { return this._filter(c, "eq", v); };
  QueryBuilder.prototype.neq = function (c, v) { return this._filter(c, "neq", v); };
  QueryBuilder.prototype.gte = function (c, v) { return this._filter(c, "gte", v); };
  QueryBuilder.prototype.lte = function (c, v) { return this._filter(c, "lte", v); };
  QueryBuilder.prototype.in = function (c, vals) {
    this._filters.push(
      encodeURIComponent(c) + "=in.(" + vals.map(encodeURIComponent).join(",") + ")"
    );
    return this;
  };
  QueryBuilder.prototype.order = function (col, opts) {
    var dir = opts && opts.ascending === false ? "desc" : "asc";
    this._order.push(col + "." + dir);
    return this;
  };
  QueryBuilder.prototype.limit = function (n) {
    this._limit = n;
    return this;
  };
  QueryBuilder.prototype.single = function () {
    this._single = true;
    return this;
  };
  QueryBuilder.prototype.insert = function (rows) {
    this._method = "POST";
    this._body = rows;
    this._prefer.push("return=representation");
    return this;
  };
  QueryBuilder.prototype.upsert = function (rows, opts) {
    this._method = "POST";
    this._body = rows;
    this._prefer.push("return=representation", "resolution=merge-duplicates");
    if (opts && opts.onConflict) this._onConflict = opts.onConflict;
    return this;
  };
  QueryBuilder.prototype.update = function (values) {
    this._method = "PATCH";
    this._body = values;
    this._prefer.push("return=representation");
    return this;
  };
  QueryBuilder.prototype.delete = function () {
    this._method = "DELETE";
    return this;
  };

  QueryBuilder.prototype.run = async function () {
    var params = [];
    if (this._method === "GET") params.push("select=" + encodeURIComponent(this._select));
    else if (this._prefer.indexOf("return=representation") !== -1)
      params.push("select=" + encodeURIComponent(this._select));
    params = params.concat(this._filters);
    if (this._order.length) params.push("order=" + this._order.join(","));
    if (this._limit != null) params.push("limit=" + this._limit);
    if (this._onConflict) params.push("on_conflict=" + encodeURIComponent(this._onConflict));

    var url = this.client.url + "/rest/v1/" + this.table + "?" + params.join("&");
    var headers = await this.client.authHeaders();
    headers["Content-Type"] = "application/json";
    if (this._prefer.length) headers["Prefer"] = this._prefer.join(",");
    if (this._single) headers["Accept"] = "application/vnd.pgrst.object+json";

    var res = await fetch(url, {
      method: this._method,
      headers: headers,
      body: this._body != null ? JSON.stringify(this._body) : undefined,
    });
    var body = await parseJsonSafe(res);
    if (!res.ok) {
      throw SupabaseError(
        errorMessage(body, this.table + " request failed (" + res.status + ")"),
        res.status,
        body
      );
    }
    return body;
  };

  // Make builders awaitable: `await client.from("x").select()`
  QueryBuilder.prototype.then = function (resolve, reject) {
    return this.run().then(resolve, reject);
  };

  /* ---------------------------- client ----------------------------- */

  function SupabaseLite(url, anonKey) {
    this.url = String(url || "").replace(/\/+$/, "");
    this.anonKey = anonKey;
    this._session = null;
    this._loaded = false;
  }

  SupabaseLite.prototype._getSession = async function () {
    if (!this._loaded) {
      this._session = await SC.storage.get(SESSION_KEY);
      this._loaded = true;
    }
    return this._session;
  };

  SupabaseLite.prototype._setSession = async function (s) {
    this._session = s;
    this._loaded = true;
    if (s) await SC.storage.set(SESSION_KEY, s);
    else await SC.storage.remove(SESSION_KEY);
  };

  SupabaseLite.prototype._authRequest = async function (path, payload) {
    var res = await fetch(this.url + "/auth/v1/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.anonKey },
      body: JSON.stringify(payload),
    });
    var body = await parseJsonSafe(res);
    if (!res.ok) throw SupabaseError(errorMessage(body, "Auth failed"), res.status, body);
    return body;
  };

  SupabaseLite.prototype._storeAuthResult = async function (data) {
    if (!data || !data.access_token) return null;
    var session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at:
        data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user || null,
    };
    await this._setSession(session);
    return session;
  };

  SupabaseLite.prototype.signUp = async function (email, password) {
    var data = await this._authRequest("signup", { email: email, password: password });
    // If email confirmation is disabled Supabase returns a session directly.
    await this._storeAuthResult(data);
    return data;
  };

  SupabaseLite.prototype.signIn = async function (email, password) {
    var data = await this._authRequest("token?grant_type=password", {
      email: email,
      password: password,
    });
    return this._storeAuthResult(data);
  };

  SupabaseLite.prototype.refresh = async function () {
    var s = await this._getSession();
    if (!s || !s.refresh_token) return null;
    try {
      var data = await this._authRequest("token?grant_type=refresh_token", {
        refresh_token: s.refresh_token,
      });
      return await this._storeAuthResult(data);
    } catch (e) {
      await this._setSession(null); // refresh token rejected — force re-login
      return null;
    }
  };

  SupabaseLite.prototype.signOut = async function () {
    var s = await this._getSession();
    if (s) {
      try {
        await fetch(this.url + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: this.anonKey, Authorization: "Bearer " + s.access_token },
        });
      } catch (e) { /* best effort */ }
    }
    await this._setSession(null);
  };

  // Returns a live session, refreshing if it expires within 60s.
  SupabaseLite.prototype.ensureSession = async function () {
    var s = await this._getSession();
    if (!s) return null;
    if ((s.expires_at || 0) * 1000 - Date.now() < 60000) {
      s = await this.refresh();
    }
    return s;
  };

  SupabaseLite.prototype.getUser = async function () {
    var s = await this.ensureSession();
    return s ? s.user : null;
  };

  SupabaseLite.prototype.authHeaders = async function () {
    var s = await this.ensureSession();
    return {
      apikey: this.anonKey,
      Authorization: "Bearer " + (s ? s.access_token : this.anonKey),
    };
  };

  SupabaseLite.prototype.from = function (table) {
    return new QueryBuilder(this, table);
  };

  SC.SupabaseLite = SupabaseLite;

  // Convenience: build a client from stored config, or null if unconfigured.
  SC.getClient = async function () {
    var cfg = await SC.loadConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    return new SupabaseLite(cfg.supabaseUrl, cfg.supabaseAnonKey);
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
