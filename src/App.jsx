import React, { useState, useEffect, useCallback } from "react";
import { Plus, X, MapPin, User, ChevronLeft, ChevronRight, Trash2, Users, LogOut, ShieldCheck, Calendar as CalendarIcon, Mail, Phone, Home, Send, Menu as MenuIcon, Clock } from "lucide-react";
import { supabase } from "./supabaseClient";

const COLORS = {
  bgDark: "#1C2126",
  bgDarkAlt: "#262C33",
  bgDarkHover: "#323A43",
  bgMain: "#ECEEEF",
  card: "#FFFFFF",
  border: "#DCD9D0",
  borderSoft: "#E7E5DF",
  accent: "#BC313F",
  accentDark: "#9A2833",
  brandGreen: "#297C55",
  brandGreenDark: "#216545",
  textDark: "#1C2126",
  textMuted: "#6B7280",
  textLight: "#F5F3EE",
  textLightMuted: "#9AA3AC",
};

const PERSON_PALETTE = [
  "#2B6CB0", "#2F855A", "#B7791F", "#6B46C1",
  "#EA580C", "#0B7285", "#B83280", "#4A5568",
];
function nextAvailableColor(mitarbeiterListe) {
  const used = new Set(mitarbeiterListe.map((m) => m.farbe));
  const free = PERSON_PALETTE.find((c) => !used.has(c));
  if (free) return free;
  // Toutes les couleurs de la palette sont déjà prises : on boucle en fonction du nombre total.
  return PERSON_PALETTE[mitarbeiterListe.length % PERSON_PALETTE.length];
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTH_LABELS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function isSameDay(a, b) {
  return fmt(a) === fmt(b);
}
function isActiveOn(baustelle, date) {
  const ds = fmt(date);
  return baustelle.beginn <= ds && ds <= baustelle.ende;
}
function isZuweisungAktivAm(zuweisung, date) {
  const ds = fmt(date);
  return zuweisung.beginn <= ds && ds <= zuweisung.ende;
}
function rangesOverlap(aBeginn, aEnde, bBeginn, bEnde) {
  return aBeginn <= bEnde && bBeginn <= aEnde;
}
// Compatibilité avec les anciennes données (mitarbeiterIds sans dates propres)
function normalizeBaustelle(b) {
  if (b.zuweisungen) return b;
  const zuweisungen = (b.mitarbeiterIds || []).map((id) => ({ mitarbeiterId: id, beginn: b.beginn, ende: b.ende }));
  return { ...b, zuweisungen };
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function mapMitarbeiterRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    telefon: row.telefon || "",
    adresse: row.adresse || "",
    farbe: row.farbe,
    istAdmin: row.ist_admin,
  };
}
function mapBaustelleRow(row, zuweisungenRows) {
  return {
    id: row.id,
    kunde: row.kunde,
    kontaktName: row.kontakt_name || "",
    kontaktTelefon: row.kontakt_telefon || "",
    beschreibung: row.beschreibung || "",
    strasse: row.strasse || "",
    plz: row.plz || "",
    stadt: row.stadt || "",
    beginn: row.beginn,
    ende: row.ende,
    startzeit: row.startzeit ? row.startzeit.slice(0, 5) : "",
    endzeit: row.endzeit ? row.endzeit.slice(0, 5) : "",
    zuweisungen: (zuweisungenRows || [])
      .filter((z) => z.baustelle_id === row.id)
      .map((z) => ({ mitarbeiterId: z.mitarbeiter_id, beginn: z.beginn, ende: z.ende })),
  };
}
function formatAdresse(b) {
  const zeile2 = [b.plz, b.stadt].filter(Boolean).join(" ");
  return [b.strasse, zeile2].filter(Boolean).join(", ");
}
function formatZeitraum(b) {
  if (b.startzeit && b.endzeit) return `${b.startzeit} – ${b.endzeit}`;
  if (b.startzeit) return `ab ${b.startzeit}`;
  if (b.endzeit) return `bis ${b.endzeit}`;
  return "";
}

const EMPTY_FORM = {
  id: null,
  kunde: "",
  kontaktName: "",
  kontaktTelefon: "",
  beschreibung: "",
  strasse: "",
  plz: "",
  stadt: "",
  beginn: fmt(new Date()),
  ende: fmt(new Date()),
  startzeit: "",
  endzeit: "",
  zuweisungen: [], // [{ mitarbeiterId, beginn, ende }]
};

