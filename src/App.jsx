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
        <div style={{ position:"fixed",top:20,right:20,zIndex:999,padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:500,background:notif.type==="err"?"#c0392b":"#2d6a4f",color:"#fff",boxShadow:"0 4px 16px rgba(0,0,0,.2)",maxWidth:320 }}>{notif.msg}</div>}
