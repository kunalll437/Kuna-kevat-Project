/*
 Routine Analytics — no SMS/phone OTP.
 Cloud mode: Supabase email/password + separate routine_analytics_tasks table.
 Demo mode: localStorage only; not secure authentication and data stays in this browser.
*/
const SUPABASE_URL = "PASTE_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE";
const hasSupabaseConfig = /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes("PASTE_") && SUPABASE_PUBLISHABLE_KEY.length > 20 &&
  !SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
const supabaseClient = hasSupabaseConfig && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
const $ = id => document.getElementById(id);
let authMode = "login", appMode = "demo", currentUser = null, tasks = [], recoveryActive = false, reminderTimer = null;
const DEMO_KEY = "routine_analytics_demo_tasks_v1", NOTIFIED_KEY = "routine_analytics_notified_v1";

function msg(id, text, good = false) {
  const el = $(id); if (!el) return;
  el.textContent = text || ""; el.classList.toggle("good", Boolean(good));
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function hhmm(v) { return v ? String(v).slice(0,5) : null; }
function done(t) { return t.status === "completed"; }
function dueStamp(t) {
  if (!t.due_date) return Infinity;
  return new Date(`${t.due_date}T${t.due_time || "23:59"}:00`).getTime();
}
function overdue(t) { return !done(t) && Boolean(t.due_date) && dueStamp(t) < Date.now(); }
function ordered(list) {
  return [...list].sort((a,b) => dueStamp(a)-dueStamp(b) || String(b.created_at||"").localeCompare(String(a.created_at||"")));
}
function seedDemo() {
  const d = today();
  return [
    {id:"sample-1",title:"Revise Enterprise Java",notes:"Review important practical programs.",category:"Study",priority:"High",due_date:d,due_time:"18:00",status:"pending",created_at:new Date().toISOString()},
    {id:"sample-2",title:"Organise project documentation",notes:"Check index and testing sections.",category:"Study",priority:"Medium",due_date:d,due_time:"20:00",status:"pending",created_at:new Date().toISOString()},
    {id:"sample-3",title:"Review weekly goals",notes:"",category:"Personal",priority:"Low",due_date:null,due_time:null,status:"completed",created_at:new Date().toISOString()}
  ];
}
function loadDemo() {
  try {
    const data = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (Array.isArray(data)) return data;
  } catch (e) { console.warn("Could not read demo storage", e); }
  const starter = seedDemo();
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(starter)); } catch (e) { console.warn("Could not save demo storage", e); }
  return starter;
}
function saveDemo() { localStorage.setItem(DEMO_KEY, JSON.stringify(tasks)); }
function showAuth() { $("authScreen").classList.remove("hidden"); $("appScreen").classList.add("hidden"); }
function showApp() {
  $("authScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden");
  const label = appMode === "demo" ? "Local demo" : (currentUser?.email || "Signed-in user");
  $("userLabel").textContent = label; $("userAvatar").textContent = label.slice(0,1).toUpperCase();
  $("modeLabel").textContent = appMode === "demo" ? "Local demo · this browser" : "Cloud account";
  $("demoBanner").classList.toggle("hidden", appMode !== "demo");
  $("dateLabel").textContent = new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}).toUpperCase();
  resumeReminders();
}
function setAuthMode(mode) {
  authMode = mode;
  $("loginTab").classList.toggle("active",mode==="login"); $("signupTab").classList.toggle("active",mode==="signup");
  $("authSubmit").textContent = mode==="login" ? "Log in" : "Create account";
  $("password").autocomplete = mode==="login" ? "current-password" : "new-password";
  $("forgotPassword").classList.toggle("hidden",mode!=="login"); msg("authMessage","");
}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.goto)));
$("loginTab").addEventListener("click",()=>setAuthMode("login"));
$("signupTab").addEventListener("click",()=>setAuthMode("signup"));

