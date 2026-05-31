import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBiTrJuKrl2me2VSOVEqvriEL9Q89t7rFw",
  authDomain: "daily-report-20b67.firebaseapp.com",
  projectId: "daily-report-20b67",
  storageBucket: "daily-report-20b67.firebasestorage.app",
  messagingSenderId: "739639003766",
  appId: "1:739639003766:web:72efa892fe44b724b5ed57"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const fmtDate = (s) => { if (!s) return ""; return new Date(s).toLocaleDateString("ja-JP", { year:"numeric", month:"long", day:"numeric", weekday:"short" }); };
const today = () => new Date().toISOString().split("T")[0];
const mkC = () => ({ id: crypto.randomUUID(), name: "", requests: "" });
const mkT = () => ({ id: crypto.randomUUID(), product: "", comment: "" });
const mkR = () => ({ date: today(), title: "", customers: [mkC()], tastings: [mkT()], impression: "" });

const inp = { padding:"9px 12px", border:"1.5px solid #e8d8c4", borderRadius:8, fontSize:14, fontFamily:"inherit", color:"#3d2b1f", background:"#fff", width:"100%" };
const btn = { padding:"9px 20px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#8B5A2B,#c8913a)", color:"#fff", fontSize:14, fontFamily:"inherit", fontWeight:600, cursor:"pointer" };
const ghost = { padding:"9px 16px", borderRadius:8, border:"1.5px solid #e8d8c4", background:"transparent", color:"#8B5A2B", fontSize:13, fontFamily:"inherit", cursor:"pointer" };
const dng = { padding:"9px 16px", borderRadius:8, border:"none", background:"#fdf0f0", color:"#c0392b", fontSize:13, fontFamily:"inherit", cursor:"pointer" };
const smB = { padding:"5px 12px", borderRadius:6, border:"1px solid #e8d8c4", background:"#fff", color:"#8B5A2B", fontSize:12, fontFamily:"inherit", cursor:"pointer" };
const smD = { padding:"5px 12px", borderRadius:6, border:"none", background:"#fdf0f0", color:"#c0392b", fontSize:12, fontFamily:"inherit", cursor:"pointer" };

function Card({ title, children }) {
  return (
    <div style={{ background:"#fff", borderRadius:14, border:"1px solid #e8d8c4", padding:"20px 22px", boxShadow:"0 2px 8px rgba(139,90,43,.05)" }}>
      <div style={{ fontSize:14, fontWeight:700, color:"#8B5A2B", marginBottom:16, paddingBottom:10, borderBottom:"1.5px solid #f0e4d4" }}>{title}</div>
      {children}
    </div>
  );
}
function FL({ children }) { return <div style={{ fontSize:12, color:"#a08060", marginBottom:5, fontWeight:500 }}>{children}</div>; }
function RecBadge() { return <div style={{ position:"absolute", top:8, right:10, zIndex:1, background:"#c0392b", color:"#fff", fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:10, animation:"pulse 1.2s infinite" }}>● REC</div>; }
function VBtn({ active, onClick, label="" }) {
  return (
    <button onClick={onClick} style={{ display:"flex", alignItems:"center", gap:5, padding:label?"7px 12px":"7px 10px", borderRadius:8, border:"none", cursor:"pointer", background:active?"#c0392b":"#3d2b1f", color:"#fff", fontSize:12, fontFamily:"inherit", fontWeight:500 }}>
      <span>{active ? "⏹" : "🎤"}</span>{label && (active ? "停止" : label)}
    </button>
  );
}

