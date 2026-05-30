import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp
} from "firebase/firestore";

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

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}
function getTodayStr() { return new Date().toISOString().split("T")[0]; }
function newCustomer() { return { id: crypto.randomUUID(), name: "", requests: "" }; }
function newTasting() { return { id: crypto.randomUUID(), product: "", comment: "" }; }
function newReport() {
  return { date: getTodayStr(), title: "", customers: [newCustomer()], tastings: [newTasting()], impression: "" };
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

  useEffect(() => {
    const q = query(collection(db, "reports"), orderBy("date", "desc"));
    const unsub = onSnapshot(q,
      (snap) => { setReports(snap.docs.map(d => ({ _docId: d.id, ...d.data() }))); setLoading(false); setDbError(false); },
      () => { setLoading(false); setDbError(true); }
    );
    return () => unsub();
  }, []);

  const notify = useCallback((msg, type = "ok") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  }, []);

  const applyTranscript = useCallback((target, text) => {
    setEditing(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      const [field, idx] = target.split("::");
      if (field === "impression") next.impression = (next.impression || "") + text;
      else if (field === "customerName") next.customers = next.customers.map((c, i) => String(i) === idx ? { ...c, name: (c.name || "") + text } : c);
      else if (field === "customerReq") next.customers = next.customers.map((c, i) => String(i) === idx ? { ...c, requests: (c.requests || "") + text } : c);
      else if (field === "tastingProduct") next.tastings = next.tastings.map((t, i) => String(i) === idx ? { ...t, product: (t.product || "") + text } : t);
      else if (field === "tastingComment") next.tastings = next.tastings.map((t, i) => String(i) === idx ? { ...t, comment: (t.comment || "") + text } : t);
      return next;
    });
  }, []);

  const createRecognition = useCallback((target) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "ja-JP"; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let final = "";
      for (let i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript; }
      if (final) applyTranscript(target, final);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") { if (isRecordingRef.current) { try { const r2 = createRecognition(target); r2?.start(); recognitionRef.current = r2; } catch {} } return; }
      if (e.error === "aborted") return;
      const msgs = { "not-allowed": "マイクの使用が許可されていません。", "audio-capture": "マイクが見つかりません。", "network": "ネットワークエラーが発生しました。" };
      notify(msgs[e.error] || `音声認識エラー：${e.error}`, "err");
      isRecordingRef.current = false; setIsRecording(false); setRecordingTarget(null);
    };
    rec.onend = () => { if (isRecordingRef.current) { try { const r2 = createRecognition(target); r2?.start(); recognitionRef.current = r2; } catch {} } };
    return rec;
  }, [applyTranscript, notify]);

  const startRecording = useCallback((target) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { notify("ChromeまたはEdgeをお使いください。", "err"); return; }
    isRecordingRef.current = true; recordingTargetRef.current = target;
    const rec = createRecognition(target);
    if (!rec) return;
    try { rec.start(); recognitionRef.current = rec; setIsRecording(true); setRecordingTarget(target); }
    catch { notify("音声入力を開始できませんでした。", "err"); isRecordingRef.current = false; }
  }, [createRecognition, notify]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false; recordingTargetRef.current = null;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null; setIsRecording(false); setRecordingTarget(null);
  }, []);

  const toggleVoice = useCallback((target) => {
    if (isRecordingRef.current && recordingTargetRef.current === target) stopRecording();
    else { if (isRecordingRef.current) stopRecording(); setTimeout(() => startRecording(target), 100); }
  }, [startRecording, stopRecording]);

  const polishAI = async (getText, setText) => {
    const text = getText();
    if (!text?.trim()) { notify("テキストを入力してください", "err"); return; }
    setAiLoading(text.slice(0, 20));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: 以下の営業日報テキストを、ビジネス向けに自然で簡潔な日本語に整形してください。内容・意味は変えず、誤字脱字の修正と文章整形のみ行ってください。整形後のテキストのみ返してください。\n\n${text} }] })
      });
      const data = await res.json();
      setText(data.content?.[0]?.text || text); notify("AI整形しました ✨");
    } catch { notify("AI整形に失敗しました", "err"); }
    setAiLoading(null);
  };

  const openNew = () => { setEditing(newReport()); setEditingDocId(null); setView("editor"); };
  const openEdit = (r) => { const { _docId, createdAt, updatedAt, ...rest } = r; setEditing(JSON.parse(JSON.stringify(rest))); setEditingDocId(_docId); setView("editor"); };
  const openDetail = (r) => { setDetailReport(r); setView("detail"); };

  const save = async () => {
    if (!editing.date) { notify("日付を入力してください", "err"); return; }
    setSaving(true);
    try {
      const payload = { ...editing, updatedAt: serverTimestamp() };
      if (editingDocId) await updateDoc(doc(db, "reports", editingDocId), payload);
      else await addDoc(collection(db, "reports"), { ...payload, createdAt: serverTimestamp() });
      notify("保存しました ✅"); setView("list");
    } catch (e) { notify("保存に失敗しました：" + e.message, "err"); }
    setSaving(false);
  };

  const del = async (docId) => {
    if (!confirm("この日報を削除しますか？")) return;
    try { await deleteDoc(doc(db, "reports", docId)); notify("削除しました"); setView("list"); }
    catch (e) { notify("削除に失敗しました：" + e.message, "err"); }
  };

  const filtered = reports.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return [r.date, r.title, ...(r.customers||[]).flatMap(c=>[c.name,c.requests]), ...(r.tastings||[]).flatMap(t=>[t.product,t.comment]), r.impression].some(t => t?.toLowerCase().includes(q));
  });

  const setField = (key, val) => setEditing(p => ({ ...p, [key]: val }));
  const setCustomer = (idx, key, val) => setEditing(p => ({ ...p, customers: p.customers.map((c, i) => i === idx ? { ...c, [key]: val } : c) }));
  const setTasting = (idx, key, val) => setEditing(p => ({ ...p, tastings: p.tastings.map((t, i) => i === idx ? { ...t, [key]: val } : t) }));
  const addCustomer = () => setEditing(p => ({ ...p, customers: [...p.customers, newCustomer()] }));
  const removeCustomer = (idx) => setEditing(p => ({ ...p, customers: p.customers.filter((_, i) => i !== idx) }));
  const addTasting = () => setEditing(p => ({ ...p, tastings: [...p.tastings, newTasting()] }));
  const removeTasting = (idx) => setEditing(p => ({ ...p, tastings: p.tastings.filter((_, i) => i !== idx) }));
  const isRec = (t) => isRecording && recordingTarget === t;

  const S = { // styles
    inp: { padding:"9px 12px", border:"1.5px solid #e8d8c4", borderRadius:8, fontSize:14, fontFamily:"inherit", color:"#3d2b1f", background:"#fff", width:"100%" },
    primary: { padding:"9px 20px", borderRadius:8, border:"none", background:"linear-gradient(135deg,#8B5A2B,#c8913a)", color:"#fff", fontSize:14, fontFamily:"inherit", fontWeight:600, cursor:"pointer" },
    ghost: { padding:"9px 16px", borderRadius:8, border:"1.5px solid #e8d8c4", background:"transparent", color:"#8B5A2B", fontSize:13, fontFamily:"inherit", cursor:"pointer" },
    danger: { padding:"9px 16px", borderRadius:8, border:"none", background:"#fdf0f0", color:"#c0392b", fontSize:13, fontFamily:"inherit", cursor:"pointer" },
    smBtn: { padding:"5px 12px", borderRadius:6, border:"1px solid #e8d8c4", background:"#fff", color:"#8B5A2B", fontSize:12, fontFamily:"inherit", cursor:"pointer" },
    smDanger: { padding:"5px 12px", borderRadius:6, border:"none", background:"#fdf0f0", color:"#c0392b", fontSize:12, fontFamily:"inherit", cursor:"pointer" },
    card: { background:"#fdfaf7", border:"1px solid #e8d8c4", borderRadius:12, padding:"16px", marginBot