$("authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if (!supabaseClient) { msg("authMessage","Cloud login needs your Supabase URL and publishable key. Use “Explore the free demo” now, or configure cloud mode from README."); return; }
  const email=$("email").value.trim(), password=$("password").value;
  $("authSubmit").disabled=true; $("authSubmit").textContent="Please wait…"; msg("authMessage","");
  try {
    if (authMode==="signup") {
      const {data,error}=await supabaseClient.auth.signUp({email,password}); if(error) throw error;
      if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0) { msg("authMessage",niceError("User already registered")); return; }
      if(!data.session) { msg("authMessage","Account request accepted. If email confirmation is enabled, check your inbox, then log in.",true); return; }
      currentUser=data.user;
    } else {
      const {data,error}=await supabaseClient.auth.signInWithPassword({email,password}); if(error) throw error;
      currentUser=data.user;
    }
    appMode="cloud"; await loadCloudTasks(); showApp(); setPage("dashboard");
  } catch(error) { msg("authMessage", niceError(error)); }
  finally { $("authSubmit").disabled=false; $("authSubmit").textContent=authMode==="login"?"Log in":"Create account"; }
});
$("demoButton").addEventListener("click",()=>{
  appMode="demo"; currentUser={email:"Local demo"}; tasks=loadDemo(); showApp(); setPage("dashboard");
  msg("appMessage","Demo opened. Try adding, editing, completing and deleting tasks.",true);
});
$("forgotPassword").addEventListener("click",async()=>{
  if(!supabaseClient) { msg("authMessage","Cloud password recovery needs Supabase configured. The local demo has no account/password."); return; }
  const email=$("email").value.trim();
  if(!email) { msg("authMessage","Enter your account email above first."); $("email").focus(); return; }
  $("forgotPassword").disabled=true;
  try {
    const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
    if(error) throw error;
    msg("authMessage","If an account uses that email, a reset email has been requested. Check inbox and spam.",true);
  } catch(error) { msg("authMessage",niceError(error)); }
  finally { $("forgotPassword").disabled=false; }
});

