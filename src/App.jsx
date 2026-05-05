import { useState, useEffect, useRef, useMemo } from 'react';
import React from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakText } from './TweaksPanel';

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const ALL_MEALS = ["Щоранок", "Підобідок", "Надвечірок"];
const ALL_MEAL_KEYS = ["m1", "m2", "m3"];

const STORE_KEY = "meal-planner-v2";

const toSentenceCase = (str) => {
  const s = str.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const TAG_LIST = [
  { id: "allergen", label: "Алерген", short: "А" },
  { id: "cook",     label: "Треба готувати", short: "Г" },
  { id: "prep",     label: "Заготовка", short: "З" },
];

const emptyCells = () =>
  Object.fromEntries(DAYS.flatMap((d, di) => ALL_MEAL_KEYS.map((m) => [`${di}-${m}`, []])));

const DEFAULT_WEEK = () => ({
  id: "w-" + Date.now(),
  name: "Тиждень " + new Date().toLocaleDateString("uk-UA", { day: "2-digit", month: "short" }),
  cells: emptyCells(),
  qrUrl: "https://example.com",
  mealsCount: 3,
});

function migrateCells(cells) {
  const out = {};
  for (const k of Object.keys(cells || {})) {
    const v = cells[k];
    if (Array.isArray(v)) out[k] = v.map(toSentenceCase).filter(Boolean);
    else if (typeof v === "string")
      out[k] = v.split(/[,\n]/).map((s) => toSentenceCase(s)).filter(Boolean);
    else out[k] = [];
  }
  return out;
}

function migrateBank(bank) {
  if (!Array.isArray(bank)) return [];
  const seen = new Map();
  for (const b of bank) {
    if (typeof b === "string") {
      const name = toSentenceCase(b);
      if (name && !seen.has(name)) seen.set(name, { name, tags: [] });
    } else if (b && typeof b === "object" && b.name) {
      const name = toSentenceCase(b.name);
      if (!name) continue;
      const tags = Array.isArray(b.tags) ? b.tags.filter((t) => TAG_LIST.some((T) => T.id === t)) : [];
      if (seen.has(name)) {
        const existing = seen.get(name);
        seen.set(name, { name, tags: Array.from(new Set([...existing.tags, ...tags])) });
      } else {
        seen.set(name, { name, tags });
      }
    }
  }
  return Array.from(seen.values());
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("meal-planner-v1");
    if (!raw) throw 0;
    const parsed = JSON.parse(raw);
    if (!parsed.weeks || !parsed.weeks.length) throw 0;
    const fallbackQr = parsed.qrUrl || "https://example.com";
    parsed.weeks = parsed.weeks.map((w) => ({
      ...w,
      cells: { ...emptyCells(), ...migrateCells(w.cells) },
      qrUrl: w.qrUrl || fallbackQr,
      mealsCount: Math.min(3, Math.max(1, w.mealsCount || 3)),
    }));
    return {
      weeks: parsed.weeks,
      activeId: parsed.activeId || parsed.weeks[0].id,
      bank: migrateBank(parsed.bank),
      theme: parsed.theme || "craft",
      designMode: parsed.designMode || "classic",
    };
  } catch (e) {
    const w = DEFAULT_WEEK();
    return { weeks: [w], activeId: w.id, bank: [], theme: "craft", designMode: "classic" };
  }
}

function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
}

function tagsFor(name, bank) {
  const it = bank.find((b) => b.name === name);
  return it ? it.tags : [];
}