export default function Baustellenplanung() {
  const [data, setData] = useState({ mitarbeiter: [], baustellen: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const [currentUserId, setCurrentUserId] = useState(undefined); // undefined = pas encore chargé
  const [view, setView] = useState("woche"); // tag | woche | monat
  const [currentDate, setCurrentDate] = useState(new Date());
  const [filterId, setFilterId] = useState(null); // null = ganzes Unternehmen (admin only)

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [profileMitarbeiterId, setProfileMitarbeiterId] = useState(null);
  const [newName, setNewName] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // menu mobile

  // --- Chargement des données depuis Supabase ---
  const loadData = useCallback(async () => {
    try {
      const [{ data: mRows, error: mErr }, { data: bRows, error: bErr }, { data: zRows, error: zErr }] = await Promise.all([
        supabase.from("mitarbeiter").select("*").order("created_at", { ascending: true }),
        supabase.from("baustellen").select("*").order("created_at", { ascending: true }),
        supabase.from("zuweisungen").select("*"),
      ]);
      if (mErr || bErr || zErr) {
        setError(`Fehler beim Laden: ${(mErr || bErr || zErr).message}`);
        return;
      }
      setData({
        mitarbeiter: (mRows || []).map(mapMitarbeiterRow),
        baustellen: (bRows || []).map((row) => mapBaustelleRow(row, zRows)),
      });
      setError(null);
    } catch (e) {
      setError("Verbindung zu Supabase fehlgeschlagen. Bitte .env prüfen.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --- Identité de l'utilisateur courant : stockée localement (par appareil) ---
  useEffect(() => {
    const stored = localStorage.getItem("current-user-id");
    setCurrentUserId(stored || null);
  }, []);

  const chooseUser = (id) => {
    setCurrentUserId(id);
    localStorage.setItem("current-user-id", id);
  };
  const switchUser = () => {
    setCurrentUserId(null);
    setFilterId(null);
    localStorage.removeItem("current-user-id");
  };

  const me = data.mitarbeiter.find((m) => m.id === currentUserId) || null;
  const isAdmin = !!me?.istAdmin;

  // Un employé non-admin est verrouillé sur son propre planning
  useEffect(() => {
    if (loaded && currentUserId && !isAdmin) setFilterId(currentUserId);
  }, [loaded, currentUserId, isAdmin]);

  // --- Mitarbeiter (équipe) ---
  const addMitarbeiter = async () => {
    const name = newName.trim();
    if (!name) return null;
    const color = nextAvailableColor(data.mitarbeiter);
    const { data: inserted, error: err } = await supabase
      .from("mitarbeiter")
      .insert({ name, farbe: color, ist_admin: newIsAdmin })
      .select()
      .single();
    if (err) {
      setError(`Fehler beim Hinzufügen: ${err.message}`);
      return null;
    }
    const person = mapMitarbeiterRow(inserted);
    setData((d) => ({ ...d, mitarbeiter: [...d.mitarbeiter, person] }));
    setNewName("");
    setNewIsAdmin(false);
    return person;
  };
  const removeMitarbeiter = async (id) => {
    const { error: err } = await supabase.from("mitarbeiter").delete().eq("id", id);
    if (err) {
      setError(`Fehler beim Entfernen: ${err.message}`);
      return;
    }
    setData((d) => ({
      mitarbeiter: d.mitarbeiter.filter((m) => m.id !== id),
      baustellen: d.baustellen.map((b) => ({
        ...b,
        zuweisungen: b.zuweisungen.filter((z) => z.mitarbeiterId !== id),
      })),
    }));
    if (filterId === id) setFilterId(isAdmin ? null : filterId);
  };
  const updateMitarbeiterProfil = async (id, fields) => {
    const { error: err } = await supabase
      .from("mitarbeiter")
      .update({ name: fields.name, email: fields.email, telefon: fields.telefon, adresse: fields.adresse })
      .eq("id", id);
    if (err) {
      setError(`Fehler beim Speichern: ${err.message}`);
      return;
    }
    setData((d) => ({ ...d, mitarbeiter: d.mitarbeiter.map((m) => (m.id === id ? { ...m, ...fields } : m)) }));
  };

  // Construit un e-mail (mailto) pré-rempli avec le planning de la semaine en cours pour un employé.
  const buildWochenplanMailto = (person) => {
    const start = startOfWeek(new Date());
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const zeilen = days.map((d) => {
      const einsaetze = data.baustellen
        .filter((b) => (b.zuweisungen || []).some((z) => z.mitarbeiterId === person.id && isZuweisungAktivAm(z, d)))
        .map((b) => `${b.kunde}${formatAdresse(b) ? " – " + formatAdresse(b) : ""}`);
      const label = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
      return `${label}: ${einsaetze.length ? einsaetze.join(", ") : "—"}`;
    });
    const subject = `Wochenplan für ${person.name} (KW ${getWeekNumber(start)})`;
    const body = zeilen.join("\n");
    return `mailto:${encodeURIComponent(person.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // --- Baustellen ---
  const openNewBaustelle = (prefillDate) => {
    const start = prefillDate ? fmt(prefillDate) : fmt(new Date());
    const initialMitarbeiterId = !isAdmin && currentUserId ? currentUserId : filterId || null;
    setForm({
      ...EMPTY_FORM,
      id: null,
      beginn: start,
      ende: start,
      zuweisungen: initialMitarbeiterId ? [{ mitarbeiterId: initialMitarbeiterId, beginn: start, ende: start }] : [],
    });
    setModalOpen(true);
  };
  const openEditBaustelle = (b) => {
    setForm(normalizeBaustelle(b));
    setModalOpen(true);
  };
  const findConflicts = (candidateForm) => {
    const conflicts = [];
    for (const z of candidateForm.zuweisungen) {
      for (const other of data.baustellen) {
        if (other.id === candidateForm.id) continue;
        for (const oz of other.zuweisungen || []) {
          if (oz.mitarbeiterId === z.mitarbeiterId && rangesOverlap(z.beginn, z.ende, oz.beginn, oz.ende)) {
            conflicts.push({ mitarbeiterId: z.mitarbeiterId, kunde: other.kunde, beginn: oz.beginn, ende: oz.ende });
          }
        }
      }
    }
    return conflicts;
  };

  const saveBaustelle = async () => {
    if (!form.kunde.trim() || !form.beginn || !form.ende) return;
    const outOfRange = form.zuweisungen.filter((z) => z.beginn < form.beginn || z.ende > form.ende);
    if (outOfRange.length > 0) {
      const names = outOfRange.map((z) => data.mitarbeiter.find((m) => m.id === z.mitarbeiterId)?.name || "?");
      setError(`Zeitraum außerhalb des Projekts: ${names.join(", ")}. Bitte innerhalb ${form.beginn} – ${form.ende} anpassen.`);
      return;
    }
    const conflicts = findConflicts(form);
    if (conflicts.length > 0) {
      const names = conflicts.map((c) => `${data.mitarbeiter.find((m) => m.id === c.mitarbeiterId)?.name || "?"} (${c.kunde}, ${c.beginn} – ${c.ende})`);
      setError(`Terminüberschneidung: ${names.join(" · ")}. Bitte Zeiträume anpassen.`);
      return;
    }

    const baustelleFields = {
      kunde: form.kunde.trim(),
      kontakt_name: form.kontaktName.trim(),
      kontakt_telefon: form.kontaktTelefon.trim(),
      beschreibung: form.beschreibung.trim(),
      strasse: form.strasse.trim(),
      plz: form.plz.trim(),
      stadt: form.stadt.trim(),
      beginn: form.beginn,
      ende: form.ende,
      startzeit: form.startzeit || null,
      endzeit: form.endzeit || null,
    };

    let baustelleId = form.id;
    if (baustelleId) {
      const { error: err } = await supabase.from("baustellen").update(baustelleFields).eq("id", baustelleId);
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return; }
      // Reconciliation simple : on remplace toutes les affectations existantes par celles du formulaire.
      const { error: delErr } = await supabase.from("zuweisungen").delete().eq("baustelle_id", baustelleId);
      if (delErr) { setError(`Fehler beim Speichern: ${delErr.message}`); return; }
    } else {
      const { data: inserted, error: err } = await supabase.from("baustellen").insert(baustelleFields).select().single();
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return; }
      baustelleId = inserted.id;
    }

    if (form.zuweisungen.length > 0) {
      const rows = form.zuweisungen.map((z) => ({
        baustelle_id: baustelleId,
        mitarbeiter_id: z.mitarbeiterId,
        beginn: z.beginn,
        ende: z.ende,
      }));
      const { error: zErr } = await supabase.from("zuweisungen").insert(rows);
      if (zErr) { setError(`Fehler beim Speichern der Zuweisungen: ${zErr.message}`); return; }
    }

    const savedBaustelle = {
      id: baustelleId,
      kunde: baustelleFields.kunde,
      kontaktName: baustelleFields.kontakt_name,
      kontaktTelefon: baustelleFields.kontakt_telefon,
      beschreibung: baustelleFields.beschreibung,
      strasse: baustelleFields.strasse,
      plz: baustelleFields.plz,
      stadt: baustelleFields.stadt,
      beginn: baustelleFields.beginn,
      ende: baustelleFields.ende,
      startzeit: form.startzeit || "",
      endzeit: form.endzeit || "",
      zuweisungen: form.zuweisungen,
    };
    setData((d) => ({
      ...d,
      baustellen: form.id
        ? d.baustellen.map((b) => (b.id === baustelleId ? savedBaustelle : b))
        : [...d.baustellen, savedBaustelle],
    }));
    setError(null);
    setModalOpen(false);
  };
  const deleteBaustelle = async () => {
    const { error: err } = await supabase.from("baustellen").delete().eq("id", form.id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, baustellen: d.baustellen.filter((b) => b.id !== form.id) }));
    setModalOpen(false);
  };
  const toggleFormMitarbeiter = (id) => {
    setForm((f) => {
      const exists = f.zuweisungen.some((z) => z.mitarbeiterId === id);
      return {
        ...f,
        zuweisungen: exists
          ? f.zuweisungen.filter((z) => z.mitarbeiterId !== id)
          : [...f.zuweisungen, { mitarbeiterId: id, beginn: f.beginn, ende: f.ende }],
      };
    });
  };
  const updateFormZuweisung = (id, field, value) => {
    setForm((f) => ({
      ...f,
      zuweisungen: f.zuweisungen.map((z) => {
        if (z.mitarbeiterId !== id) return z;
        let updated = { ...z, [field]: value };
        // Reste toujours dans la période du projet
        if (updated.beginn < f.beginn) updated.beginn = f.beginn;
        if (updated.ende > f.ende) updated.ende = f.ende;
        if (updated.beginn > updated.ende) updated[field === "beginn" ? "ende" : "beginn"] = updated[field];
        return updated;
      }),
    }));
  };

  // --- Derived (avec restriction de droits) ---
  const visibleMitarbeiterList = isAdmin
    ? data.mitarbeiter
    : data.mitarbeiter.filter((m) => m.id === currentUserId);

  const displayedColleagues = filterId
    ? data.mitarbeiter.filter((m) => m.id === filterId)
    : visibleMitarbeiterList;

  const baustellenFor = (date) =>
    data.baustellen.filter((b) => {
      if (!isAdmin) {
        const meine = (b.zuweisungen || []).find((z) => z.mitarbeiterId === currentUserId);
        return meine && isZuweisungAktivAm(meine, date);
      }
      if (filterId) {
        const z = (b.zuweisungen || []).find((zz) => zz.mitarbeiterId === filterId);
        return z && isZuweisungAktivAm(z, date);
      }
      return isActiveOn(b, date);
    });


  // --- Navigation ---
  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => {
    if (view === "tag") setCurrentDate((d) => addDays(d, -1));
    else if (view === "woche") setCurrentDate((d) => addDays(d, -7));
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (view === "tag") setCurrentDate((d) => addDays(d, 1));
    else if (view === "woche") setCurrentDate((d) => addDays(d, 7));
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate), i));
  const monthGrid = (() => {
    const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  })();

  const headerLabel = () => {
    if (view === "tag")
      return currentDate.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (view === "woche") {
      const start = weekDates[0], end = weekDates[6];
      const sameMonth = start.getMonth() === end.getMonth();
      return `${start.getDate()}. ${sameMonth ? "" : MONTH_LABELS[start.getMonth()] + " "}– ${end.getDate()}. ${MONTH_LABELS[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${MONTH_LABELS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  };

  if (!loaded || currentUserId === undefined) {
    return (
      <div style={{ background: COLORS.bgMain, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ color: COLORS.textMuted }}>Planung wird geladen …</div>
      </div>
    );
  }

  if (!currentUserId || !me) {
    return (
      <IdentityGate
        mitarbeiter={data.mitarbeiter}
        onChoose={chooseUser}
        newName={newName}
        setNewName={setNewName}
        newIsAdmin={newIsAdmin}
        setNewIsAdmin={setNewIsAdmin}
        onAdd={async () => {
          const person = await addMitarbeiter();
          if (person) chooseUser(person.id);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bgMain, fontFamily: "system-ui, -apple-system, sans-serif", color: COLORS.textDark }}>
      <style>{`
        .app-sidebar { width: 220px; flex-shrink: 0; }
        .hamburger-btn { display: none; }
        .sidebar-backdrop { display: none; }
        .app-topbar { padding-top: calc(14px + env(safe-area-inset-top)); }
        .app-sidebar { padding-top: env(safe-area-inset-top); }
        @media (max-width: 768px) {
          .app-sidebar {
            position: fixed; top: 0; left: 0; bottom: 0; width: 260px; z-index: 100;
            transform: translateX(-100%); transition: transform 0.25s ease;
          }
          .app-sidebar.open { transform: translateX(0); }
          .hamburger-btn { display: flex !important; }
          .sidebar-backdrop.open {
            display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 90;
          }
        }
      `}</style>

      <div className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />

      {/* SIDEBAR */}
      <div className={`app-sidebar${sidebarOpen ? " open" : ""}`} style={{ background: COLORS.bgDark, color: COLORS.textLight, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 14 }}>
          <img src="/logo.png" alt="Elektro Schmidtke" style={{ width: "100%", maxWidth: 200, display: "block" }} />
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.textLightMuted, fontWeight: 700, textTransform: "uppercase", marginTop: 10, paddingLeft: 4 }}>Baustellenplanung</div>
        </div>

        <div style={{ padding: "4px 10px", flex: 1, overflowY: "auto" }}>
          {isAdmin && (
            <button
              onClick={() => { setFilterId(null); setSidebarOpen(false); }}
              style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                padding: "9px 10px", borderRadius: 8, marginBottom: 2, border: "none", cursor: "pointer",
                background: filterId === null ? COLORS.bgDarkHover : "transparent",
                color: filterId === null ? COLORS.textLight : COLORS.textLightMuted,
                fontSize: 13.5, fontWeight: filterId === null ? 700 : 500,
              }}
            >
              <Users size={15} /> Ganzes Unternehmen
            </button>
          )}

          <div style={{ fontSize: 10.5, letterSpacing: "0.1em", color: COLORS.textLightMuted, textTransform: "uppercase", padding: "14px 10px 6px" }}>
            {isAdmin ? "Team" : "Mein Bereich"}
          </div>
          {visibleMitarbeiterList.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", gap: 2, borderRadius: 8, marginBottom: 2,
                background: filterId === m.id ? COLORS.bgDarkHover : "transparent",
              }}
            >
              <button
                onClick={() => { setProfileMitarbeiterId(m.id); setSidebarOpen(false); }}
                title="Profil öffnen"
                style={{
                  flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, minWidth: 0,
                  padding: "9px 6px 9px 10px", border: "none", background: "transparent", cursor: "pointer",
                  color: filterId === m.id ? COLORS.textLight : COLORS.textLightMuted,
                  fontSize: 13.5, fontWeight: filterId === m.id ? 700 : 500,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                {m.istAdmin && <ShieldCheck size={12} style={{ marginLeft: "auto", opacity: 0.6, flexShrink: 0 }} />}
              </button>
              {isAdmin && (
                <button
                  onClick={() => { setFilterId(m.id); setSidebarOpen(false); }}
                  title="Planung dieses Mitarbeiters anzeigen"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0, marginRight: 4,
                    border: filterId === m.id ? `1.5px solid ${COLORS.accent}` : `1.5px solid transparent`,
                    background: filterId === m.id ? COLORS.accent : COLORS.bgDarkHover,
                    color: filterId === m.id ? "#fff" : COLORS.textLightMuted,
                    cursor: "pointer", transition: "background 0.15s, border 0.15s",
                  }}
                  onMouseEnter={(e) => { if (filterId !== m.id) e.currentTarget.style.background = "#3B434D"; }}
                  onMouseLeave={(e) => { if (filterId !== m.id) e.currentTarget.style.background = COLORS.bgDarkHover; }}
                >
                  <CalendarIcon size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${COLORS.bgDarkAlt}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: COLORS.textLightMuted, padding: "0 2px" }}>
            Angemeldet als <strong style={{ color: COLORS.textLight }}>{me.name}</strong>{isAdmin ? " (Admin)" : ""}
          </div>
          {isAdmin && (
            <button
              onClick={() => setTeamModalOpen(true)}
              style={{
                width: "100%", padding: "9px 10px", borderRadius: 8, border: `1px solid ${COLORS.bgDarkHover}`,
                background: "transparent", color: COLORS.textLightMuted, fontSize: 12.5, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 7, justifyContent: "center",
              }}
            >
              <User size={13} /> Team verwalten
            </button>
          )}
          <button
            onClick={switchUser}
            style={{
              width: "100%", padding: "9px 10px", borderRadius: 8, border: `1px solid ${COLORS.bgDarkHover}`,
              background: "transparent", color: COLORS.textLightMuted, fontSize: 12.5, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 7, justifyContent: "center",
            }}
          >
            <LogOut size={13} /> Benutzer wechseln
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="app-topbar" style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            style={{
              alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 10,
              border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: "pointer", color: COLORS.textDark,
              flexShrink: 0, WebkitTapHighlightColor: "transparent",
            }}
          >
            <MenuIcon size={20} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={goPrev} style={navBtnStyle}><ChevronLeft size={17} /></button>
            <button onClick={goToday} style={{ ...navBtnStyle, width: "auto", padding: "0 12px", fontSize: 12.5, fontWeight: 700 }}>Heute</button>
            <button onClick={goNext} style={navBtnStyle}><ChevronRight size={17} /></button>
          </div>

          <div style={{ fontSize: 16.5, fontWeight: 700, textTransform: "capitalize", flex: 1, minWidth: 160 }}>
            {headerLabel()}
          </div>

          <div style={{ display: "flex", background: COLORS.bgMain, borderRadius: 8, padding: 3, gap: 2 }}>
            {[["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 13px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 700,
                  background: view === v ? COLORS.card : "transparent",
                  color: view === v ? COLORS.textDark : COLORS.textMuted,
                  boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => openNewBaustelle(currentDate)}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: COLORS.accent, color: "#fff",
              border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Plus size={16} /> Neue Baustelle
          </button>
        </div>

        {error && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12.5, padding: "8px 22px" }}>{error}</div>}
        {!isAdmin && (
          <div style={{ background: "#EFF4FB", color: "#2B4C7E", fontSize: 12, padding: "7px 22px" }}>
            Du siehst nur deine eigene Planung. Für die gesamte Unternehmensübersicht wende dich an einen Admin.
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {view === "monat" && (
            <MonthView
              grid={monthGrid}
              currentDate={currentDate}
              baustellenFor={baustellenFor}
              alleMitarbeiter={data.mitarbeiter}
              onDayClick={openNewBaustelle}
              onBaustelleClick={openEditBaustelle}
            />
          )}
          {(view === "woche" || view === "tag") && (
            <ResourceView
              dates={view === "tag" ? [currentDate] : weekDates}
              mitarbeiter={displayedColleagues.length ? displayedColleagues : visibleMitarbeiterList}
              baustellen={data.baustellen}
              alleMitarbeiter={data.mitarbeiter}
              isAdmin={isAdmin && !filterId}
              onCellClick={openNewBaustelle}
              onBaustelleClick={openEditBaustelle}
            />
          )}
        </div>
      </div>

      {modalOpen && (
        <BaustelleModal
          form={form}
          setForm={setForm}
          mitarbeiterListe={isAdmin ? data.mitarbeiter : data.mitarbeiter.filter((m) => m.id === currentUserId)}
          alleMitarbeiter={data.mitarbeiter}
          onToggleMitarbeiter={toggleFormMitarbeiter}
          onUpdateZuweisung={updateFormZuweisung}
          conflicts={findConflicts(form)}
          onSave={saveBaustelle}
          onDelete={form.id ? deleteBaustelle : null}
          onClose={() => setModalOpen(false)}
        />
      )}

      {teamModalOpen && isAdmin && (
        <TeamModal
          mitarbeiter={data.mitarbeiter}
          newName={newName}
          setNewName={setNewName}
          newIsAdmin={newIsAdmin}
          setNewIsAdmin={setNewIsAdmin}
          onAdd={addMitarbeiter}
          onRemove={removeMitarbeiter}
          onClose={() => setTeamModalOpen(false)}
        />
      )}

      {profileMitarbeiterId && (
        <ProfileModal
          person={data.mitarbeiter.find((m) => m.id === profileMitarbeiterId)}
          canEdit={isAdmin || profileMitarbeiterId === currentUserId}
          onSave={(fields) => updateMitarbeiterProfil(profileMitarbeiterId, fields)}
          onSendWochenplan={() => window.open(buildWochenplanMailto(data.mitarbeiter.find((m) => m.id === profileMitarbeiterId)), "_blank")}
          onClose={() => setProfileMitarbeiterId(null)}
        />
      )}
    </div>
  );
}

function IdentityGate({ mitarbeiter, onChoose, newName, setNewName, newIsAdmin, setNewIsAdmin, onAdd }) {
  return (
    <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 380 }}>
        <img src="/logo.png" alt="Elektro Schmidtke" style={{ width: "100%", maxWidth: 220, display: "block", margin: "0 auto 18px" }} />
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.textMuted, fontWeight: 700, textTransform: "uppercase" }}>Baustellenplanung</div>
        <div style={{ fontSize: 19, fontWeight: 800, margin: "2px 0 16px" }}>Wer bist du?</div>

        {mitarbeiter.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {mitarbeiter.map((m) => (
              <button
                key={m.id}
                onClick={() => onChoose(m.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 9,
                  border: `1px solid ${COLORS.border}`, background: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: m.farbe }} />
                {m.name}
                {m.istAdmin && <span style={{ marginLeft: "auto", fontSize: 10.5, color: COLORS.textMuted, textTransform: "uppercase" }}>Admin</span>}
              </button>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 6 }}>
          {mitarbeiter.length > 0 ? "Neu hier?" : "Erste Einrichtung"}
        </div>
        <input
          style={{ ...inputStyle, marginBottom: 8 }}
          placeholder="Dein Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.textMuted, marginBottom: 12 }}>
          <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
          Admin (sieht die gesamte Unternehmensplanung)
        </label>
        <button onClick={onAdd} style={{ ...btnPrimary, width: "100%" }}>Weiter</button>
      </div>
    </div>
  );
}

const navBtnStyle = {
  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: "pointer", color: COLORS.textDark,
};

function MonthView({ grid, currentDate, baustellenFor, alleMitarbeiter, onDayClick, onBaustelleClick }) {
  const currentMonth = currentDate.getMonth();
  const today = new Date();
  return (
    <div style={{ background: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${COLORS.border}` }}>
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ padding: "9px 0", textAlign: "center", fontSize: 11, fontWeight: 700, color: COLORS.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {grid.map((date, i) => {
          const items = baustellenFor(date);
          const dimmed = date.getMonth() !== currentMonth;
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              onClick={() => onDayClick(date)}
              style={{
                minHeight: 96, borderRight: (i + 1) % 7 !== 0 ? `1px solid ${COLORS.borderSoft}` : "none",
                borderBottom: `1px solid ${COLORS.borderSoft}`, padding: 6, cursor: "pointer",
                background: dimmed ? "#FAFAF9" : COLORS.card,
              }}
            >
              <div style={{
                fontSize: 12, fontWeight: isToday ? 800 : 600, color: dimmed ? COLORS.textMuted : COLORS.textDark,
                width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "50%", background: isToday ? COLORS.accent : "transparent",
                ...(isToday ? { color: "#fff" } : {}),
              }}>
                {date.getDate()}
              </div>
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                {items.slice(0, 3).map((b) => {
                  const aktiveMitarbeiter = (b.zuweisungen || [])
                    .filter((z) => isZuweisungAktivAm(z, date))
                    .map((z) => alleMitarbeiter.find((m) => m.id === z.mitarbeiterId))
                    .filter(Boolean);
                  return (
                    <div
                      key={b.id}
                      onClick={(e) => { e.stopPropagation(); onBaustelleClick(b); }}
                      style={{
                        fontSize: 10.5, padding: "2px 5px", borderRadius: 4, color: COLORS.textDark, fontWeight: 600,
                        display: "flex", alignItems: "center", gap: 4, overflow: "hidden",
                        background: "#F0EFEA",
                      }}
                      title={aktiveMitarbeiter.length ? `${b.kunde} — ${aktiveMitarbeiter.map((m) => m.name).join(", ")}` : b.kunde}
                    >
                      <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                        {aktiveMitarbeiter.length > 0 ? (
                          aktiveMitarbeiter.slice(0, 4).map((m) => (
                            <span key={m.id} style={{ width: 6, height: 6, borderRadius: "50%", background: m.farbe, flexShrink: 0 }} />
                          ))
                        ) : (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.textMuted, flexShrink: 0 }} />
                        )}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.kunde}</span>
                    </div>
                  );
                })}
                {items.length > 3 && (
                  <div style={{ fontSize: 10, color: COLORS.textMuted, fontWeight: 600, paddingLeft: 5 }}>
                    +{items.length - 3} weitere
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResourceView({ dates, mitarbeiter, baustellen, alleMitarbeiter, isAdmin, onCellClick, onBaustelleClick }) {
  const today = new Date();
  const rowFor = (person, date) => {
    if (person.id === "__unassigned") {
      return baustellen.filter((b) => isActiveOn(b, date) && !(b.zuweisungen || []).some((z) => isZuweisungAktivAm(z, date)));
    }
    return baustellen.filter((b) => (b.zuweisungen || []).some((z) => z.mitarbeiterId === person.id && isZuweisungAktivAm(z, date)));
  };
  const rows = [
    ...mitarbeiter,
    ...(isAdmin ? [{ id: "__unassigned", name: "Nicht zugewiesen", farbe: COLORS.textMuted }] : []),
  ];
  const displayRows = rows.length ? rows : [{ id: "__none", name: "Niemand zugewiesen", farbe: COLORS.textMuted }];

  return (
    <div style={{ background: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: `160px repeat(${dates.length}, 1fr)`, borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Team</div>
        {dates.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} style={{
              padding: "10px 8px", textAlign: "center", borderLeft: `1px solid ${COLORS.borderSoft}`,
              background: isToday ? "#FFF3EA" : "transparent",
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>
                {d.toLocaleDateString("de-DE", { weekday: "short" })}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: isToday ? COLORS.accentDark : COLORS.textDark }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {displayRows.map((person) => {
        const isUnassignedRow = person.id === "__unassigned" || person.id === "__none";
        return (
        <div key={person.id} style={{ display: "grid", gridTemplateColumns: `160px repeat(${dates.length}, 1fr)`, borderBottom: `1px solid ${COLORS.borderSoft}` }}>
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, fontStyle: isUnassignedRow ? "italic" : "normal", color: isUnassignedRow ? COLORS.textMuted : COLORS.textDark }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: person.farbe, flexShrink: 0, opacity: isUnassignedRow ? 0.4 : 1 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.name}</span>
          </div>
          {dates.map((d, i) => {
            const items = person.id === "__none" ? [] : rowFor(person, d);
            return (
              <div
                key={i}
                onClick={() => onCellClick(d)}
                style={{ borderLeft: `1px solid ${COLORS.borderSoft}`, padding: 5, minHeight: 60, cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}
              >
                {items.map((b) => {
                  const rowColor = person.farbe || COLORS.textMuted;
                  return (
                    <div
                      key={b.id}
                      onClick={(e) => { e.stopPropagation(); onBaustelleClick(b); }}
                      style={{
                        borderLeft: `3px solid ${rowColor}`, background: hexToRgba(rowColor, 0.1),
                        borderRadius: 5, padding: "4px 6px", fontSize: 11.5,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: COLORS.textDark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.kunde}</div>
                      {formatAdresse(b) && (
                        <div style={{ color: COLORS.textMuted, fontSize: 10.5, display: "flex", alignItems: "center", gap: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <MapPin size={9} /> {formatAdresse(b)}
                        </div>
                      )}
                      {formatZeitraum(b) && (
                        <div style={{ color: COLORS.textMuted, fontSize: 10.5, display: "flex", alignItems: "center", gap: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Clock size={9} /> {formatZeitraum(b)}
                        </div>
                      )}
                      {b.zuweisungen && b.zuweisungen.length > 1 && alleMitarbeiter && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          {b.zuweisungen.filter((z) => isZuweisungAktivAm(z, d)).map((z) => {
                            const p = alleMitarbeiter.find((m) => m.id === z.mitarbeiterId);
                            return p ? (
                              <span key={z.mitarbeiterId} title={p.name} style={{ width: 6, height: 6, borderRadius: "50%", background: p.farbe }} />
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}

function BaustelleModal({ form, setForm, mitarbeiterListe, alleMitarbeiter, onToggleMitarbeiter, onUpdateZuweisung, conflicts, onSave, onDelete, onClose }) {
  const conflictsFor = (id) => conflicts.filter((c) => c.mitarbeiterId === id);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{form.id ? "Baustelle bearbeiten" : "Neue Baustelle"}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Kunde">
          <input style={inputStyle} value={form.kunde} onChange={(e) => setForm({ ...form, kunde: e.target.value })} placeholder="Name des Kunden" />
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Ansprechpartner" style={{ flex: 1 }}>
            <input style={inputStyle} value={form.kontaktName} onChange={(e) => setForm({ ...form, kontaktName: e.target.value })} placeholder="Name des Kontakts" />
          </Field>
          <Field label="Telefon" style={{ flex: 1 }}>
            <input type="tel" style={inputStyle} value={form.kontaktTelefon} onChange={(e) => setForm({ ...form, kontaktTelefon: e.target.value })} placeholder="+49 …" />
          </Field>
        </div>
        <Field label="Beschreibung">
          <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={form.beschreibung} onChange={(e) => setForm({ ...form, beschreibung: e.target.value })} placeholder="Auszuführende Arbeiten" />
        </Field>
        <Field label="Straße und Hausnummer">
          <input style={inputStyle} value={form.strasse} onChange={(e) => setForm({ ...form, strasse: e.target.value })} placeholder="Musterstraße 12" />
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="PLZ" style={{ flex: "0 0 110px" }}>
            <input style={inputStyle} value={form.plz} onChange={(e) => setForm({ ...form, plz: e.target.value })} placeholder="72336" />
          </Field>
          <Field label="Stadt" style={{ flex: 1 }}>
            <input style={inputStyle} value={form.stadt} onChange={(e) => setForm({ ...form, stadt: e.target.value })} placeholder="Balingen" />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Beginn (Projekt)" style={{ flex: 1 }}>
            <input
              type="date" style={inputStyle} value={form.beginn}
              onChange={(e) => {
                const val = e.target.value;
                setForm((f) => ({
                  ...f,
                  beginn: val,
                  zuweisungen: f.zuweisungen.map((z) => {
                    const synced = z.beginn === f.beginn ? { ...z, beginn: val } : z;
                    // Ne jamais laisser une affectation démarrer avant le projet
                    if (synced.beginn < val) return { ...synced, beginn: val };
                    return synced;
                  }),
                }));
              }}
            />
          </Field>
          <Field label="Ende (Projekt)" style={{ flex: 1 }}>
            <input
              type="date" style={inputStyle} value={form.ende}
              onChange={(e) => {
                const val = e.target.value;
                setForm((f) => ({
                  ...f,
                  ende: val,
                  zuweisungen: f.zuweisungen.map((z) => {
                    const synced = z.ende === f.ende ? { ...z, ende: val } : z;
                    // Ne jamais laisser une affectation finir après le projet
                    if (synced.ende > val) return { ...synced, ende: val };
                    return synced;
                  }),
                }));
              }}
            />
          </Field>
        </div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: -6, marginBottom: 12 }}>
          Jeder Mitarbeiter kann einen eigenen Zeitraum haben, aber nur innerhalb der Projektdauer.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Uhrzeit von (optional)" style={{ flex: 1 }}>
            <input
              type="time" style={inputStyle} value={form.startzeit}
              onChange={(e) => setForm({ ...form, startzeit: e.target.value })}
            />
          </Field>
          <Field label="Uhrzeit bis (optional)" style={{ flex: 1 }}>
            <input
              type="time" style={inputStyle} value={form.endzeit}
              onChange={(e) => setForm({ ...form, endzeit: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Zugewiesene Mitarbeiter">
          {form.zuweisungen.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              {form.zuweisungen.map((z) => {
                const person = alleMitarbeiter.find((m) => m.id === z.mitarbeiterId);
                const myConflicts = conflictsFor(z.mitarbeiterId);
                return (
                  <div key={z.mitarbeiterId} style={{ background: "#F6F5F2", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: person?.farbe, flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{person?.name || "?"}</span>
                      <button
                        onClick={() => onToggleMitarbeiter(z.mitarbeiterId)}
                        title="Entfernen"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted, display: "flex", padding: 2 }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="date"
                        style={{ ...inputStyle, padding: "6px 9px", fontSize: 12.5 }}
                        value={z.beginn}
                        min={form.beginn}
                        max={form.ende}
                        onChange={(e) => onUpdateZuweisung(z.mitarbeiterId, "beginn", e.target.value)}
                      />
                      <input
                        type="date"
                        style={{ ...inputStyle, padding: "6px 9px", fontSize: 12.5 }}
                        value={z.ende}
                        min={form.beginn}
                        max={form.ende}
                        onChange={(e) => onUpdateZuweisung(z.mitarbeiterId, "ende", e.target.value)}
                      />
                    </div>
                    {myConflicts.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 11.5, color: "#B42318", fontWeight: 600 }}>
                        ⚠ Bereits eingeplant bei {myConflicts.map((c) => `${c.kunde} (${c.beginn} – ${c.ende})`).join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 10 }}>
              Noch niemand zugewiesen.
            </div>
          )}

          <AddMitarbeiterButton
            verfuegbar={mitarbeiterListe.filter((m) => !form.zuweisungen.some((z) => z.mitarbeiterId === m.id))}
            onAdd={onToggleMitarbeiter}
          />
        </Field>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ ...btnSecondary, color: "#B42318", borderColor: "#F3D6D2", display: "flex", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} /> Löschen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>Abbrechen</button>
          <button onClick={onSave} disabled={!form.kunde.trim() || conflicts.length > 0} style={{ ...btnPrimary, opacity: form.kunde.trim() && conflicts.length === 0 ? 1 : 0.5 }}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMitarbeiterButton({ verfuegbar, onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
          border: `1.5px dashed ${COLORS.accent}`, background: "#FFF6EF", color: COLORS.accentDark,
          fontSize: 12.5, fontWeight: 700, cursor: "pointer", width: "100%", justifyContent: "center",
        }}
      >
        <Plus size={15} /> Mitarbeiter hinzufügen
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 60 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 61,
            background: "#fff", borderRadius: 10, border: `1px solid ${COLORS.border}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 6, maxHeight: 220, overflowY: "auto",
          }}>
            {verfuegbar.length === 0 ? (
              <div style={{ fontSize: 12.5, color: COLORS.textMuted, padding: "8px 10px" }}>Alle verfügbaren Mitarbeiter sind bereits zugewiesen.</div>
            ) : (
              verfuegbar.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onAdd(m.id); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent",
                    cursor: "pointer", fontSize: 13, fontWeight: 600, color: COLORS.textDark,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F5F2")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.farbe, flexShrink: 0 }} />
                  {m.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProfileModal({ person, canEdit, onSave, onSendWochenplan, onClose }) {
  const [name, setName] = useState(person?.name || "");
  const [email, setEmail] = useState(person?.email || "");
  const [telefon, setTelefon] = useState(person?.telefon || "");
  const [adresse, setAdresse] = useState(person?.adresse || "");
  const [saved, setSaved] = useState(false);

  if (!person) return null;

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), email: email.trim(), telefon: telefon.trim(), adresse: adresse.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: person.farbe, flexShrink: 0 }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>{person.name}</div>
            {person.istAdmin && <ShieldCheck size={14} style={{ color: COLORS.textMuted }} />}
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Name">
          <input
            style={inputStyle} value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Vor- und Nachname" disabled={!canEdit}
          />
        </Field>
        <Field label="E-Mail">
          <div style={{ position: "relative" }}>
            <Mail size={14} style={{ position: "absolute", left: 10, top: 11, color: COLORS.textMuted }} />
            <input
              type="email" style={{ ...inputStyle, paddingLeft: 30 }} value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" disabled={!canEdit}
            />
          </div>
        </Field>
        <Field label="Handy">
          <div style={{ position: "relative" }}>
            <Phone size={14} style={{ position: "absolute", left: 10, top: 11, color: COLORS.textMuted }} />
            <input
              type="tel" style={{ ...inputStyle, paddingLeft: 30 }} value={telefon}
              onChange={(e) => setTelefon(e.target.value)} placeholder="+49 151 23456789" disabled={!canEdit}
            />
          </div>
        </Field>
        <Field label="Adresse (optional)">
          <div style={{ position: "relative" }}>
            <Home size={14} style={{ position: "absolute", left: 10, top: 11, color: COLORS.textMuted }} />
            <input
              style={{ ...inputStyle, paddingLeft: 30 }} value={adresse}
              onChange={(e) => setAdresse(e.target.value)} placeholder="Straße, PLZ, Ort" disabled={!canEdit}
            />
          </div>
        </Field>

        {canEdit && (
          <button onClick={handleSave} style={{ ...btnSecondary, width: "100%", marginBottom: 14 }}>
            {saved ? "Gespeichert ✓" : "Kontaktdaten speichern"}
          </button>
        )}

        <div style={{ borderTop: `1px solid ${COLORS.borderSoft}`, paddingTop: 14 }}>
          <button
            onClick={onSendWochenplan}
            disabled={!person.email}
            title={!person.email ? "Bitte zuerst eine E-Mail-Adresse hinterlegen" : ""}
            style={{
              ...btnPrimary, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              opacity: person.email ? 1 : 0.5, cursor: person.email ? "pointer" : "not-allowed",
            }}
          >
            <Send size={14} /> Wochenplan per E-Mail senden
          </button>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 8, lineHeight: 1.4 }}>
            Öffnet eine vorausgefüllte E-Mail in deinem Mailprogramm mit dem Plan der aktuellen Woche. Automatischer Versand bei jeder Änderung ist in dieser Vorschau nicht möglich (siehe Erklärung im Chat).
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamModal({ mitarbeiter, newName, setNewName, newIsAdmin, setNewIsAdmin, onAdd, onRemove, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Team verwalten</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {mitarbeiter.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#F6F5F2", borderRadius: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe }} />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
              {m.istAdmin && <span style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Admin</span>}
              <button onClick={() => onRemove(m.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {mitarbeiter.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>Noch keine Mitarbeiter.</div>}
        </div>

        <input
          style={{ ...inputStyle, marginBottom: 8 }}
          placeholder="Name des Mitarbeiters"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.textMuted, marginBottom: 10 }}>
          <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
          Admin (sieht die gesamte Unternehmensplanung)
        </label>
        <button onClick={onAdd} style={{ ...btnPrimary, width: "100%" }}>Hinzufügen</button>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.textMuted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
  fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box", color: COLORS.textDark,
};
const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(28,33,38,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16,
};
const modalStyle = {
  background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 440,
  maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
};
const btnPrimary = {
  padding: "9px 16px", borderRadius: 8, border: "none", background: COLORS.accent,
  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  padding: "9px 16px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "#fff",
  color: COLORS.textDark, fontSize: 13, fontWeight: 700, cursor: "pointer",
};