async function loadCloudTasks() {
  if(!supabaseClient||!currentUser) { tasks=[]; return; }
  const {data,error}=await supabaseClient.from("routine_analytics_tasks")
    .select("id,user_id,title,notes,category,priority,due_date,due_time,status,created_at")
    .order("due_date",{ascending:true,nullsFirst:false});
  if(error) throw error;
  tasks=(data||[]).map(t=>({...t,due_time:hhmm(t.due_time)}));
}
async function saveTask(payload,id) {
  if(appMode==="demo") {
    if(id) tasks=tasks.map(t=>String(t.id)===String(id)?{...t,...payload,id}:t);
    else tasks.push({...payload,id:`demo-${Date.now()}-${Math.random().toString(16).slice(2)}`,created_at:new Date().toISOString()});
    saveDemo(); return;
  }
  if(!supabaseClient||!currentUser) throw new Error("Please sign in before saving cloud tasks.");
  const cloudPayload={...payload,user_id:currentUser.id};
  const result=id
    ? await supabaseClient.from("routine_analytics_tasks").update(cloudPayload).eq("id",id).eq("user_id",currentUser.id)
    : await supabaseClient.from("routine_analytics_tasks").insert(cloudPayload);
  if(result.error) throw result.error;
  await loadCloudTasks();
}
async function removeTask(id) {
  if(!confirm("Delete this task? This cannot be undone.")) return;
  try {
    if(appMode==="demo") { tasks=tasks.filter(t=>String(t.id)!==String(id)); saveDemo(); }
    else {
      const {error}=await supabaseClient.from("routine_analytics_tasks").delete().eq("id",id).eq("user_id",currentUser.id);
      if(error) throw error; await loadCloudTasks();
    }
    renderAll(); msg("appMessage","Task deleted.",true);
  } catch(error) { msg("appMessage",niceError(error)); }
}
async function setTaskStatus(id,completed) {
  try {
    if(appMode==="demo") { tasks=tasks.map(t=>String(t.id)===String(id)?{...t,status:completed?"completed":"pending"}:t); saveDemo(); }
    else {
      const {error}=await supabaseClient.from("routine_analytics_tasks").update({status:completed?"completed":"pending"}).eq("id",id).eq("user_id",currentUser.id);
      if(error) throw error; await loadCloudTasks();
    }
    renderAll();
  } catch(error) { msg("appMessage",niceError(error)); }
}
function setPage(page) {
  ["dashboard","tasks","analytics"].forEach(name=>{
    $(`${name}Page`).classList.toggle("hidden",name!==page);
    document.querySelector(`[data-page="${name}"]`)?.classList.toggle("active",name===page);
  });
  $("pageTitle").textContent=page==="dashboard"?"Dashboard":page==="tasks"?"My tasks":"Analytics";
  renderAll();
}
function openTask(task=null) {
  $("taskForm").reset(); $("taskId").value=task?task.id:"";
  $("taskDialogTitle").textContent=task?"Edit task":"Add a task";
  $("taskTitle").value=task?.title||""; $("taskNotes").value=task?.notes||"";
  $("taskCategory").value=task?.category||"Study"; $("taskPriority").value=task?.priority||"Medium";
  $("taskDate").value=task?.due_date||""; $("taskTime").value=task?.due_time||"";
  $("taskCompleted").checked=task?done(task):false; msg("taskMessage","");
  $("taskDialog").showModal(); $("taskTitle").focus();
}
$("addTaskButton").addEventListener("click",()=>openTask());
$("closeTaskDialog").addEventListener("click",()=>$("taskDialog").close());
$("cancelTask").addEventListener("click",()=>$("taskDialog").close());
$("taskForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const title=$("taskTitle").value.trim();
  if(!title) { msg("taskMessage","Enter a task name."); return; }
  if($("taskTime").value&&!$("taskDate").value) { msg("taskMessage","Choose a due date when entering a due time."); return; }
  const id=$("taskId").value||null;
  const payload={title,notes:$("taskNotes").value.trim(),category:$("taskCategory").value,priority:$("taskPriority").value,due_date:$("taskDate").value||null,due_time:$("taskTime").value||null,status:$("taskCompleted").checked?"completed":"pending"};
  const button=$("taskForm").querySelector('button[type="submit"]'); button.disabled=true;
  try { await saveTask(payload,id); $("taskDialog").close(); renderAll(); msg("appMessage",id?"Task updated.":"Task saved.",true); }
  catch(error) { msg("taskMessage",niceError(error)); }
  finally { button.disabled=false; }
});
function markup(t) {
  const isComplete=done(t), when=[t.due_date,t.due_time].filter(Boolean).join(" · ");
  return `<div class="task-item ${isComplete?"done":""}">
    <input class="task-check" type="checkbox" data-toggle="${esc(t.id)}" ${isComplete?"checked":""} aria-label="Mark ${esc(t.title)} completed">
    <div class="task-detail"><strong>${esc(t.title)}</strong><p>${esc(t.category||"Other")}${when?" · "+esc(when):""}${t.notes?" · "+esc(t.notes):""}${overdue(t)?" · OVERDUE":""}</p></div>
    <span class="pill ${String(t.priority||"Medium").toLowerCase()}">${esc(t.priority||"Medium")}</span>
    <div class="task-actions"><button class="mini-button" data-edit="${esc(t.id)}" type="button">Edit</button><button class="mini-button" data-delete="${esc(t.id)}" type="button" aria-label="Delete task">✕</button></div>
  </div>`;
}
function bindActions(root) {
  root.querySelectorAll("[data-toggle]").forEach(el=>el.addEventListener("change",()=>setTaskStatus(el.dataset.toggle,el.checked)));
  root.querySelectorAll("[data-edit]").forEach(el=>el.addEventListener("click",()=>{const t=tasks.find(x=>String(x.id)===String(el.dataset.edit));if(t)openTask(t);}));
  root.querySelectorAll("[data-delete]").forEach(el=>el.addEventListener("click",()=>removeTask(el.dataset.delete)));
}
function renderList(id,list,empty) {
  const root=$(id); root.innerHTML=list.length?list.map(markup).join(""):`<div class="empty-state">${esc(empty)}</div>`; bindActions(root);
}
function renderTaskPage() {
  const q=$("searchInput").value.trim().toLowerCase(), status=$("statusFilter").value, priority=$("priorityFilter").value, category=$("categoryFilter").value;
  const filtered=ordered(tasks).filter(t=>`${t.title} ${t.notes||""} ${t.category||""}`.toLowerCase().includes(q)
    &&(status==="all"||t.status===status)&&(priority==="all"||t.priority===priority)&&(category==="all"||t.category===category));
  $("taskCount").textContent=`${filtered.length} ${filtered.length===1?"task":"tasks"}`;
  renderList("allTasksList",filtered,"No tasks match these filters. Try another filter or add a task.");
}
["searchInput","statusFilter","priorityFilter","categoryFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderTaskPage));
function renderAll() {
  const total=tasks.length, completed=tasks.filter(done).length, pending=total-completed, rate=total?Math.round(completed/total*100):0;
  const high=tasks.filter(t=>t.priority==="High"&&!done(t)).length, late=tasks.filter(overdue).length;
  $("totalStat").textContent=total; $("completedStat").textContent=completed; $("pendingStat").textContent=pending;
  $("rateStat").textContent=`${rate}%`; $("rateBar").style.width=`${rate}%`;
  $("focusRate").textContent=`${rate}%`; $("focusRing").style.setProperty("--pct",`${rate}%`);
  $("focusText").textContent=total?`${completed} of ${total} tasks completed. Keep going!`:"Add your first task to get started.";
  $("analyticsRate").textContent=`${rate}%`; $("highStat").textContent=high; $("overdueStat").textContent=late;
  [["completed",completed],["pending",pending],["high",high]].forEach(([key,n])=>{$(`${key}Bar`).style.width=`${total?Math.round(n/total*100):0}%`;$(`${key}BarLabel`).textContent=n;});
  renderList("upcomingList",ordered(tasks.filter(t=>!done(t))).slice(0,5),"You're all caught up. Add a task whenever you need.");
  renderTaskPage();
  $("categoryBreakdown").innerHTML=["Study","Work","Personal","Health","Coding","Other"].map(cat=>`<div class="category-card"><span>${cat}</span><strong>${tasks.filter(t=>t.category===cat).length}</strong></div>`).join("");
}

$("logoutButton").addEventListener("click",async()=>{
  stopReminderChecks();
  if(appMode==="cloud"&&supabaseClient) { try{await supabaseClient.auth.signOut();}catch(e){console.warn(e);} }
  currentUser=null; tasks=[]; appMode="demo"; showAuth(); msg("authMessage","");
});

async function enableReminders() {
  if(!("Notification" in window)){msg("appMessage","This browser does not support notifications. Tasks still work normally.");return;}
  if(!window.isSecureContext){msg("appMessage","Browser reminders require localhost or an HTTPS website.");return;}
  const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
  if(permission!=="granted"){msg("appMessage","Notifications are blocked in browser settings. You can still use all tasks.");return;}
  $("reminderButton").textContent="✓ Reminders enabled"; msg("appMessage","Browser reminders are active while this page stays open.",true);
  stopReminderChecks(); checkDueTasks(); reminderTimer=setInterval(checkDueTasks,30000);
}
function stopReminderChecks(){if(reminderTimer)clearInterval(reminderTimer);reminderTimer=null;}
function resumeReminders(){
  if(!("Notification" in window)||!window.isSecureContext||Notification.permission!=="granted")return;
  $("reminderButton").textContent="✓ Reminders enabled";
  stopReminderChecks(); checkDueTasks(); reminderTimer=setInterval(checkDueTasks,30000);
}
function checkDueTasks() {
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  let sent=[];try{sent=JSON.parse(localStorage.getItem(NOTIFIED_KEY)||"[]");}catch{}
  const now=Date.now();
  for(const t of tasks){
    if(done(t)||!t.due_date||!t.due_time)continue;
    const key=`${t.id}:${t.due_date}:${t.due_time}`; if(sent.includes(key))continue;
    const due=new Date(`${t.due_date}T${t.due_time}:00`).getTime();
    if(due<=now&&now-due<24*60*60*1000){try{new Notification("Routine Analytics · Task due",{body:t.title,tag:key});sent.push(key);}catch(e){console.warn("Notification failed",e);}}
  }
  try{localStorage.setItem(NOTIFIED_KEY,JSON.stringify(sent.slice(-500)));}catch(e){console.warn(e);}
}
$("reminderButton").addEventListener("click",enableReminders);

$("resetForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!supabaseClient||!recoveryActive){msg("resetMessage","Open the password-recovery link from your email first.");return;}
  const password=$("newPassword").value;
  if(password.length<6){msg("resetMessage","Use at least 6 characters.");return;}
  if(password!==$("confirmPassword").value){msg("resetMessage","The passwords do not match.");return;}
  const btn=$("resetForm").querySelector('button[type="submit"]');btn.disabled=true;
  try {
    const {error}=await supabaseClient.auth.updateUser({password}); if(error)throw error;
    msg("resetMessage","Password updated. Please log in again.",true);
    await supabaseClient.auth.signOut(); recoveryActive=false;
    setTimeout(()=>{$("resetDialog").close();window.location.hash="";showAuth();},1100);
  } catch(error) { msg("resetMessage",niceError(error)); }
  finally {btn.disabled=false;}
});
$("closeResetDialog").addEventListener("click",()=>$("resetDialog").close());
$("cancelReset").addEventListener("click",()=>$("resetDialog").close());

