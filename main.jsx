import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp
} from "firebase/firestore";

// ── Firebase 初期化 ──
const firebaseConfig = {
  apiKey: "AIzaSyBiTrJuKrl2me2VSOVEqvriEL9Q89t7rFw",
  authDomain: "daily-report-20b67.firebaseapp.com",
  projectId: "daily-report-20b67",
  storageBucket: "daily-report-20b67.firebasestorage.app",
  messagingSenderId: "739639003766",
  appId: "1:739639003766:web:72efa892fe44b724b5ed57"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── ユーティリティ ──
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}
function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}
function newCustomer() {
  return { id: crypto.randomUUID(), name: "", requests: "" };
}
function newTasting() {
  return { id: crypto.randomUUID(), product: "", comment: "" };
}
function newReport() {
  return {
    date: getTodayStr(),
    title: "",
    customers: [newCustomer()],
    tastings: [newTasting()],
    impression: "",
  };
}

export default function App() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [view, setView] = useState("list");
  const [editing, setEditing] = useState(null);
  const [editingDocId, setEditingDocId] = useState(null);
  const [detailReport, setDetailReport] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTarget, setRecordingTarget] = useState(null);
  const [aiLoading, setAiLoading] = useState(null);
  const [notif, setNotif] = useState(null);
  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);
  const recordingTargetRef = useRef(null);

  // ── Firestore リアルタイム購読 ──
  useEffect(() => {
    const q = query(collection(db, "reports"), orderBy("date", "desc"));
    const unsub = onSnapshot(q,
      (snap) => {
        const data = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        setReports(data);
        setLoading(false);
        setDbError(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        setDbError(true);
      }
    );
    return () => unsub();
  }, []);

  const notify = useCallback((msg, type = "ok") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  }, []);

  // ── 音声入力 ──
  const applyTranscript = useCallback((target, text) => {
    setEditing(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      const [field, idx] = target.split("::");
      if (field === "impression") {
        next.impression = (next.impression || "") + text;
      } else if (field === "customerName") {
        next.customers = next.customers.map((c, i) =>
          String(i) === idx ? { ...c, name: (c.name || "") + text } : c);
      } else if (field === "customerReq") {
        next.customers = next.customers.map((c, i) =>
          String(i) === idx ? { ...c, requests: (c.requests || "") + text } : c);
      } else if (field === "tastingProduct") {
        next.tastings = next.tastings.map((t, i) =>
          String(i) === idx ? { ...t, product: (t.product || "") + text } : t);
      } else if (field === "tastingComment") {
        next.tastings = next.tastings.map((t, i) =>
          String(i) === idx ? { ...t, comment: (t.comment || "") + text } : t);
      }
      return next;
    });
  }, []);

  const createRecognition = useCallback((target) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) applyTranscript(target, final);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") {
        if (isRecordingRef.current) {
          try { const r2 = createRecognition(target); r2?.start(); recognitionRef.current = r2; } catch {}
        }
        return;
      }
      if (e.error === "aborted") return;
      const msgs = {
        "not-allowed": "マイクの使用が許可されていません。ブラウザの設定を確認してください。",
        "audio-capture": "マイクが見つかりません。接続を確認してください。",
        "network": "ネットワークエラーが発生しました。",
        "service-not-allowed": "音声認識サービスが利用できません。",
      };
      notify(msgs[e.error] || `音声認識エラー：${e.error}`, "err");
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingTarget(null);
    };
    rec.onend = () => {
      if (isRecordingRef.current) {
        try { const r2 = createRecognition(target); r2?.start(); recognitionRef.current = r2; } catch {}
      }
    };
    return rec;
  }, [applyTranscript, notify]);

  const startRecording = useCallback((target) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { notify("このブラウザは音声入力に対応していません。ChromeまたはEdgeをお使いください。", "err"); return; }
    isRecordingRef.current = true;
    recordingTargetRef.current = target;
    const rec = createRecognition(target);
    if (!rec) return;
    try {
      rec.start();
      recognitionRef.current = rec;
      setIsRecording(true);
      setRecordingTarget(target);
    } catch {
      notify("音声入力を開始できませんでした。", "err");
      isRecordingRef.current = false;
    }
  }, [createRecognition, notify]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    recordingTargetRef.current = null;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
    setIsRecording(false);
    setRecordingTarget(null);
  }, []);

  const toggleVoice = useCallback((target) => {
    if (isRecordingRef.current && recordingTargetRef.current === target) {
      stopRecording();
    } else {
      if (isRecordingRef.current) stopRecording();
      setTimeout(() => startRecording(target), 100);
    }
  }, [startRecording, stopRecording]);

  // ── AI整形 ──
  const polishAI = async (getText, setText) => {
    const text = getText();
    if (!text?.trim()) { notify("テキストを入力してください", "err"); return; }
    setAiLoading(text.slice(0, 20));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `以下の営業日報テキストを、ビジネス向けに自然で簡潔な日本語に整形してください。内容・意味は変えず、誤字脱字の修正と文章整形のみ行ってください。整形後のテキストのみ返してください。\n\n${text}`
          }]
        })
      });
      const data = await res.json();
      setText(data.content?.[0]?.text || text);
      notify("AI整形しました ✨");
    } catch { notify("AI整形に失敗しました", "err"); }
    setAiLoading(null);
  };

  // ── CRUD (Firestore) ──
  const openNew = () => { setEditing(newReport()); setEditingDocId(null); setView("editor"); };
  const openEdit = (r) => {
    const { _docId, createdAt, updatedAt, ...rest } = r;
    setEditing(JSON.parse(JSON.stringify(rest)));
    setEditingDocId(_docId);
    setView("editor");
  };
  const openDetail = (r) => { setDetailReport(r); setView("detail"); };

  const save = async () => {
    if (!editing.date) { notify("日付を入力してください", "err"); return; }
    setSaving(true);
    try {
      const payload = { ...editing, updatedAt: serverTimestamp() };
      if (editingDocId) {
        await updateDoc(doc(db, "reports", editingDocId), payload);
      } else {
        await addDoc(collection(db, "reports"), { ...payload, createdAt: serverTimestamp() });
      }
      notify("保存しました ✅");
      setView("list");
    } catch (e) {
      notify("保存に失敗しました：" + e.message, "err");
    }
    setSaving(false);
  };

  const del = async (docId) => {
    if (!confirm("この日報を削除しますか？")) return;
    try {
      await deleteDoc(doc(db, "reports", docId));
      notify("削除しました");
      setView("list");
    } catch (e) {
      notify("削除に失敗しました：" + e.message, "err");
    }
  };

  // ── 検索 ──
  const filtered = reports.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return [
      r.date, r.title,
      ...(r.customers || []).flatMap(c => [c.name, c.requests]),
      ...(r.tastings || []).flatMap(t => [t.product, t.comment]),
      r.impression,
    ].some(t => t?.toLowerCase().includes(q));
  });

  // ── フィールド操作 ──
  const setField = (key, val) => setEditing(p => ({ ...p, [key]: val }));
  const setCustomer = (idx, key, val) => setEditing(p => ({
    ...p, customers: p.customers.map((c, i) => i === idx ? { ...c, [key]: val } : c)
  }));
  const setTasting = (idx, key, val) => setEditing(p => ({
    ...p, tastings: p.tastings.map((t, i) => i === idx ? { ...t, [key]: val } : t)
  }));
  const addCustomer = () => setEditing(p => ({ ...p, customers: [...p.customers, newCustomer()] }));
  const removeCustomer = (idx) => setEditing(p => ({ ...p, customers: p.customers.filter((_, i) => i !== idx) }));
  const addTasting = () => setEditing(p => ({ ...p, tastings: [...p.tastings, newTasting()] }));
  const removeTasting = (idx) => setEditing(p => ({ ...p, tastings: p.tastings.filter((_, i) => i !== idx) }));
  const isRec = (t) => isRecording && recordingTarget === t;

  return (
    <div style={{ minHeight: "100vh", background: "#f8f5f0", fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif", color: "#1a1a2e" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input,textarea,select{outline:none;}
        textarea{resize:vertical;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-thumb{background:#c8b9a0;border-radius:4px;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .card{animation:fadeIn .25s ease;}
        .report-card:hover{box-shadow:0 4px 20px rgba(139,90,43,.12);transform:translateY(-1px);}
        .report-card{transition:all .2s;}
      `}</style>

      {notif && (
        <div style={{ position:"fixed",top:20,right:20,zIndex:999,padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:500,background:notif.type==="err"?"#c0392b":"#2d6a4f",color:"#fff",boxShadow:"0 4px 16px rgba(0,0,0,.2)",animation:"fadeIn .2s ease",maxWidth:320 }}>
          {notif.msg}
        </div>
      )}

      <header style={{ background:"#fff",borderBottom:"2px solid #e8d8c4",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(139,90,43,.06)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#8B5A2B,#c8913a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff" }}>🤝</div>
          <div>
            <div style={{ fontSize:17,fontWeight:700,letterSpacing:".5px",color:"#3d2b1f" }}>営業日報</div>
            <div style={{ fontSize:10,color:"#a08060",letterSpacing:"1px",display:"flex",alignItems:"center",gap:4 }}>
              SALES DAILY REPORT
              <span style={{ width:6,height:6,borderRadius:"50%",background:dbError?"#e74c3c":"#27ae60",display:"inline-block" }} title={dbError?"DB接続エラー":"クラウド接続中"} />
            </div>
          </div>
        </div>
        <div style={{ display:"flex",gap:8,alignItems:"center" }}>
          {view !== "list" && <button onClick={() => { setView("list"); setEditing(null); }} style={ghost}>← 一覧</button>}
          {view === "list" && <button onClick={openNew} style={primary}>＋ 新規作成</button>}
          {view === "editor" && <button onClick={save} disabled={saving} style={{ ...primary, opacity: saving ? .7 : 1 }}>{saving ? "保存中…" : "💾 保存"}</button>}
          {view === "detail" && <>
            <button onClick={() => openEdit(detailReport)} style={ghost}>✏️ 編集</button>
            <button onClick={() => del(detailReport._docId)} style={danger}>🗑 削除</button>
          </>}
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 16px" }}>

        {dbError && (
          <div style={{ background:"#fdf0f0",border:"1px solid #e74c3c",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#c0392b" }}>
            ⚠️ Firestoreへの接続に失敗しました。Firebaseコンソールでセキュリティルールを確認してください。
          </div>
        )}

        {/* LIST */}
        {view === "list" && (
          <div className="card">
            <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e8d8c4",padding:"16px 20px",marginBottom:20,boxShadow:"0 2px 8px rgba(139,90,43,.05)" }}>
              <div style={{ position:"relative" }}>
                <span style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#c8a070",fontSize:16 }}>🔍</span>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="お客様名・商品名・キーワードで検索..."
                  style={{ width:"100%",padding:"10px 12px 10px 38px",border:"1.5px solid #e8d8c4",borderRadius:8,fontSize:14,fontFamily:"inherit",color:"#3d2b1f",background:"#fdfaf7" }}
                />
              </div>
              {searchQuery && <div style={{ marginTop:8,fontSize:12,color:"#a08060" }}>「{searchQuery}」の検索結果：{filtered.length} 件</div>}
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20 }}>
              {[
                { label:"累計日報", val:reports.length, icon:"📋" },
                { label:"今月", val:reports.filter(r => r.date?.startsWith(new Date().toISOString().slice(0,7))).length, icon:"📅" },
                { label:"訪問客数（累計）", val:reports.reduce((s,r) => s + (r.customers?.filter(c => c.name).length || 0), 0), icon:"🏪" },
              ].map(s => (
                <div key={s.label} style={{ background:"#fff",borderRadius:12,border:"1px solid #e8d8c4",padding:"14px 16px",textAlign:"center",boxShadow:"0 2px 8px rgba(139,90,43,.04)" }}>
                  <div style={{ fontSize:22,marginBottom:4 }}>{s.icon}</div>
                  <div style={{ fontSize:26,fontWeight:700,color:"#8B5A2B" }}>{s.val}</div>
                  <div style={{ fontSize:11,color:"#a08060" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {loading ? (
              <div style={{ textAlign:"center",padding:"60px 20px",color:"#a08060" }}>
                <div style={{ width:32,height:32,border:"3px solid #e8d8c4",borderTop:"3px solid #8B5A2B",borderRadius:"50%",margin:"0 auto 12px",animation:"spin 1s linear infinite" }} />
                データを読み込んでいます...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:"center",padding:"56px 20px",background:"#fff",borderRadius:14,border:"1.5px dashed #e8d8c4" }}>
                <div style={{ fontSize:44,marginBottom:12 }}>📝</div>
                <div style={{ color:"#a08060",fontSize:15 }}>{searchQuery ? "検索結果がありません" : "日報がありません。新規作成してください。"}</div>
              </div>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {filtered.map(r => {
                  const custNames = (r.customers || []).filter(c => c.name).map(c => c.name).join("・");
                  return (
                    <div key={r._docId} className="report-card" onClick={() => openDetail(r)} style={{ background:"#fff",borderRadius:12,border:"1px solid #e8d8c4",padding:"16px 20px",cursor:"pointer",boxShadow:"0 1px 4px rgba(139,90,43,.05)" }}>
                      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10 }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:12,color:"#a08060",marginBottom:5 }}>{formatDate(r.date)}</div>
                          <div style={{ fontWeight:700,fontSize:15,color:"#3d2b1f",marginBottom:6 }}>{r.title || formatDate(r.date) + " の日報"}</div>
                          {custNames && <div style={{ display:"flex",alignItems:"center",gap:6 }}><span style={{ fontSize:12,color:"#8B5A2B" }}>🏪</span><span style={{ fontSize:13,color:"#5a3e28",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{custNames}</span></div>}
                        </div>
                        <div style={{ display:"flex",gap:6,flexShrink:0 }}>
                          <button onClick={e => { e.stopPropagation(); openEdit(r); }} style={smBtn}>編集</button>
                          <button onClick={e => { e.stopPropagation(); del(r._docId); }} style={smDanger}>削除</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* DETAIL */}
        {view === "detail" && detailReport && (
          <div className="card" style={{ background:"#fff",borderRadius:16,border:"1px solid #e8d8c4",overflow:"hidden",boxShadow:"0 4px 20px rgba(139,90,43,.08)" }}>
            <div style={{ background:"linear-gradient(135deg,#3d2b1f,#8B5A2B)",padding:"24px 28px" }}>
              <div style={{ fontSize:12,color:"#c8a070",marginBottom:6,letterSpacing:1 }}>SALES REPORT</div>
              <div style={{ fontSize:22,fontWeight:700,color:"#fff" }}>{detailReport.title || formatDate(detailReport.date) + " の日報"}</div>
              <div style={{ fontSize:13,color:"#e8c8a0",marginTop:4 }}>{formatDate(detailReport.date)}</div>
            </div>
            <div style={{ padding:28 }}>
              <Section title="🏪 お伺いしたお客様">
                {(detailReport.customers || []).filter(c => c.name).map((c, i) => (
                  <div key={i} style={{ marginBottom:16 }}>
                    <div style={{ fontWeight:600,fontSize:15,color:"#3d2b1f",marginBottom:4 }}>{i + 1}. {c.name}</div>
                    {c.requests && <div style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:8,padding:"10px 14px",fontSize:14,color:"#5a3e28",lineHeight:1.8,whiteSpace:"pre-wrap" }}><span style={{ fontSize:11,color:"#a08060",display:"block",marginBottom:4 }}>▸ お願いごと</span>{c.requests}</div>}
                  </div>
                ))}
              </Section>
              {(detailReport.tastings || []).some(t => t.product) && (
                <Section title="🍵 試飲に持ち込んだ商品">
                  {(detailReport.tastings || []).filter(t => t.product).map((t, i) => (
                    <div key={i} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:10,padding:"12px 16px",marginBottom:10 }}>
                      <div style={{ fontWeight:600,fontSize:14,color:"#3d2b1f",marginBottom:t.comment ? 6 : 0 }}>📦 {t.product}</div>
                      {t.comment && <div style={{ fontSize:13,color:"#5a3e28",lineHeight:1.7,whiteSpace:"pre-wrap" }}>{t.comment}</div>}
                    </div>
                  ))}
                </Section>
              )}
              {detailReport.impression && (
                <Section title="💭 所感">
                  <div style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:10,padding:"14px 16px",fontSize:14,color:"#5a3e28",lineHeight:1.8,whiteSpace:"pre-wrap" }}>{detailReport.impression}</div>
                </Section>
              )}
            </div>
          </div>
        )}

        {/* EDITOR */}
        {view === "editor" && editing && (
          <div className="card" style={{ display:"flex",flexDirection:"column",gap:18 }}>
            <EditorCard title="基本情報">
              <div style={{ display:"grid",gridTemplateColumns:"160px 1fr",gap:12 }}>
                <div>
                  <FieldLabel>日付</FieldLabel>
                  <input type="date" value={editing.date} onChange={e => setField("date", e.target.value)} style={inp} />
                </div>
                <div>
                  <FieldLabel>タイトル（任意）</FieldLabel>
                  <input value={editing.title || ""} onChange={e => setField("title", e.target.value)} placeholder="例：〇〇エリア 訪問日報" style={inp} />
                </div>
              </div>
            </EditorCard>

            <EditorCard title="🏪 お伺いしたお客様">
              {editing.customers.map((c, idx) => (
                <div key={c.id} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:12,padding:"16px",marginBottom:12 }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{ fontSize:13,fontWeight:600,color:"#8B5A2B" }}>お客様 {idx + 1}</span>
                    {editing.customers.length > 1 && <button onClick={() => removeCustomer(idx)} style={{ ...smDanger, padding:"3px 10px", fontSize:11 }}>削除</button>}
                  </div>
                  <FieldLabel>店名・お客様名</FieldLabel>
                  <div style={{ display:"flex",gap:8,marginBottom:12 }}>
                    <input value={c.name} onChange={e => setCustomer(idx, "name", e.target.value)} placeholder="例：〇〇商店" style={{ ...inp, flex:1 }} />
                    <VoiceBtn active={isRec(`customerName::${idx}`)} onClick={() => toggleVoice(`customerName::${idx}`)} />
                  </div>
                  <FieldLabel>お客様からのお願いごと</FieldLabel>
                  <div style={{ position:"relative" }}>
                    {isRec(`customerReq::${idx}`) && <RecBadge />}
                    <textarea value={c.requests} onChange={e => setCustomer(idx, "requests", e.target.value)} placeholder="商品のお見積り、サービスの改善点、お探しの商品の確認など..." rows={3} style={{ ...inp, width:"100%", fontFamily:"inherit", lineHeight:1.8 }} />
                  </div>
                  <div style={{ display:"flex",gap:6,marginTop:6 }}>
                    <VoiceBtn active={isRec(`customerReq::${idx}`)} onClick={() => toggleVoice(`customerReq::${idx}`)} label="音声入力" />
                    <AIBtn loading={aiLoading === (c.requests || "").slice(0, 20)} onClick={() => polishAI(() => c.requests, val => setCustomer(idx, "requests", val))} />
                  </div>
                </div>
              ))}
              <button onClick={addCustomer} style={{ width:"100%",padding:"10px",borderRadius:8,border:"1.5px dashed #c8a070",background:"transparent",color:"#8B5A2B",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>
                ＋ お客様を追加
              </button>
            </EditorCard>

            <EditorCard title="🍵 試飲に持ち込んだ商品">
              {editing.tastings.map((t, idx) => (
                <div key={t.id} style={{ background:"#fdfaf7",border:"1px solid #e8d8c4",borderRadius:12,padding:"16px",marginBottom:12 }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{ fontSize:13,fontWeight:600,color:"#8B5A2B" }}>商品 {idx + 1}</span>
                    {editing.tastings.length > 1 && <button onClick={() => removeTasting(idx)} style={{ ...smDanger, padding:"3px 10px", fontSize:11 }}>削除</button>}
                  </div>
                  <FieldLabel>商品名</FieldLabel>
                  <div style={{ display:"flex",gap:8,marginBottom:12 }}>
                    <input value={t.product} onChange={e => setTasting(idx, "product", e.target.value)} placeholder="例：〇〇茶 新商品" style={{ ...inp, flex:1 }} />
                    <VoiceBtn active={isRec(`tastingProduct::${idx}`)} onClick={() => toggleVoice(`tastingProduct::${idx}`)} />
                  </div>
                  <FieldLabel>お客様のコメント・反応</FieldLabel>
                  <div style={{ position:"relative" }}>
                    {isRec(`tastingComment::${idx}`) && <RecBadge />}
                    <textarea value={t.comment} onChange={e => setTasting(idx, "comment", e.target.value)} placeholder="お客様の感想・反応・評価など..." rows={3} style={{ ...inp, width:"100%", fontFamily:"inherit", lineHeight:1.8 }} />
                  </div>
                  <div style={{ display:"flex",gap:6,marginTop:6 }}>
                    <VoiceBtn active={isRec(`tastingComment::${idx}`)} onClick={() => toggleVoice(`tastingComment::${idx}`)} label="音声入力" />
                    <AIBtn loading={aiLoading === (t.comment || "").slice(0, 20)} onClick={() => polishAI(() => t.comment, val => setTasting(idx, "comment", val))} />
                  </div>
                </div>
              ))}
              <button onClick={addTasting} style={{ width:"100%",padding:"10px",borderRadius:8,border:"1.5px dashed #c8a070",background:"transparent",color:"#8B5A2B",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>
                ＋ 商品を追加
              </button>
            </EditorCard>

            <EditorCard title="💭 所感">
              <div style={{ position:"relative" }}>
                {isRec("impression") && <RecBadge />}
                <textarea value={editing.impression || ""} onChange={e => setField("impression", e.target.value)} placeholder="本日の訪問を通じた気づき・感想・次回への引き継ぎ事項など..." rows={5} style={{ ...inp, width:"100%", fontFamily:"inherit", lineHeight:1.8 }} />
              </div>
              <div style={{ display:"flex",gap:6,marginTop:8 }}>
                <VoiceBtn active={isRec("impression")} onClick={() => toggleVoice("impression")} label="音声入力" />
                <AIBtn loading={aiLoading === (editing.impression || "").slice(0, 20)} onClick={() => polishAI(() => editing.impression, val => setField("impression", val))} />
              </div>
            </EditorCard>

            <div style={{ display:"flex",justifyContent:"flex-end",gap:10 }}>
              <button onClick={() => setView("list")} style={ghost}>キャンセル</button>
              <button onClick={save} disabled={saving} style={{ ...primary, opacity: saving ? .7 : 1 }}>{saving ? "保存中…" : "💾 日報を保存する"}</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:24 }}>
      <div style={{ fontSize:14,fontWeight:700,color:"#8B5A2B",marginBottom:12,paddingBottom:6,borderBottom:"1.5px solid #e8d8c4" }}>{title}</div>
      {children}
    </div>
  );
}
function EditorCard({ title, children }) {
  return (
    <div style={{ background:"#fff",borderRadius:14,border:"1px solid #e8d8c4",padding:"20px 22px",boxShadow:"0 2px 8px rgba(139,90,43,.05)" }}>
      <div style={{ fontSize:14,fontWeight:700,color:"#8B5A2B",marginBottom:16,paddingBottom:10,borderBottom:"1.5px solid #f0e4d4" }}>{title}</div>
      {children}
    </div>
  );
}
function FieldLabel({ children }) {
  return <div style={{ fontSize:12,color:"#a08060",marginBottom:5,fontWeight:500 }}>{children}</div>;
}
function RecBadge() {
  return (
    <div style={{ position:"absolute",top:8,right:10,zIndex:1,background:"#c0392b",color:"#fff",fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:10,animation:"pulse 1.2s infinite",display:"flex",alignItems:"center",gap:4 }}>
      ● REC
    </div>
  );
}
function VoiceBtn({ active, onClick, label = "" }) {
  return (
    <button onClick={onClick} style={{ display:"flex",alignItems:"center",gap:5,padding:label?"7px 12px":"7px 10px",borderRadius:8,border:"none",cursor:"pointer",background:active?"#c0392b":"#3d2b1f",color:"#fff",fontSize:12,fontFamily:"inherit",fontWeight:500,transition:"all .2s" }}>
      <span style={{ fontSize:13 }}>{active ? "⏹" : "🎤"}</span>
      {label && (active ? "停止" : label)}
    </button>
  );
}
function AIBtn({ loading, onClick }) {
  return (
    <button onClick={onClick} disabled={!!loading} style={{ display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:8,border:"none",cursor:loading?"not-allowed":"pointer",background:loading?"#c8b9a0":"#8B5A2B",color:"#fff",fontSize:12,fontFamily:"inherit",fontWeight:500,transition:"all .2s" }}>
      ✨ {loading ? "整形中..." : "AI整形"}
    </button>
  );
}

const inp = { padding:"9px 12px",border:"1.5px solid #e8d8c4",borderRadius:8,fontSize:14,fontFamily:"inherit",color:"#3d2b1f",background:"#fff",width:"100%" };
const primary = { padding:"9px 20px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#8B5A2B,#c8913a)",color:"#fff",fontSize:14,fontFamily:"inherit",fontWeight:600,cursor:"pointer" };
const ghost = { padding:"9px 16px",borderRadius:8,border:"1.5px solid #e8d8c4",background:"transparent",color:"#8B5A2B",fontSize:13,fontFamily:"inherit",cursor:"pointer" };
const danger = { padding:"9px 16px",borderRadius:8,border:"none",background:"#fdf0f0",color:"#c0392b",fontSize:13,fontFamily:"inherit",cursor:"pointer" };
const smBtn = { padding:"5px 12px",borderRadius:6,border:"1px solid #e8d8c4",background:"#fff",color:"#8B5A2B",fontSize:12,fontFamily:"inherit",cursor:"pointer" };
const smDanger = { padding:"5px 12px",borderRadius:6,border:"none",background:"#fdf0f0",color:"#c0392b",fontSize:12,fontFamily:"inherit",cursor:"pointer" };