function MealCell({ items, onChange, onAddToBank, bank, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => bank.map((b) => b.name), [bank]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return suggestions.filter((s) => !items.includes(s)).slice(-8).reverse();
    return suggestions.filter((s) => s.toLowerCase().includes(q) && !items.includes(s)).slice(0, 8);
  }, [draft, suggestions, items]);

  const showCreate = draft.trim().length > 0
    && !suggestions.some((s) => s.toLowerCase() === draft.trim().toLowerCase());

  const addItem = (text) => {
    const t = toSentenceCase(text || "");
    if (!t) return;
    if (!items.includes(t)) onChange([...items, t]);
    onAddToBank(t);
    setDraft(""); setActive(0);
  };
  const removeItem = (i) => onChange(items.filter((_, idx) => idx !== i));
  const startEdit = () => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); };

  const handleKey = (e) => {
    const total = matches.length + (showCreate ? 1 : 0);
    if (e.key === "ArrowDown") { e.preventDefault(); if (total) setActive((a) => (a + 1) % total); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (total) setActive((a) => (a - 1 + total) % total); return; }
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (matches[active]) addItem(matches[active]);
      else if (showCreate && active === matches.length) addItem(draft);
      else addItem(draft);
      return;
    }
    if (e.key === "Backspace" && !draft && items.length) { e.preventDefault(); removeItem(items.length - 1); return; }
    if (e.key === "Escape") { setDraft(""); inputRef.current?.blur(); }
  };

  const plainContent = items.map((it, i) => {
    const tags = tagsFor(it, bank);
    const cls = ["item"];
    if (tags.includes("allergen")) cls.push("t-allergen");
    if (tags.includes("cook")) cls.push("t-cook");
    if (tags.includes("prep")) cls.push("t-prep");
    return (
      <React.Fragment key={i}>
        <span className={cls.join(" ")}>{it}</span>
        {i < items.length - 1 && <span className="sep">, </span>}
      </React.Fragment>
    );
  });

  return (
    <div className={"meal-cell" + (editing ? " editing" : "")} onClick={(e) => {
      if (e.target.closest(".chip-x")) return;
      startEdit();
    }}>
      {!editing && items.length > 0 && <div className="plain">{plainContent}</div>}
      {!editing && items.length === 0 && (
        <div className="plain placeholder">{placeholder || "+ страва"}</div>
      )}
      <div className="chips" style={{display: editing ? 'flex' : 'none'}}>
        {items.map((it, i) => {
          const tags = tagsFor(it, bank);
          const cls = ["chip"];
          if (tags.includes("allergen")) cls.push("t-allergen");
          if (tags.includes("cook")) cls.push("t-cook");
          if (tags.includes("prep")) cls.push("t-prep");
          return (
            <span key={i} className={cls.join(" ")}>
              <span className="chip-text">{it}</span>
              <span className="chip-x" onClick={(e) => { e.stopPropagation(); removeItem(i); }} title="Видалити">×</span>
            </span>
          );
        })}
        {editing && (
          <input
            ref={inputRef}
            className="chip-input"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setActive(0); }}
            onKeyDown={handleKey}
            onBlur={() => {
              setTimeout(() => {
                if (draft.trim()) addItem(draft);
                setEditing(false); setDraft("");
              }, 150);
            }}
            placeholder={items.length ? "+" : "додати…"}
          />
        )}
      </div>
      {editing && (matches.length > 0 || showCreate) && (
        <div className="suggest" onMouseDown={(e) => e.preventDefault()}>
          {matches.map((m, i) => {
            const tags = tagsFor(m, bank);
            const cls = ["sug"]; if (i === active) cls.push("active");
            if (tags.includes("allergen")) cls.push("t-allergen");
            if (tags.includes("cook")) cls.push("t-cook");
            if (tags.includes("prep")) cls.push("t-prep");
            return (
              <div key={m} className={cls.join(" ")} onClick={() => addItem(m)} onMouseEnter={() => setActive(i)}>
                <span className="sug-icon">+</span><span>{m}</span>
              </div>
            );
          })}
          {showCreate && (
            <div className={"sug create" + (active === matches.length ? " active" : "")}
                 onClick={() => addItem(draft)} onMouseEnter={() => setActive(matches.length)}>
              <span className="sug-icon">＋</span><span>Створити «{draft.trim()}»</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QR({ value, size = 88 }) {
  const v = (value && value.trim()) || " ";
  return (
    <div className="qr-holder" style={{ width: size, height: size }}>
      <QRCodeCanvas value={v} size={size} fgColor="#1d1b18" bgColor="#ffffff" level="M" />
    </div>
  );
}

function Menu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="menu-trigger" onClick={() => setOpen((v) => !v)}>{label} ▾</button>
      {open && <div className="menu-popover" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

const SAMPLE_TEXT = `День 1
- Лохина, Ягідні мафіни з лохиною та бананом
- Кускус з буряком, огірок + олія + рукола, ананас, куряча гомілка
- Виноград, булгур болоньєзе

День 2
- Вівсянка з бананом та кеш'ю
- Мандарин, ризото з індичкою та броколі
- Виноград, булгур болоньєзе`;

function ImportTextModal({ onClose, onApply }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("replace");
  const taRef = useRef(null);
  useEffect(() => { setTimeout(() => taRef.current?.focus(), 50); }, []);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target.classList.contains("modal-backdrop")) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Імпорт списку</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Вставте текст у форматі: рядок «<b>День 1</b>», далі по одному рядку на прийом їжі — «<b>- страва1, страва2</b>».
            Кожен рядок з «−» = один прийом по порядку (Щоранок, Підобідок, Надвечірок).
            Кома усередині рядка розділяє страви на чипи.
          </p>
          <textarea
            ref={taRef}
            className="import-text"
            placeholder={SAMPLE_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
          />
          <div className="modal-options">
            <label className={mode === "replace" ? "active" : ""}>
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
              Замінити поточний тиждень
            </label>
            <label className={mode === "merge" ? "active" : ""}>
              <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
              Дописати до існуючих
            </label>
            <button className="link" type="button" onClick={() => setText(SAMPLE_TEXT)}>Вставити приклад</button>
          </div>
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Скасувати</button>
          <button className="primary" onClick={() => onApply(text, mode)} disabled={!text.trim()}>Заповнити тиждень</button>
        </div>
      </div>
    </div>
  );
}

function WeeklySummaryModal({ week, bank, onClose }) {
  const mealsCount = Math.min(3, Math.max(1, week.mealsCount || 3));
  const usedKeys = ALL_MEAL_KEYS.slice(0, mealsCount);

  const ingredientCounts = useMemo(() => {
    const counts = {};
    for (let di = 0; di < 7; di++) {
      for (const mk of usedKeys) {
        for (const item of (week.cells[`${di}-${mk}`] || [])) {
          counts[item] = (counts[item] || 0) + 1;
        }
      }
    }
    return counts;
  }, [week, usedKeys]);

  const allItems = Object.entries(ingredientCounts).sort((a, b) =>
    a[0].localeCompare(b[0], "uk")
  );

  const toCook = allItems.filter(([n]) => tagsFor(n, bank).includes("cook"));
  const toPrep = allItems.filter(([n]) => tagsFor(n, bank).includes("prep"));
  const allergens = allItems.filter(([n]) => tagsFor(n, bank).includes("allergen"));
  const toBuy = allItems.filter(([n]) => {
    const tags = tagsFor(n, bank);
    return !tags.includes("cook") && !tags.includes("prep");
  });

  const renderList = (items) => (
    <ul className="summary-list">
      {items.map(([name, count]) => (
        <li key={name} className="summary-item">
          <span>{name}</span>
          {count > 1 && <span className="summary-count">×{count}</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target.classList.contains("modal-backdrop")) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Підсумок тижня</h3>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="summary-total">
            Унікальних страв: <strong>{allItems.length}</strong>
          </p>
          {allItems.length === 0 && (
            <div className="summary-empty">Цей тиждень порожній</div>
          )}
          {toBuy.length > 0 && (
            <div className="summary-section">
              <div className="summary-section-head">
                <span>Купити</span>
                <span className="summary-count-badge">{toBuy.length}</span>
              </div>
              {renderList(toBuy)}
            </div>
          )}
          {toCook.length > 0 && (
            <div className="summary-section">
              <div className="summary-section-head t-cook">
                <span>Готувати</span>
                <span className="summary-count-badge">{toCook.length}</span>
              </div>
              {renderList(toCook)}
            </div>
          )}
          {toPrep.length > 0 && (
            <div className="summary-section">
              <div className="summary-section-head t-prep">
                <span>Заготовки</span>
                <span className="summary-count-badge">{toPrep.length}</span>
              </div>
              {renderList(toPrep)}
            </div>
          )}
          {allergens.length > 0 && (
            <div className="summary-section">
              <div className="summary-section-head t-allergen">
                <span>Алергени</span>
                <span className="summary-count-badge">{allergens.length}</span>
              </div>
              {renderList(allergens)}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Закрити</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [store, setStore] = useState(loadStore);

  useEffect(() => { saveStore(store); }, [store]);
  useEffect(() => { document.body.dataset.theme = store.theme || "craft"; }, [store.theme]);
  useEffect(() => { document.body.dataset.design = store.designMode || "classic"; }, [store.designMode]);

  const week = store.weeks.find((w) => w.id === store.activeId) || store.weeks[0];
  const mealsCount = Math.min(3, Math.max(1, week.mealsCount || 3));
  const MEALS = ALL_MEALS.slice(0, mealsCount);
  const MEAL_KEYS = ALL_MEAL_KEYS.slice(0, mealsCount);

  const setCell = (key, items) => {
    setStore((s) => ({
      ...s,
      weeks: s.weeks.map((w) => w.id === s.activeId ? { ...w, cells: { ...w.cells, [key]: items } } : w),
    }));
  };
  const addToBank = (name) => {
    if (!name) return;
    const normalized = toSentenceCase(name);
    setStore((s) => {
      const idx = s.bank.findIndex((b) => b.name === normalized);
      if (idx >= 0) {
        const it = s.bank[idx];
        return { ...s, bank: [...s.bank.filter((_, i) => i !== idx), it] };
      }
      const next = [...s.bank, { name: normalized, tags: [] }];
      return { ...s, bank: next.slice(-300) };
    });
  };
  const toggleBankTag = (name, tag) => {
    setStore((s) => ({
      ...s,
      bank: s.bank.map((b) => b.name === name
        ? { ...b, tags: b.tags.includes(tag) ? b.tags.filter((t) => t !== tag) : [...b.tags, tag] }
        : b),
    }));
  };
  const removeFromBank = (name) => {
    setStore((s) => ({ ...s, bank: s.bank.filter((b) => b.name !== name) }));
  };

  const setQrUrl = (v) => setStore((s) => ({
    ...s, weeks: s.weeks.map((w) => w.id === s.activeId ? { ...w, qrUrl: v } : w),
  }));
  const setMealsCount = (n) => setStore((s) => ({
    ...s, weeks: s.weeks.map((w) => w.id === s.activeId ? { ...w, mealsCount: n } : w),
  }));

  const newWeek = () => setStore((s) => {
    const w = DEFAULT_WEEK();
    w.name = "Тиждень " + (s.weeks.length + 1);
    return { ...s, weeks: [...s.weeks, w], activeId: w.id };
  });
  const duplicateWeek = () => setStore((s) => {
    const cur = s.weeks.find((w) => w.id === s.activeId);
    if (!cur) return s;
    const cellsCopy = Object.fromEntries(Object.entries(cur.cells).map(([k, v]) => [k, [...(v || [])]]));
    const copy = { ...cur, id: "w-" + Date.now(), name: cur.name + " · копія", cells: cellsCopy };
    return { ...s, weeks: [...s.weeks, copy], activeId: copy.id };
  });
  const deleteWeek = (id) => setStore((s) => {
    if (s.weeks.length <= 1) {
      const w = DEFAULT_WEEK();
      return { ...s, weeks: [w], activeId: w.id };
    }
    const next = s.weeks.filter((w) => w.id !== id);
    return { ...s, weeks: next, activeId: id === s.activeId ? next[0].id : s.activeId };
  });
  const renameWeek = (id, name) => setStore((s) => ({
    ...s, weeks: s.weeks.map((w) => w.id === id ? { ...w, name } : w),
  }));

  const exportData = (mode) => {
    let payload;
    if (mode === "week") {
      const cur = store.weeks.find((w) => w.id === store.activeId);
      if (!cur) return;
      payload = { kind: "meal-planner-week", version: 2, exportedAt: new Date().toISOString(), week: cur, bank: store.bank };
    } else {
      payload = { kind: "meal-planner-all", version: 2, exportedAt: new Date().toISOString(), weeks: store.weeks, bank: store.bank, theme: store.theme, designMode: store.designMode };
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    const safeName = mode === "week"
      ? (payload.week.name || "тиждень").replace(/[^\p{L}\p{N}_-]+/gu, "-")
      : "all";
    a.href = url; a.download = `meal-planner-${safeName}-${date}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFileRef = useRef(null);
  const triggerImport = () => importFileRef.current?.click();

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incomingBank = migrateBank(data.bank);
      if (data.kind === "meal-planner-week" && data.week) {
        const incoming = {
          ...data.week,
          id: "w-" + Date.now(),
          cells: { ...emptyCells(), ...migrateCells(data.week.cells) },
          mealsCount: Math.min(3, Math.max(1, data.week.mealsCount || 3)),
        };
        setStore((s) => {
          const merged = [...s.bank];
          for (const it of incomingBank) {
            const i = merged.findIndex((b) => b.name === it.name);
            if (i >= 0) merged[i] = { name: it.name, tags: Array.from(new Set([...merged[i].tags, ...it.tags])) };
            else merged.push(it);
          }
          return { ...s, weeks: [...s.weeks, incoming], activeId: incoming.id, bank: merged.slice(-300) };
        });
        alert(`Імпортовано тиждень «${incoming.name}»`);
      } else if (data.kind === "meal-planner-all" && Array.isArray(data.weeks)) {
        if (!confirm("Замінити всі дані поточного планера імпортованими? Поточні тижні буде видалено.")) return;
        const fallbackQr = data.qrUrl || "https://example.com";
        const weeks = data.weeks.map((w) => ({
          ...w,
          cells: { ...emptyCells(), ...migrateCells(w.cells) },
          qrUrl: w.qrUrl || fallbackQr,
          mealsCount: Math.min(3, Math.max(1, w.mealsCount || 3)),
        }));
        setStore({ weeks, activeId: weeks[0]?.id || "w-" + Date.now(), bank: incomingBank, theme: data.theme || "craft", designMode: data.designMode || "classic" });
        alert(`Імпортовано ${weeks.length} тижні(в)`);
      } else {
        alert("Не вдалося розпізнати файл. Очікується JSON експорту планера.");
      }
    } catch (err) {
      alert("Помилка імпорту: " + (err?.message || err));
    }
  };

  const clearWeek = () => {
    if (!confirm("Очистити всі клітинки цього тижня?")) return;
    setStore((s) => ({
      ...s, weeks: s.weeks.map((w) => w.id === s.activeId ? { ...w, cells: emptyCells() } : w),
    }));
  };

  const parseListText = (text) => {
    const lines = text.split(/\r?\n/);
    const dayBlocks = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const dayMatch = line.match(/^(?:день|day)\s*(\d{1,2})/i);
      if (dayMatch) {
        const idx = parseInt(dayMatch[1], 10) - 1;
        if (idx >= 0 && idx < 7) {
          cur = { day: idx, lines: [] };
          dayBlocks.push(cur);
        } else {
          cur = null;
        }
        continue;
      }
      const bulletMatch = line.match(/^[-•*–—]\s*(.+)$/);
      if (bulletMatch && cur) {
        cur.lines.push(bulletMatch[1].trim());
      } else if (cur && line.length > 0) {
        const numMatch = line.match(/^\d+[.)]\s*(.+)$/);
        cur.lines.push(numMatch ? numMatch[1].trim() : line);
      }
    }

    const cellsMap = {};
    const allItems = new Set();
    let maxMeals = 0;
    for (const blk of dayBlocks) {
      maxMeals = Math.max(maxMeals, blk.lines.length);
      for (let i = 0; i < blk.lines.length && i < ALL_MEAL_KEYS.length; i++) {
        const items = blk.lines[i]
          .split(/[,;]/)
          .map((s) => toSentenceCase(s.replace(/^[-•*]\s*/, "")))
          .filter(Boolean);
        cellsMap[`${blk.day}-${ALL_MEAL_KEYS[i]}`] = items;
        for (const it of items) allItems.add(it);
      }
    }
    return {
      cellsMap,
      dayCount: dayBlocks.length,
      mealsCount: Math.min(3, Math.max(1, maxMeals)),
      items: Array.from(allItems),
    };
  };

  const applyListImport = (text, mode) => {
    const parsed = parseListText(text);
    if (parsed.dayCount === 0) {
      alert("Не знайдено жодного дня. Перевірте формат: «День 1», далі рядки з «- стравами».");
      return;
    }
    setStore((s) => {
      const merged = [...s.bank];
      for (const name of parsed.items) {
        if (!merged.some((b) => b.name === name)) merged.push({ name, tags: [] });
      }
      const newBank = merged.slice(-300);

      const updateWeek = (w) => {
        const baseCells = mode === "replace" ? emptyCells() : { ...w.cells };
        for (const k of Object.keys(parsed.cellsMap)) {
          baseCells[k] = parsed.cellsMap[k];
        }
        return {
          ...w,
          cells: baseCells,
          mealsCount: Math.max(w.mealsCount || 3, parsed.mealsCount),
        };
      };

      return {
        ...s,
        bank: newBank,
        weeks: s.weeks.map((w) => w.id === s.activeId ? updateWeek(w) : w),
      };
    });
    setShowImportText(false);
  };

  const [tweaks, setTweak] = useTweaks({});
  const [showHistory, setShowHistory] = useState(false);
  const [showBank, setShowBank] = useState(false);
  const [showImportText, setShowImportText] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const bankReversed = useMemo(() => store.bank.slice().reverse(), [store.bank]);

  return (
    <>
      <div className="toolbar">
        <h1>Планер прикорму</h1>

        <div className="week-picker">
          <input
            className="week-name"
            value={week.name}
            onChange={(e) => renameWeek(week.id, e.target.value)}
            placeholder="Назва тижня"
            title="Назва активного тижня — можна редагувати"
          />
          {store.weeks.length > 1 && (
            <Menu label="↕">
              {store.weeks.map((w) => (
                <button
                  key={w.id}
                  className={w.id === week.id ? "active" : ""}
                  onClick={() => setStore((s) => ({ ...s, activeId: w.id }))}
                >{w.name}</button>
              ))}
            </Menu>
          )}
        </div>

        <Menu label="Тиждень">
          <button onClick={newWeek}>+ Новий тиждень</button>
          <button onClick={duplicateWeek}>Дублювати</button>
          <button onClick={clearWeek}>Очистити клітинки</button>
          <hr/>
          <button onClick={() => setShowHistory((v) => !v)}>{showHistory ? "✕ " : ""}Архів тижнів</button>
        </Menu>

        <Menu label={`Прийоми: ${mealsCount}`}>
          {[1, 2, 3].map((n) => (
            <button key={n} className={n === mealsCount ? "active" : ""} onClick={() => setMealsCount(n)}>
              {n} {n === 1 ? "прийом" : n < 5 ? "прийоми" : "прийомів"} на день
            </button>
          ))}
        </Menu>

        <button onClick={() => setShowBank((v) => !v)}>
          {showBank ? "✕ " : ""}Банк ({store.bank.length})
        </button>

        <button onClick={() => setShowSummary((v) => !v)}>
          {showSummary ? "✕ " : ""}Підсумок тижня
        </button>

        <Menu label={`Дизайн: ${(store.designMode || "classic") === "playful" ? "Грайливий" : "Класичний"}`}>
          <button className={(store.designMode || "classic") === "classic" ? "active" : ""} onClick={() => setStore((s) => ({ ...s, designMode: "classic" }))}>Класичний</button>
          <button className={store.designMode === "playful" ? "active" : ""} onClick={() => setStore((s) => ({ ...s, designMode: "playful" }))}>Грайливий</button>
        </Menu>

        <Menu label="Дані">
          <button onClick={() => setShowImportText(true)}>📋 Імпорт списку</button>
          <hr/>
          <button onClick={() => exportData("week")}>↓ Експорт тижня</button>
          <button onClick={() => exportData("all")}>↓ Експорт усього</button>
          <button onClick={triggerImport}>↑ Імпорт JSON</button>
        </Menu>
        <input
          ref={importFileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
          style={{ display: "none" }}
        />

        <div className="spacer" />

        <input
          className="qr-input"
          type="text"
          value={week.qrUrl || ""}
          onChange={(e) => setQrUrl(e.target.value)}
          placeholder="QR посилання…"
          title="QR-посилання для цього тижня"
        />
        <button className="primary" onClick={() => window.print()}>Друк / PDF</button>
      </div>

      {showHistory && (
        <div className="history-panel">
          <h3>Архів тижнів</h3>
          {store.weeks.map((w) => {
            const isActive = w.id === store.activeId;
            const selectWeek = () => setStore((s) => ({ ...s, activeId: w.id }));
            return (
              <div key={w.id} className={"week-row" + (isActive ? " active" : "")} onClick={selectWeek}>
                <button
                  type="button"
                  className="select-week"
                  aria-label={`Обрати тиждень ${w.name}`}
                  title="Обрати тиждень"
                  onClick={(e) => { e.stopPropagation(); selectWeek(); }}
                >
                  {isActive ? "✓" : "→"}
                </button>
                <div className="name">
                  <input
                    value={w.name}
                    onChange={(e) => renameWeek(w.id, e.target.value)}
                    onFocus={selectWeek}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <button type="button" className="delete-week" title="Видалити" onClick={(e) => { e.stopPropagation(); deleteWeek(w.id); }}>×</button>
              </div>
            );
          })}
          <button className="new-btn" onClick={newWeek}>+ Новий тиждень</button>
        </div>
      )}

      {showBank && (
        <div className="bank-panel">
          <h3>Банк страв</h3>
          <p className="help">
            Клікніть на бейдж біля страви, щоб увімкнути/вимкнути примітку.
            <span className="legend-row"><span className="leg-sw t-allergen">А</span> алерген — червоним</span>
            <span className="legend-row"><span className="leg-sw t-cook">Г</span> треба готувати — зеленим</span>
            <span className="legend-row"><span className="leg-sw t-prep">З</span> заготовка — синім</span>
          </p>
          {store.bank.length === 0 && <div className="empty">Поки що порожньо</div>}
          <div className="bank-list">
            {bankReversed.map((it) => {
              const cls = ["chip", "bank"];
              if (it.tags.includes("allergen")) cls.push("t-allergen");
              if (it.tags.includes("cook")) cls.push("t-cook");
              if (it.tags.includes("prep")) cls.push("t-prep");
              return (
                <div key={it.name} className="bank-row">
                  <span className={cls.join(" ")}>
                    <span className="chip-text">{it.name}</span>
                  </span>
                  <div className="bank-tags">
                    {TAG_LIST.map((T) => (
                      <button
                        key={T.id}
                        className={"tag-btn t-" + T.id + (it.tags.includes(T.id) ? " on" : "")}
                        onClick={() => toggleBankTag(it.name, T.id)}
                        title={T.label}
                      >{T.short}</button>
                    ))}
                    <button className="bank-x" onClick={() => removeFromBank(it.name)} title="Видалити зі списку">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="sheet-wrap">
        <div className="playful-floatie carrot" aria-hidden="true">🥕</div>
        <div className="playful-floatie bunny" aria-hidden="true">🐰</div>
        <div className="sheet-scaler" ref={(el) => {
          if (!el) return;
          const fit = () => {
            const wrap = el.parentElement;
            if (!wrap) return;
            const wrapW = wrap.clientWidth - 48;
            const wrapH = window.innerHeight - el.getBoundingClientRect().top - 24;
            const sheet = el.firstElementChild;
            if (!sheet) return;
            const sw = sheet.offsetWidth;
            const sh = sheet.offsetHeight;
            const scale = Math.min(wrapW / sw, wrapH / sh);
            el.style.transform = `scale(${scale})`;
            el.style.width = sw + "px";
            el.style.height = (sh * scale) + "px";
          };
          fit();
          if (!el._fitBound) { window.addEventListener("resize", fit); el._fitBound = true; }
        }}>
        <div className="sheet" data-meals={mealsCount}>
          <div className="bg-art" aria-hidden="true" />

          <div className="head">
            <div className="title">Планер <em>прикорму</em></div>
            <div className="meta">
              <div className="week">{week.name}</div>
              <div>{mealsCount} {mealsCount === 1 ? "прийом" : "прийоми"} · 7 днів</div>
            </div>
          </div>

          <div className="mascot-strip">
            <div className="mini-card"><b>🐻</b><div>Новий смак<span>гарбуз + яблучко</span></div></div>
            <div className="mini-card"><b>🥄</b><div>М'яка текстура<span>пюре, кашки, супчики</span></div></div>
            <div className="mini-card"><b>🌟</b><div>Малюк пробує<span>без поспіху й тиску</span></div></div>
            <div className="mini-card"><b>🍓</b><div>Алергени видно<span>червоні пухкі бейджі</span></div></div>
          </div>

          <div className="grid" style={{
            gridTemplateColumns: `22mm repeat(${mealsCount}, 1fr)`,
          }}>
            <div className="cell col-h day-h"></div>
            {MEALS.map((m) => (<div key={m} className="cell col-h">{m}</div>))}

            {DAYS.map((d, di) => (
              <React.Fragment key={d}>
                <div className={`cell day row-${di + 1} ${di === 6 ? "row-last" : ""}`}>{d}</div>
                {MEAL_KEYS.map((mk) => {
                  const key = `${di}-${mk}`;
                  return (
                    <div key={mk} className={`cell row-${di + 1} ${di === 6 ? "row-last" : ""}`}>
                      <MealCell
                        items={week.cells[key] || []}
                        onChange={(arr) => setCell(key, arr)}
                        onAddToBank={addToBank}
                        bank={store.bank}
                        placeholder="+ страва"
                      />
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          <div className="foot">
            <div className="legend">
              <strong>Як користуватись.</strong> Клікніть на клітинку — оберіть зі збережених або введіть нові.
              У «Банку страв» ви можете позначити продукт як <span className="t-allergen">алерген</span> (червоним), як <span className="t-cook">той, що треба готувати</span> (зеленим), або як <span className="t-prep">заготовку</span> (синім).
            </div>
            <div className="qr">
              <span className="qr-label">QR 🐥</span>
              <QR value={week.qrUrl} size={88} />
            </div>
          </div>
        </div>
        </div>
      </div>

      {showImportText && (
        <ImportTextModal
          onClose={() => setShowImportText(false)}
          onApply={applyListImport}
        />
      )}

      {showSummary && (
        <WeeklySummaryModal
          week={week}
          bank={store.bank}
          onClose={() => setShowSummary(false)}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Тема">
          <TweakRadio
            label="Дизайн"
            value={store.designMode || "classic"}
            options={[
              { value: "classic", label: "Класичний" },
              { value: "playful", label: "Грайливий" },
            ]}
            onChange={(v) => { setStore((s) => ({ ...s, designMode: v })); setTweak("designMode", v); }}
          />
          <TweakRadio
            label="Стиль"
            value={store.theme}
            options={[
              { value: "craft", label: "Крафт" },
              { value: "minimal", label: "Мінімал" },
              { value: "pastel", label: "Пастель" },
              { value: "weekday", label: "Кольори" },
            ]}
            onChange={(v) => { setStore((s) => ({ ...s, theme: v })); setTweak("theme", v); }}
          />
        </TweakSection>
        <TweakSection label="Прийоми їжі">
          <TweakRadio
            label="Кількість"
            value={String(mealsCount)}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
            onChange={(v) => setMealsCount(parseInt(v, 10))}
          />
        </TweakSection>
        <TweakSection label="QR-код">
          <TweakText label="URL" value={week.qrUrl || ""} onChange={setQrUrl} placeholder="https://..." />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}