export default function App() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbErr, setDbErr] = useState(false);
  const [view, setView] = useState("list");
  const [editing, setEditing] = useState(null);
  const [editDocId, setEditDocId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [isRec, setIsRec] = useState(false);
  const [recTarget, setRecTarget] = useState(null);
  const [notif, setNotif] = useState(null);
  const recRef = useRef(null);
  const isRecRef = useRef(false);
  const recTargetRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "reports"), orderBy("date", "desc"));
    return onSnapshot(q, (snap) => { setReports(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoading(false); setDbErr(false); }, () => { setLoading(false); setDbErr(true); });
  }, []);

  const notify = useCallback((msg, type="ok") => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);

  const applyText = useCallback((target, text) => {
    setEditing(prev => {
      if (!prev) return prev;
      const n = { ...prev };
      const [f, i] = target.split("::");
      if (f === "impression") n.impression = (n.impression||"") + text;
      else if (f === "cname") n.customers = n.customers.map((c,j) => String(j)===i ? {...c, name:(c.name||"")+text} : c);
      else if (f === "creq")  n.customers = n.customers.map((c,j) => String(j)===i ? {...c, requests:(c.requests||"")+text} : c);
      else if (f === "tprod") n.tastings  = n.tastings.map((t,j)  => String(j)===i ? {...t, product:(t.product||"")+text} : t);
      else if (f === "tcom")  n.tastings  = n.tastings.map((t,j)  => String(j)===i ? {...t, comment:(t.comment||"")+text} : t);
      return n;
    });
  }, []);

  const mkRec = useCallback((target) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "ja-JP"; r.continuous = false; r.interimResults = false;
    r.onresult = (e) => { let s=""; for (let i=0;i<e.results.length;i++) if (e.results[i].isFinal) s+=e.results[i][0].transcript; if (s) applyText(target, s); };
    r.onerror = (e) => {
      if (e.error==="no-speech") { if (isRecRef.current) { try { const r2=mkRec(target); r2?.start(); recRef.current=r2; } catch{} } return; }
      if (e.error==="aborted") return;
      const m = { "not-allowed":"マイクの使用が許可されていません。", "audio-capture":"マイクが見つかりません。", "network":"ネットワークエラー。" };
      notify(m[e.error]||"音声認識エラー:"+e.error, "err");
      isRecRef.current=false; setIsRec(false); setRecTarget(null);
    };
    r.onend = () => { if (isRecRef.current) { try { const r2=mkRec(target); r2?.start(); recRef.current=r2; } catch{} } };
    return r;
  }, [applyText, notify]);

  const startRec = useCallback((target) => {
    if (!(window.SpeechRecognition||window.webkitSpeechRecognition)) { notify("ChromeまたはEdgeをご利用ください", "err"); return; }
    isRecRef.current=true; recTargetRef.current=target;
    const r = mkRec(target);
    if (!r) return;
    try { r.start(); recRef.current=r; setIsRec(true); setRecTarget(target); } catch { notify("音声入力を開始できませんでした", "err"); isRecRef.current=false; }
  }, [mkRec, notify]);

  const stopRec = useCallback(() => {
    isRecRef.current=false; recTargetRef.current=null;
    try { recRef.current?.stop(); } catch {}
    recRef.current=null; setIsRec(false); setRecTarget(null);
  }, []);

  const toggleRec = useCallback((target) => {
    if (isRecRef.current && recTargetRef.current===target) stopRec();
    else { if (isRecRef.current) stopRec(); setTimeout(() => startRec(target), 100); }
  }, [startRec, stopRec]);

  const save = async () => {
    if (!editing.date) { notify("日付を入力してください", "err"); return; }
    setSaving(true);
    try {
      const p = { ...editing, updatedAt: serverTimestamp() };
      if (editDocId) await updateDoc(doc(db,"reports",editDocId), p);
      else await addDoc(collection(db,"reports"), { ...p, createdAt: serverTimestamp() });
      notify("保存しました"); setView("list");
    } catch(e) { notify("保存失敗: "+e.message, "err"); }
    setSaving(false);
  };

  const del = async (id) => {
    if (!confirm("削除しますか？")) return;
    try { await deleteDoc(doc(db,"reports",id)); notify("削除しました"); setView("list"); } catch(e) { notify("削除失敗: "+e.message,"err"); }
  };

  const filtered = reports.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.date,r.title,...(r.customers||[]).flatMap(c=>[c.name,c.requests]),...(r.tastings||[]).flatMap(t=>[t.product,t.comment]),r.impression].some(t=>t?.toLowerCase().includes(q));
  });

  const sf = (k,v) => setEditing(p=>({...p,[k]:v}));
  const sc = (i,k,v) => setEditing(p=>({...p,customers:p.customers.map((c,j)=>j===i?{...c,[k]:v}:c)}));
  const st = (i,k,v) => setEditing(p=>({...p,tastings:p.tastings.map((t,j)=>j===i?{...t,[k]:v}:t)}));
  const ac = () => setEditing(p=>({...p,customers:[...p.customers,mkC()]}));
  const rc = (i) => setEditing(p=>({...p,customers:p.customers.filter((_,j)=>j!==i)}));
  const at = () => setEditing(p=>({...p,tastings:[...p.tastings,mkT()]}));
  const rt = (i) => setEditing(p=>({...p,tastings:p.tastings.filter((_,j)=>j!==i)}));
  const ir = (t) => isRec && recTarget===t;

  return (
    <div style={{ minHeight:"100vh", background:"#f8f5f0", fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif", color:"#1a1a2e" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input,textarea,select{outline:none;}textarea{resize:vertical;}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes spin{to{transform:rotate(360deg)}}.rc{transition:all .2s;}.rc:hover{box-shadow:0 4px 20px rgba(139,90,43,.12);transform:translateY(-1px);}`}</style>

      {notif && <div style={{ position:"fixed",top:20,right:20,zIndex:999,padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:500,background:notif.type==="err"?"#c0392b":"#2d6a4f",color:"#fff",boxShadow:"0 4px 16px rgba(0,0,0,.2)",maxWidth:320 }}>{notif.msg}</div>}

      <header style={{ background:"#fff",borderBottom:"2px solid #e8d8c4",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(139,90,43,.06)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#8B5A2B,#c8913a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff" }}>🤝</div>
          <div>
            <div style={{ fontSize:17,fontWeight:700,color:"#3d2b1f" }}>営業日報</div>
            <div style={{ fontSize:10,color:"#a08060",display:"flex",alignItems:"center",gap:4 }}>SALES DAILY REPORT <span style={{ width:6,height:6,borderRadius:"50%",background:dbErr?"#e74c3c":"#27ae60",display:"inline-block" }}/></div>
          </div>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          {view!=="list" && <button onClick={()=>{setView("list");setEditing(null);}} style={ghost}>← 一覧</button>}
          {view==="list" && <button onClick={()=>{setEditing(mkR());setEditDocId(null);setView("editor");}} style={btn}>＋ 新規作成</button>}
          {view==="editor" && <button onClick={save} disabled={saving} style={{...btn,opacity:saving?.7:1}}>{saving?"保存中…":"💾 保存"}</button>}
          {view==="detail" && <><button onClick={()=>{const{_id,createdAt,updatedAt,...r}=detail;setEditing(JSON.parse(JSON.stringify(r)));setEditDocId(_id);setView("editor");}} style={ghost}>✏️ 編集</button><button onClick={()=>del(detail._id)} style={dng}>🗑 削除</button></>}
        </div>
      </header>

      <main style={{ maxWidth:860,margin:"0 auto",padding:"28px 16px" }}>
        {dbErr && <div style={{ background:"#fdf0f0",border:"1px solid #e74c3c",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#c0392b" }}>⚠️ Firestore接続エラー。セキュリティルールを確認してください。</div>}

        {view==="list" && <>
          <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e8d8c4",padding:"16px 20px",marginBottom:20 }}>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#c8a070" }}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="お客様名・商品名・キーワードで検索..." style={{ width:"100%",padding:"10px 12px 10px 38px",border:"1.5px solid #e8d8c4",borderRadius:8,fontSize:14,fontFamily:"inherit",color:"#3d2b1f",background:"#fdfaf7" }}/>
            </div>
            {search && <div style={{ marginTop:8,fontSize:12,color:"#a08060" }}>「{search}」の検索結果：{filtered.length} 件</div>}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20 }}>
            {[{l:"累計日報",v:reports.length,i:"📋"},{l:"今月",v:reports.filter(r=>r.date?.startsWith(new Date().toISOString().slice(0,7))).length,i:"📅"},{l:"訪問客数（累計）",v:reports.reduce((s,r)=>s+(r.customers?.filter(c=>c.name).length||0),0),i:"🏪"}].map(s=>(
              <div key={s.l} style={{ background:"#fff",borderRadius:12,border:"1px solid #e8d8c4",padding:"14px 16px",textAlign:"center" }}>
                <div style={{ fontSize:22,marginBottom:4 }}>{s.i}</div>
                <div style={{ fontSize:26,fontWeight:700,color:"#8B5A2B" }}>{s.v}</div>
                <div style={{ fontSize:11,color:"#a08060" }}>{s.l}</div>
              </div>
            ))}
          </div>
          {loading ? (
            <div style={{ textAlign:"center",padding:"60px 20px",color:"#a08060" }}>
              <div style={{ width:32,height:32,border:"3px solid #e8d8c4",borderTop:"3px solid #8B5A2B",borderRadius:"50%",margin:"0 auto 12px",animation:"spin 1s linear infinite" }}/>読み込み中...
            </div>
          ) : filtered.length===0 ? (
            <div style={{ textAlign:"center",padding:"56px 20px",background:"#fff",borderRadius:14,border:"1.5px dashed #e8d8c4" }}>
              <div style={{ fontSize:44,marginBottom:12 }}>📝</div>
              <div style={{ color:"#a08060" }}>{search?"検索結果がありません":"日報がありません。新規作成してください。"}</div>
            </div>
          ) : (
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {filtered.map(r=>{
                const names=(r.customers||[]).filter(c=>c.name).map(c=>c.name).join("・");
                return (
                  <div key={r._id} className="rc" onClick={()=>{setDetail(r);setView("detail");}} style={{ background:"#fff",borderRadius:12,border:"1px solid #e8d8c4",padding:"16px 20px",cursor:"pointer" }}>
                    <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10 }}>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:12,color:"#a08060",marginBottom:5 }}>{fmtDate(r.date)}</div>
                        <div style={{ fontWeight:700,fontSize:15,color:"#3d2b1f",marginBottom:6 }}>{r.title||fmtDate(r.date)+" の日報"}</div>
                        {names && <div style={{ fontSize:13,color:"#5a3e28",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>🏪 {names}</div>}
                      </div>
                      <div style={{ display:"flex",gap:6,flexShrink:0 }}>
                        <button onClick={e=>{e.stopPropagation();const{_id,createdAt,updatedAt,...rr}=r;setEditing(JSON.parse(JSON.stringify(rr)));setEditDocId(_id);setView("editor");}} style={smB}>編集</button>
                        <button onClick={e=>{e.stopPropagation();del(r._id);}} style={smD}>削除</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>}

        {view==="detail" && detail && (
          <div style={{ background:"#fff",borderRadius:16,border:"1px solid #e8d8c4",overflow:"hidden" }}>
            <div style={{ background:"linear-gradient(135deg,#3d2b1f,#8B5A2B)",padding:"24px 28px" }}>
              <div style={{ fontSize:12,color:"#c8a070",marginBottom:6 }}>SALES REPORT</div>
              <div style={{ fontSize:22,fontWeight:700,color:"#fff" }}>{detail.title||fmtDate(detail.date)+" の日報"}</div>
              <div style={{ fontSize:13,color:"#e8c8a0",marginTop:4 }}>{fmtDate(detail.date)}</div>
            </div>
            <div style={{ padding:28 }}>
              {(detail.customers||[]).filter(c=>c.name).length>0 && <>
                <div style={{ fontSize:14,fontWeight:700,color:"#8B5A2B",marginBottom:12,paddingBottom:6,borderBottom:"1.5px solid #e8d8c4" }}>🏪 お伺いしたお客様</div>
                {(detail.customers||[]).filter(c=>c.name).map((c,i)=>(
                  <div key={i} style={{ marginBottom:16 }}>
                    <div style={{ fontWeight:600,fontSize:15,color:"#3d2b1f",marginBottom:4 }}>{i+1}. {c.name}</div>
                    {c.requests && <div style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:8,padding:"10px 14px",fontSize:14,color:"#5a3e28",lineHeight:1.8,whiteSpace:"pre-wrap" }}><span style={{ fontSize:11,color:"#a08060",display:"block",marginBottom:4 }}>▸ お願いごと</span>{c.requests}</div>}
                  </div>
                ))}
              </>}
              {(detail.tastings||[]).some(t=>t.product) && <>
                <div style={{ fontSize:14,fontWeight:700,color:"#8B5A2B",margin:"20px 0 12px",paddingBottom:6,borderBottom:"1.5px solid #e8d8c4" }}>🍵 試飲に持ち込んだ商品</div>
                {(detail.tastings||[]).filter(t=>t.product).map((t,i)=>(
                  <div key={i} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:10,padding:"12px 16px",marginBottom:10 }}>
                    <div style={{ fontWeight:600,fontSize:14,color:"#3d2b1f",marginBottom:t.comment?6:0 }}>📦 {t.product}</div>
                    {t.comment && <div style={{ fontSize:13,color:"#5a3e28",lineHeight:1.7,whiteSpace:"pre-wrap" }}>{t.comment}</div>}
                  </div>
                ))}
              </>}
              {detail.impression && <>
                <div style={{ fontSize:14,fontWeight:700,color:"#8B5A2B",margin:"20px 0 12px",paddingBottom:6,borderBottom:"1.5px solid #e8d8c4" }}>💭 所感</div>
                <div style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:10,padding:"14px 16px",fontSize:14,color:"#5a3e28",lineHeight:1.8,whiteSpace:"pre-wrap" }}>{detail.impression}</div>
              </>}
            </div>
          </div>
        )}

        {view==="editor" && editing && (
          <div style={{ display:"flex",flexDirection:"column",gap:18 }}>
            <Card title="基本情報">
              <div style={{ display:"grid",gridTemplateColumns:"160px 1fr",gap:12 }}>
                <div><FL>日付</FL><input type="date" value={editing.date} onChange={e=>sf("date",e.target.value)} style={inp}/></div>
                <div><FL>タイトル（任意）</FL><input value={editing.title||""} onChange={e=>sf("title",e.target.value)} placeholder="例：〇〇エリア 訪問日報" style={inp}/></div>
              </div>
            </Card>

            <Card title="🏪 お伺いしたお客様">
              {editing.customers.map((c,i)=>(
                <div key={c.id} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:12,padding:"16px",marginBottom:12 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{ fontSize:13,fontWeight:600,color:"#8B5A2B" }}>お客様 {i+1}</span>
                    {editing.customers.length>1 && <button onClick={()=>rc(i)} style={{...smD,padding:"3px 10px",fontSize:11}}>削除</button>}
                  </div>
                  <FL>店名・お客様名</FL>
                  <div style={{ display:"flex",gap:8,marginBottom:12 }}>
                    <input value={c.name} onChange={e=>sc(i,"name",e.target.value)} placeholder="例：〇〇商店" style={{...inp,flex:1}}/>
                    <VBtn active={ir("cname::"+i)} onClick={()=>toggleRec("cname::"+i)}/>
                  </div>
                  <FL>お客様からのお願いごと</FL>
                  <div style={{ position:"relative" }}>
                    {ir("creq::"+i) && <RecBadge/>}
                    <textarea value={c.requests} onChange={e=>sc(i,"requests",e.target.value)} placeholder="商品のお見積り、サービスの改善点、お探しの商品の確認など..." rows={3} style={{...inp,fontFamily:"inherit",lineHeight:1.8}}/>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <VBtn active={ir("creq::"+i)} onClick={()=>toggleRec("creq::"+i)} label="音声入力"/>
                  </div>
                </div>
              ))}
              <button onClick={ac} style={{ width:"100%",padding:"10px",borderRadius:8,border:"1.5px dashed #c8a070",background:"transparent",color:"#8B5A2B",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>＋ お客様を追加</button>
            </Card>

            <Card title="🍵 試飲に持ち込んだ商品">
              {editing.tastings.map((t,i)=>(
                <div key={t.id} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:12,padding:"16px",marginBottom:12 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{ fontSize:13,fontWeight:600,color:"#8B5A2B" }}>商品 {i+1}</span>
                    {editing.tastings.length>1 && <button onClick={()=>rt(i)} style={{...smD,padding:"3px 10px",fontSize:11}}>削除</button>}
                  </div>
                  <FL>商品名</FL>
                  <div style={{ display:"flex",gap:8,marginBottom:12 }}>
                    <input value={t.product} onChange={e=>st(i,"product",e.target.value)} placeholder="例：〇〇茶 新商品" style={{...inp,flex:1}}/>
                    <VBtn active={ir("tprod::"+i)} onClick={()=>toggleRec("tprod::"+i)}/>
                  </div>
                  <FL>お客様のコメント・反応</FL>
                  <div style={{ position:"relative" }}>
                    {ir("tcom::"+i) && <RecBadge/>}
                    <textarea value={t.comment} onChange={e=>st(i,"comment",e.target.value)} placeholder="お客様の感想・反応・評価など..." rows={3} style={{...inp,fontFamily:"inherit",lineHeight:1.8}}/>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <VBtn active={ir("tcom::"+i)} onClick={()=>toggleRec("tcom::"+i)} label="音声入力"/>
                  </div>
                </div>
              ))}
              <button onClick={at} style={{ width:"100%",padding:"10px",borderRadius:8,border:"1.5px dashed #c8a070",background:"transparent",color:"#8B5A2B",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>＋ 商品を追加</button>
            </Card>

            <Card title="💭 所感">
              <div style={{ position:"relative" }}>
                {ir("impression") && <RecBadge/>}
                <textarea value={editing.impression||""} onChange={e=>sf("impression",e.target.value)} placeholder="本日の訪問を通じた気づき・感想・次回への引き継ぎ事項など..." rows={5} style={{...inp,fontFamily:"inherit",lineHeight:1.8}}/>
              </div>
              <div style={{ marginTop:8 }}>
                <VBtn active={ir("impression")} onClick={()=>toggleRec("impression")} label="音声入力"/>
              </div>
            </Card>

            <div style={{ display:"flex",justifyContent:"flex-end",gap:10 }}>
              <button onClick={()=>setView("list")} style={ghost}>キャンセル</button>
              <button onClick={save} disabled={saving} style={{...btn,opacity:saving?.7:1}}>{saving?"保存中…":"💾 日報を保存する"}</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
