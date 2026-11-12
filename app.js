(() => {
  const $ = (selector) => document.querySelector(selector);
  const configForm = $("#config-form"), authArea = $("#auth-area"), authForm = $("#auth-form");
  const message = $("#config-message"), queueList = $("#queue-list"), template = $("#video-card-template");
  let client = null, currentUser = null, videos = [];
  const savedUrl = localStorage.getItem("bs_supabase_url") || "";
  const savedKey = localStorage.getItem("bs_supabase_anon") || "";
  $("#supabase-url").value = savedUrl;
  $("#supabase-key").value = savedKey;

  function say(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }
  function setConnection(text, good = false) {
    $("#connection-label").textContent = text;
    $(".status-dot").style.background = good ? "var(--green)" : "var(--amber)";
  }
  function showEmpty(title) {
    queueList.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    const h = document.createElement("h3"); h.textContent = title;
    const p = document.createElement("p"); p.textContent = "New MP4s from Google Drive will appear here after the daily scanner runs.";
    div.append(h, p); queueList.appendChild(div);
  }
  function renderAuth() {
    $("#user-label").textContent = currentUser ? currentUser.email : "";
    $("#signin-btn").hidden = !!currentUser;
    $("#signup-btn").hidden = !!currentUser;
    $("#signout-btn").hidden = !currentUser;
  }
  function connect(url, key) {
    if (!window.supabase?.createClient) throw new Error("Supabase library did not load. Refresh and try again.");
    client = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
    authArea.hidden = false; setConnection("Supabase connected", true);
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null; renderAuth();
      if (currentUser) loadQueue(); else showEmpty("Sign in to view your private queue.");
    });
    client.auth.getSession().then(({data,error}) => {
      if (error) throw error;
      currentUser = data.session?.user || null; renderAuth();
      if (currentUser) loadQueue(); else showEmpty("Sign in to view your private queue.");
    }).catch(error => say(error.message, true));
  }
  function updateStats() {
    $("#stat-total").textContent = videos.length;
    $("#stat-pending").textContent = videos.filter(v => v.status === "pending").length;
    $("#stat-approved").textContent = videos.filter(v => v.status === "approved").length;
    $("#stat-done").textContent = videos.filter(v => ["scheduled","published"].includes(v.status)).length;
  }
  function makeCard(video) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = video.id;
    node.querySelector(".video-filename").textContent = video.file_name || "Untitled video";
    node.querySelector(".video-meta").textContent = [video.file_size ? (video.file_size / 1048576).toFixed(1) + " MB" : "", video.created_at ? new Date(video.created_at).toLocaleString() : ""].filter(Boolean).join(" · ");
    const badge = node.querySelector(".status-badge"); badge.textContent = video.status; badge.classList.add(video.status);
    node.querySelector(".field-title").value = video.title || "";
    node.querySelector(".field-description").value = video.description || "";
    node.querySelector(".field-tags").value = Array.isArray(video.tags) ? video.tags.join(", ") : (video.tags || "");
    const result = node.querySelector(".video-result");
    if (video.youtube_url) {
      const link = document.createElement("a"); link.href = video.youtube_url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open on YouTube ↗"; result.appendChild(link);
    } else if (video.error_message) result.textContent = video.error_message;
    const editable = ["pending","approved","rejected","error"].includes(video.status);
    node.querySelectorAll("input,textarea").forEach(el => { el.disabled = !editable; });
    node.querySelector(".approve-btn").hidden = !["pending","approved","error"].includes(video.status);
    node.querySelector(".approve-btn").textContent = video.status === "approved" ? "Save changes" : "Approve for upload";
    node.querySelector(".reject-btn").hidden = !["pending","approved"].includes(video.status);
    node.querySelector(".approve-btn").addEventListener("click", () => saveVideo(node, video, "approved"));
    node.querySelector(".reject-btn").addEventListener("click", () => saveVideo(node, video, "rejected"));
    return node;
  }
  async function loadQueue() {
    if (!client || !currentUser) return;
    queueList.innerHTML = '<div class="empty-state"><h3>Loading your queue…</h3></div>';
    const {data,error} = await client.from("shorts_queue").select("*").order("created_at", {ascending:false});
    if (error) { say(error.message,true); showEmpty("Could not load queue"); return; }
    videos = data || []; updateStats(); renderQueue();
    say(videos.length ? "Queue synced." : "Connected. Your queue is currently empty.");
  }
  function renderQueue() {
    const filter = $("#status-filter").value;
    const visible = videos.filter(v => filter === "all" || v.status === filter);
    queueList.innerHTML = "";
    if (!visible.length) { showEmpty(filter === "all" ? "No Shorts yet" : "No videos with this status"); return; }
    visible.forEach(video => queueList.appendChild(makeCard(video)));
  }
  async function saveVideo(card, video, status) {
    const button = card.querySelector(status === "approved" ? ".approve-btn" : ".reject-btn"); button.disabled = true;
    const tags = card.querySelector(".field-tags").value.split(",").map(t => t.trim()).filter(Boolean).slice(0,30);
    const patch = {
      title: card.querySelector(".field-title").value.trim().slice(0,100),
      description: card.querySelector(".field-description").value.trim().slice(0,5000),
      tags, status, error_message: null, updated_at: new Date().toISOString()
    };
    if (status === "approved" && !patch.title) { say("Please add a title before approving.",true); button.disabled = false; return; }
    const {error} = await client.from("shorts_queue").update(patch).eq("id",video.id).eq("owner_user_id",currentUser.id);
    button.disabled = false;
    if (error) { say(error.message,true); return; }
    say(status === "approved" ? "Approved. The next daily publisher run will pick it up." : "Video rejected.");
    await loadQueue();
  }
  configForm.addEventListener("submit", event => {
    event.preventDefault();
    const url = $("#supabase-url").value.trim().replace(/\/$/,""), key = $("#supabase-key").value.trim();
    try {
      connect(url,key); localStorage.setItem("bs_supabase_url",url); localStorage.setItem("bs_supabase_anon",key);
      say("Supabase connected. Sign in below.");
    } catch(error) { say(error.message,true); }
  });
  if (savedUrl && savedKey) {
    try { connect(savedUrl,savedKey); say("Saved Supabase connection loaded."); }
    catch(error) { say(error.message,true); }
  }
  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!client) return say("Connect Supabase first.",true);
    const {error} = await client.auth.signInWithPassword({email:$("#auth-email").value.trim(),password:$("#auth-password").value});
    if (error) say(error.message,true);
  });
  $("#signup-btn").addEventListener("click", async () => {
    if (!client) return say("Connect Supabase first.",true);
    const {data,error} = await client.auth.signUp({email:$("#auth-email").value.trim(),password:$("#auth-password").value});
    if (error) say(error.message,true);
    else say(data.session ? "Account created and signed in." : "Account created. Check your email to confirm, then sign in.");
  });
  $("#signout-btn").addEventListener("click", async () => {
    const {error} = await client.auth.signOut(); if (error) say(error.message,true);
  });
  $("#refresh-btn").addEventListener("click",loadQueue);
  $("#status-filter").addEventListener("change",renderQueue);
})();