function niceError(error) {
  const text=String(error?.message||error||"Something went wrong.");
  if(/failed to fetch|networkerror/i.test(text))return "Connection problem. Check internet and the Supabase project URL.";
  if(/invalid login credentials/i.test(text))return "Email or password is incorrect. For a new account, check whether email confirmation is required.";
  if(/user already registered/i.test(text))return "An account already exists with this email. Try logging in.";
  if(/relation .* does not exist|could not find the table/i.test(text))return "Cloud table missing. Run the included supabase-schema.sql in Supabase SQL Editor.";
  if(/row-level security|violates row-level security/i.test(text))return "Database access was rejected. Check the supplied SQL and confirm you are signed in.";
  return text;
}
async function init() {
  setAuthMode("login");
  if(!supabaseClient){msg("authMessage","Cloud mode is not configured yet. The free local demo works right now.");return;}
  supabaseClient.auth.onAuthStateChange((event)=>{
    if(event==="PASSWORD_RECOVERY"){recoveryActive=true;if(!$("resetDialog").open)$("resetDialog").showModal();}
    if(event==="SIGNED_OUT"&&appMode==="cloud"){stopReminderChecks();currentUser=null;tasks=[];showAuth();}
  });
  try {
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(session){currentUser=session.user;appMode="cloud";await loadCloudTasks();showApp();setPage("dashboard");}
  } catch(error) { msg("authMessage",niceError(error)); }
}
init();
