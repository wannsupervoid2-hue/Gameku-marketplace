const $ = s => document.querySelector(s);
let me = null, currentGame = "", currentOrder = null;
const money = n => "Rp" + Number(n).toLocaleString("id-ID");
function toast(msg){const el=$("#toast");el.textContent=msg;el.style.display="block";setTimeout(()=>el.style.display="none",3200)}
async function api(url, options={}) {
  const res = await fetch("/api"+url,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...options});
  const data = await res.json().catch(()=>({error:"Respons server tidak valid."}));
  if(!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
}
function openModal(html){$("#modalContent").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden");$("#modalContent").innerHTML=""}
$("#closeModal").onclick=closeModal;
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
function formField(label,name,type="text",placeholder="",required=true){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" placeholder="${placeholder}" ${required?"required":""}></div>`}
function showAuth(mode){
  const register=mode==="register";
  openModal(`<h2>${register?"Buat akun GAMEKU":"Masuk ke GAMEKU"}</h2>
    <form id="authForm">${register?formField("Nama tampilan","name","text","Nama kamu"):""}
    ${formField("Email","email","email","nama@email.com")}
    ${formField("Password (minimal 10 karakter)","password","password","Password kuat")}
    <div class="form-actions"><button class="btn" type="submit">${register?"Daftar":"Masuk"}</button></div>
    <p class="small">${register?'Sudah punya akun? <a href="#" id="switchAuth">Masuk</a>':'Belum punya akun? <a href="#" id="switchAuth">Daftar</a>'}</p></form>`);
  $("#switchAuth").onclick=e=>{e.preventDefault();showAuth(register?"login":"register")};
  $("#authForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
    try{const r=await api(register?"/register":"/login",{method:"POST",body:JSON.stringify(f)});me=r.user;closeModal();await refreshMe();toast("Berhasil masuk.");}
    catch(err){toast(err.message)}
  };
}
$("#loginOpen").onclick=()=>showAuth("login");
$("#registerOpen").onclick=()=>showAuth("register");
$("#logout").onclick=async()=>{try{await api("/logout",{method:"POST"});me=null;await refreshMe();toast("Kamu sudah keluar.");}catch(e){toast(e.message)}};
function ensureLogin(){if(!me){showAuth("login");return false}return true}
async function refreshMe(){
  try{const r=await api("/me");me=r.user}catch{me=null}
  $("#balance").textContent="Saldo: "+money(me?.balance||0);
  $("#loginOpen").classList.toggle("hidden",!!me);
  $("#registerOpen").classList.toggle("hidden",!!me);
  $("#logout").classList.toggle("hidden",!me);
  $("#accountText").textContent=me?`Login sebagai ${me.name} (${me.email}) · Peran: ${me.role}`:"Masuk untuk melihat pesanan, deposit, chat, dan dashboard.";
  $("#adminBtn").classList.toggle("hidden",me?.role!=="admin");
}
async function loadListings(){
  const q=$("#search").value.trim();
  const params=new URLSearchParams();if(currentGame)params.set("game",currentGame);if(q)params.set("q",q);
  try{const {listings}=await api("/listings?"+params.toString());
    $("#listings").innerHTML=listings.length?listings.map(p=>`<article class="card">
      <span class="tag">${esc(p.game)}</span><h3>${esc(p.title)}</h3><div class="desc">${esc(p.description)}</div>
      <div class="price">${money(p.price)}</div><div class="seller">Penjual: ${esc(p.seller_name)} · #${p.id}</div>
      <div class="card-actions"><button class="btn" data-buy="${p.id}">Beli akun</button></div></article>`).join(""):'<div class="panel">Belum ada produk aktif. Kamu bisa menjadi penjual pertama.</div>';
  }catch(e){toast(e.message)}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("#listings").addEventListener("click",async e=>{
  const b=e.target.closest("[data-buy]");if(!b)return;if(!ensureLogin())return;
  if(!confirm("Beli produk ini menggunakan saldo GAMEKU? Saldo akan ditahan sampai pesanan diselesaikan."))return;
  try{const r=await api("/orders",{method:"POST",body:JSON.stringify({listingId:Number(b.dataset.buy)})});toast("Pesanan #"+r.orderId+" dibuat. Buka riwayat untuk chat penjual.");await refreshMe();await loadListings();await showOrders();}
  catch(err){toast(err.message)}
});
$("#search").addEventListener("input",loadListings);
$("#refresh").onclick=loadListings;
document.querySelectorAll("nav [data-game]").forEach(a=>a.onclick=e=>{e.preventDefault();currentGame=a.dataset.game;loadListings()});

$("#sellOpen").onclick=()=>{
 if(!ensureLogin())return;
 openModal(`<h2>Jual akun game</h2><p class="small">Jangan cantumkan password, email pemulihan, OTP, atau data pribadi pada deskripsi. Pastikan penjualan akun diizinkan oleh aturan game terkait.</p>
 <form id="sellForm"><div class="field"><label>Game</label><select name="game" required><option>Mobile Legends</option><option>Free Fire</option><option>Roblox</option><option>eFootball</option><option>Lainnya</option></select></div>
 ${formField("Judul listing","title","text","Contoh: Akun rank Epic")}
 <div class="field"><label>Deskripsi</label><textarea name="description" maxlength="1500" required placeholder="Isi detail item, progres, dan kondisi akun. Jangan tulis password."></textarea></div>
 ${formField("Harga (Rp)","price","number","50000")}
 <button class="btn" type="submit">Terbitkan listing</button></form>`);
 $("#sellForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{await api("/listings",{method:"POST",body:JSON.stringify(f)});closeModal();toast("Listing diterbitkan.");await loadListings()}catch(err){toast(err.message)}};
};
$("#depositOpen").onclick=()=>{
 if(!ensureLogin())return;
 openModal(`<h2>Deposit saldo via DANA</h2><p class="small">Versi demo memakai verifikasi manual. Jangan pernah memasukkan PIN DANA/OTP. Transfer hanya setelah admin menyediakan instruksi pembayaran resmi. Bukti/referensi bukan jaminan pembayaran terverifikasi.</p>
 <form id="depositForm">${formField("Nominal (minimal Rp10.000)","amount","number","10000")}
 ${formField("Referensi transfer / catatan","reference","text","Contoh: transfer 25 Okt, 14:30")}
 <button class="btn" type="submit">Kirim permintaan</button></form>`);
 $("#depositForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{const r=await api("/deposits",{method:"POST",body:JSON.stringify(f)});closeModal();toast(r.message);await showDeposits()}catch(err){toast(err.message)}};
};
$("#ordersBtn").onclick=()=>{if(ensureLogin())showOrders()};
$("#ledgerBtn").onclick=()=>{if(ensureLogin())showLedger()};
async function showOrders(){
 try{const {orders}=await api("/orders");
 $("#privateContent").innerHTML="<h3>Riwayat transaksi</h3>"+(orders.length?orders.map(o=>`<div class="result-row"><b>Pesanan #${o.id} — ${esc(o.title)}</b><br>${esc(o.game)} · ${money(o.price)} · <span class="status">${esc(o.status)}</span><br><span class="small">Pembeli: ${esc(o.buyer_name)} · Penjual: ${esc(o.seller_name)}</span><div class="actions"><button class="btn light" data-chat="${o.id}">Chat pesanan</button>${o.buyer_id===me.id&&o.status==="paid"?`<button class="btn" data-complete="${o.id}">Pesanan selesai</button>`:""}</div></div>`).join(""):"<p class='muted'>Belum ada transaksi.</p>");
 }catch(e){toast(e.message)}
}
$("#privateContent").addEventListener("click",async e=>{
 const chat=e.target.closest("[data-chat]");const done=e.target.closest("[data-complete]");
 if(chat){currentOrder=Number(chat.dataset.chat);await showChat(currentOrder)}
 if(done){try{await api(`/orders/${done.dataset.complete}/complete`,{method:"POST",body:"{}"});toast("Pesanan diselesaikan.");await refreshMe();await showOrders()}catch(err){toast(err.message)}}
 const approve=e.target.closest("[data-approve]");const reject=e.target.closest("[data-reject]");const remove=e.target.closest("[data-remove]");
 if(approve||reject){const id=(approve||reject).dataset[approve?"approve":"reject"];try{await api(`/admin/deposits/${id}/decision`,{method:"POST",body:JSON.stringify({decision:approve?"approve":"reject"})});toast("Deposit diproses.");await showAdmin()}catch(err){toast(err.message)}}
 if(remove){try{await api(`/admin/listings/${remove.dataset.remove}/remove`,{method:"POST",body:"{}"});toast("Listing dinonaktifkan.");await showAdmin()}catch(err){toast(err.message)}}
});
async function showChat(id){
 try{const {messages}=await api(`/orders/${id}/messages`);
 openModal(`<h2>Chat pesanan #${id}</h2><div class="chat-box" id="chatBox">${messages.map(m=>`<div class="bubble ${m.sender_id===me.id?"mine":""}"><b>${esc(m.sender_name)}</b><br>${esc(m.body)}<div class="small">${esc(m.created_at)}</div></div>`).join("")||"Belum ada pesan."}</div>
 <form id="chatForm"><div class="field"><label>Pesan</label><textarea name="body" maxlength="1000" required placeholder="Tulis pesan untuk lawan transaksi..."></textarea></div><button class="btn">Kirim pesan</button></form>`);
 $("#chatForm").onsubmit=async e=>{e.preventDefault();const body=new FormData(e.target).get("body");try{await api(`/orders/${id}/messages`,{method:"POST",body:JSON.stringify({body})});await showChat(id)}catch(err){toast(err.message)}};
 }catch(e){toast(e.message)}
}
async function showDeposits(){
 try{const {deposits}=await api("/deposits");$("#privateContent").innerHTML="<h3>Permintaan deposit</h3>"+(deposits.map(d=>`<div class='result-row'>${money(d.amount)} · ${esc(d.method)} · <span class='status'>${esc(d.status)}</span><br>Referensi: ${esc(d.reference)}<br><span class='small'>${esc(d.created_at)}</span></div>`).join("")||"<p class='muted'>Belum ada deposit.</p>")}
 catch(e){toast(e.message)}
}
async function showLedger(){
 try{const {entries}=await api("/ledger");$("#privateContent").innerHTML="<h3>Mutasi saldo</h3>"+(entries.map(x=>`<div class='result-row'><b>${x.amount>=0?"+":""}${money(x.amount)}</b> · ${esc(x.type)}<br>${esc(x.note)}<br><span class='small'>${esc(x.created_at)}</span></div>`).join("")||"<p class='muted'>Belum ada mutasi.</p>")}
 catch(e){toast(e.message)}
}
$("#adminBtn").onclick=showAdmin;
async function showAdmin(){
 if(!ensureLogin())return;
 try{
 const [summary,deposits,listings]=await Promise.all([api("/admin/summary"),api("/admin/deposits"),api("/admin/listings")]);
 $("#privateContent").innerHTML=`<h3>Dashboard admin</h3><div class="result-row">Pengguna: <b>${summary.users}</b> · Listing aktif: <b>${summary.listings}</b> · Pesanan: <b>${summary.orders}</b> · Deposit menunggu: <b>${summary.pendingDeposits}</b></div>
 <h3>Verifikasi deposit</h3>${deposits.deposits.map(d=>`<div class="result-row">#${d.id} ${esc(d.name)} (${esc(d.email)}) — ${money(d.amount)}<br>Referensi: ${esc(d.reference)} · <b>${esc(d.status)}</b>${d.status==="pending"?`<div class="actions"><button class="btn" data-approve="${d.id}">Setujui</button><button class="btn light" data-reject="${d.id}">Tolak</button></div>`:""}</div>`).join("")||"<p class='muted'>Tidak ada deposit.</p>"}
 <h3>Moderasi listing</h3>${listings.listings.map(l=>`<div class="result-row">#${l.id} ${esc(l.title)} · ${money(l.price)} · ${esc(l.status)} · ${esc(l.seller_name)}${l.status==="active"?`<div class="actions"><button class="btn light" data-remove="${l.id}">Nonaktifkan</button></div>`:""}</div>`).join("")||"<p class='muted'>Belum ada listing.</p>"}`;
 }catch(e){toast(e.message)}
}
async function boot(){await refreshMe();await loadListings()}
boot();
