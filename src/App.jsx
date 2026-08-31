import React, { useState, useEffect, useCallback } from "react";
import { Plus, X, MapPin, User, ChevronLeft, ChevronRight, Trash2, Users, LogOut, ShieldCheck, Calendar as CalendarIcon, Mail, Phone, Home, Send, Menu as MenuIcon, Clock, ClipboardList, Building2, Search } from "lucide-react";
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
function zeitenUeberlappen(aStart, aEnde, bStart, bEnde) {
  // Si l'une des deux baustellen n'a pas d'heure précisée, on suppose
  // prudemment qu'elle occupe toute la journée (comportement inchangé).
  if (!aStart || !aEnde || !bStart || !bEnde) return true;
  return aStart < bEnde && bStart < aEnde;
}
function istWochenendtag(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const tag = new Date(y, m - 1, d).getDay();
  return tag === 0 || tag === 6; // Sonntag oder Samstag
}
function enthaeltWochenende(beginn, ende) {
  if (!beginn || !ende) return false;
  let cur = beginn;
  let sicherheit = 0;
  while (cur <= ende && sicherheit < 1000) {
    if (istWochenendtag(cur)) return true;
    const [y, m, d] = cur.split("-").map(Number);
    cur = fmt(new Date(y, m - 1, d + 1));
    sicherheit++;
  }
  return false;
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
    authUserId: row.auth_user_id || null,
    name: row.name,
    email: row.email || "",
    telefon: row.telefon || "",
    adresse: row.adresse || "",
    farbe: row.farbe,
    istAdmin: row.ist_admin,
    genehmigt: row.genehmigt !== false, // true par défaut si absent
  };
}
function mapBaustelleRow(row, zuweisungenRows) {
  return {
    id: row.id,
    projektId: row.projekt_id || null,
    kundeId: row.kunde_id || null,
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
function mapKundeRow(row) {
  return {
    id: row.id,
    name: row.name,
    kontaktName: row.kontakt_name || "",
    kontaktTelefon: row.kontakt_telefon || "",
    strasse: row.strasse || "",
    plz: row.plz || "",
    stadt: row.stadt || "",
  };
}
function mapProjektRow(row) {
  return {
    id: row.id,
    nummer: row.nummer,
    titel: row.titel,
    kundeId: row.kunde_id || null,
    status: row.status || "aktiv", // "aktiv" | "abgeschlossen" — décidé uniquement par un admin
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
function formatProjektNummer(p) {
  return "P-" + String(p.nummer).padStart(4, "0");
}
function kundeVollstaendig(k) {
  return !!(k.name?.trim() && k.kontaktName?.trim() && k.kontaktTelefon?.trim() && k.strasse?.trim() && k.plz?.trim() && k.stadt?.trim());
}

const EMPTY_FORM = {
  id: null,
  projektId: null,
  projektTitelEingabe: "", // transitoire, sert à chercher/créer un projet — jamais stocké tel quel
  kundeId: null,
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
const EMPTY_KUNDE_FORM = { id: null, name: "", kontaktName: "", kontaktTelefon: "", strasse: "", plz: "", stadt: "" };
const EMPTY_PROJEKT_FORM = { id: null, titel: "", kundeId: null, kundeNameEingabe: "" };

export default function Baustellenplanung() {
  const [data, setData] = useState({ mitarbeiter: [], baustellen: [], kunden: [], projekte: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState("kalender"); // kalender | projekte | kunden

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
  const [kundeModalOpen, setKundeModalOpen] = useState(false);
  const [kundeForm, setKundeForm] = useState(EMPTY_KUNDE_FORM);
  const [projektModalOpen, setProjektModalOpen] = useState(false);
  const [projektForm, setProjektForm] = useState(EMPTY_PROJEKT_FORM);
  const [authSession, setAuthSession] = useState(undefined); // undefined = pas encore vérifié, null = pas connecté
  const [authLoaded, setAuthLoaded] = useState(false);

  // --- Chargement des données depuis Supabase ---
  // Le mitarbeiter est lisible publiquement (nécessaire pour l'écran de connexion),
  // le reste nécessite une session authentifiée (voir policies RLS).
  const loadData = useCallback(async (session) => {
    try {
      const calls = [supabase.from("mitarbeiter").select("*").order("created_at", { ascending: true })];
      if (session) {
        calls.push(
          supabase.from("baustellen").select("*").order("created_at", { ascending: true }),
          supabase.from("zuweisungen").select("*"),
          supabase.from("kunden").select("*").order("name", { ascending: true }),
          supabase.from("projekte").select("*").order("nummer", { ascending: false })
        );
      }
      const results = await Promise.all(calls);
      const [{ data: mRows, error: mErr }] = results;
      const bErrRes = results[1], zErrRes = results[2], kErrRes = results[3], pErrRes = results[4];
      const anyErr = mErr || bErrRes?.error || zErrRes?.error || kErrRes?.error || pErrRes?.error;
      if (anyErr) {
        setError(`Fehler beim Laden: ${anyErr.message}`);
      } else {
        setError(null);
      }
      setData({
        mitarbeiter: (mRows || []).map(mapMitarbeiterRow),
        baustellen: bErrRes ? (bErrRes.data || []).map((row) => mapBaustelleRow(row, zErrRes?.data)) : [],
        kunden: kErrRes ? (kErrRes.data || []).map(mapKundeRow) : [],
        projekte: pErrRes ? (pErrRes.data || []).map(mapProjektRow) : [],
      });
    } catch (e) {
      setError("Verbindung zu Supabase fehlgeschlagen. Bitte .env prüfen.");
    } finally {
      setLoaded(true);
    }
  }, []);

  // --- Session Supabase Auth (remplace l'ancienne identité stockée localement) ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthSession(session);
      setAuthLoaded(true);
      loadData(session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session);
      loadData(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadData]);

  const me = data.mitarbeiter.find((m) => m.authUserId === authSession?.user?.id) || null;
  const currentUserId = me?.id || null;
  const isAdmin = !!me?.istAdmin;

  const switchUser = async () => {
    await supabase.auth.signOut();
    setFilterId(null);
  };

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
  const approveMitarbeiter = async (id) => {
    const { error: err } = await supabase.from("mitarbeiter").update({ genehmigt: true }).eq("id", id);
    if (err) { setError(`Fehler beim Freischalten: ${err.message}`); return; }
    setData((d) => ({ ...d, mitarbeiter: d.mitarbeiter.map((m) => (m.id === id ? { ...m, genehmigt: true } : m)) }));
  };
  const toggleMitarbeiterAdmin = async (id, neuerWert) => {
    const { error: err } = await supabase.from("mitarbeiter").update({ ist_admin: neuerWert }).eq("id", id);
    if (err) { setError(`Fehler beim Ändern des Admin-Status: ${err.message}`); return; }
    setData((d) => ({ ...d, mitarbeiter: d.mitarbeiter.map((m) => (m.id === id ? { ...m, istAdmin: neuerWert } : m)) }));
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

  // --- Kunden (clients) ---
  const openNewKunde = () => { setKundeForm(EMPTY_KUNDE_FORM); setKundeModalOpen(true); };
  const openEditKunde = (k) => { setKundeForm(k); setKundeModalOpen(true); };
  const saveKunde = async () => {
    if (!kundeForm.name.trim()) return;
    const fields = {
      name: kundeForm.name.trim(),
      kontakt_name: kundeForm.kontaktName.trim(),
      kontakt_telefon: kundeForm.kontaktTelefon.trim(),
      strasse: kundeForm.strasse.trim(),
      plz: kundeForm.plz.trim(),
      stadt: kundeForm.stadt.trim(),
    };
    if (kundeForm.id) {
      const { error: err } = await supabase.from("kunden").update(fields).eq("id", kundeForm.id);
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return; }
      setData((d) => ({ ...d, kunden: d.kunden.map((k) => (k.id === kundeForm.id ? { ...kundeForm } : k)) }));
    } else {
      const { data: inserted, error: err } = await supabase.from("kunden").insert(fields).select().single();
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return; }
      setData((d) => ({ ...d, kunden: [...d.kunden, mapKundeRow(inserted)].sort((a, b) => a.name.localeCompare(b.name)) }));
    }
    setKundeModalOpen(false);
  };
  const deleteKunde = async () => {
    const { error: err } = await supabase.from("kunden").delete().eq("id", kundeForm.id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, kunden: d.kunden.filter((k) => k.id !== kundeForm.id) }));
    setKundeModalOpen(false);
  };
  // Applique les valeurs par défaut d'un client sélectionné aux champs du formulaire de chantier
  const applyKundeToForm = (kunde) => {
    setForm((f) => ({
      ...f,
      kundeId: kunde.id,
      kunde: kunde.name,
      kontaktName: kunde.kontaktName,
      kontaktTelefon: kunde.kontaktTelefon,
      strasse: kunde.strasse,
      plz: kunde.plz,
      stadt: kunde.stadt,
    }));
  };

  // --- Projekte ---
  // Un Projekt regroupe plusieurs rendez-vous (Baustellen/Termine). Son statut
  // (aktiv/abgeschlossen) est décidé UNIQUEMENT par un admin — jamais déduit
  // automatiquement d'une date de fin de rendez-vous.
  const openNewProjekt = (kundeId) => {
    const kunde = kundeId ? data.kunden.find((k) => k.id === kundeId) : null;
    setProjektForm({ ...EMPTY_PROJEKT_FORM, kundeId: kundeId || null, kundeNameEingabe: kunde?.name || "" });
    setProjektModalOpen(true);
  };
  const openEditProjekt = (p) => {
    const kunde = p.kundeId ? data.kunden.find((k) => k.id === p.kundeId) : null;
    setProjektForm({ id: p.id, titel: p.titel, kundeId: p.kundeId, kundeNameEingabe: kunde?.name || "" });
    setProjektModalOpen(true);
  };
  const saveProjekt = async () => {
    if (!projektForm.titel.trim() || !projektForm.kundeNameEingabe.trim()) return null;

    // Un Projekt est toujours rattaché à un client : si aucun client existant
    // n'a été sélectionné, on en crée un nouveau à partir du nom saisi.
    let kundeId = projektForm.kundeId;
    if (!kundeId) {
      const { data: neuerKunde, error: kErr } = await supabase
        .from("kunden")
        .insert({ name: projektForm.kundeNameEingabe.trim() })
        .select()
        .single();
      if (kErr) { setError(`Fehler beim Anlegen des Kunden: ${kErr.message}`); return null; }
      kundeId = neuerKunde.id;
      setData((d) => ({ ...d, kunden: [...d.kunden, mapKundeRow(neuerKunde)].sort((a, b) => a.name.localeCompare(b.name)) }));
    }

    if (projektForm.id) {
      const { error: err } = await supabase.from("projekte").update({ titel: projektForm.titel.trim(), kunde_id: kundeId }).eq("id", projektForm.id);
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return null; }
      const updated = { ...data.projekte.find((p) => p.id === projektForm.id), titel: projektForm.titel.trim(), kundeId };
      setData((d) => ({ ...d, projekte: d.projekte.map((p) => (p.id === projektForm.id ? updated : p)) }));
      setProjektModalOpen(false);
      return updated;
    } else {
      const { data: inserted, error: err } = await supabase
        .from("projekte")
        .insert({ titel: projektForm.titel.trim(), kunde_id: kundeId, status: "aktiv" })
        .select()
        .single();
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return null; }
      const neu = mapProjektRow(inserted);
      setData((d) => ({ ...d, projekte: [neu, ...d.projekte] }));
      setProjektModalOpen(false);
      return neu;
    }
  };
  const toggleProjektStatus = async (id, neuerStatus) => {
    const { error: err } = await supabase.from("projekte").update({ status: neuerStatus }).eq("id", id);
    if (err) { setError(`Fehler beim Ändern des Status: ${err.message}`); return; }
    setData((d) => ({ ...d, projekte: d.projekte.map((p) => (p.id === id ? { ...p, status: neuerStatus } : p)) }));
  };
  const deleteProjekt = async () => {
    const { error: err } = await supabase.from("projekte").delete().eq("id", projektForm.id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, projekte: d.projekte.filter((p) => p.id !== projektForm.id) }));
    setProjektModalOpen(false);
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
    const norm = normalizeBaustelle(b);
    const projekt = norm.projektId ? data.projekte.find((p) => p.id === norm.projektId) : null;
    setForm({ ...norm, projektTitelEingabe: projekt ? projekt.titel : "" });
    setModalOpen(true);
  };
  const findConflicts = (candidateForm) => {
    const conflicts = [];
    for (const z of candidateForm.zuweisungen) {
      for (const other of data.baustellen) {
        if (other.id === candidateForm.id) continue;
        for (const oz of other.zuweisungen || []) {
          if (oz.mitarbeiterId === z.mitarbeiterId
            && rangesOverlap(z.beginn, z.ende, oz.beginn, oz.ende)
            && zeitenUeberlappen(candidateForm.startzeit, candidateForm.endzeit, other.startzeit, other.endzeit)) {
            conflicts.push({ mitarbeiterId: z.mitarbeiterId, kunde: other.kunde, beginn: oz.beginn, ende: oz.ende });
          }
        }
      }
    }
    return conflicts;
  };

  // Détermine automatiquement à quel projet rattacher un NOUVEAU rendez-vous,
  // en fonction des projets déjà actifs du client concerné.
  const erstelleNeuesProjekt = async (kundeId, kundeName) => {
    const titel = window.prompt(`Neues Projekt für ${kundeName} — wie soll es heißen? (leer lassen für automatischen Titel)`, "");
    if (titel === null) return null; // annulé
    const finalTitel = titel.trim() || `Projekt ${kundeName}`;
    const { data: inserted, error: err } = await supabase
      .from("projekte")
      .insert({ titel: finalTitel, kunde_id: kundeId, status: "aktiv" })
      .select()
      .single();
    if (err) { setError(`Fehler beim Anlegen des Projekts: ${err.message}`); return null; }
    const neu = mapProjektRow(inserted);
    setData((d) => ({ ...d, projekte: [neu, ...d.projekte] }));
    return neu.id;
  };
  const resolveProjektFuerBuchung = async (kundeId, kundeName) => {
    const aktiveProjekte = data.projekte.filter((p) => p.kundeId === kundeId && p.status === "aktiv");

    if (aktiveProjekte.length === 0) {
      return erstelleNeuesProjekt(kundeId, kundeName);
    }

    if (aktiveProjekte.length === 1) {
      const p = aktiveProjekte[0];
      const gehoert = window.confirm(
        `Gehört dieser Termin zum aktiven Projekt "${formatProjektNummer(p)} — ${p.titel}"?\n\nOK = ja, diesem Projekt zuordnen.\nAbbrechen = nein, neues Projekt anlegen.`
      );
      if (gehoert) return p.id;
      return erstelleNeuesProjekt(kundeId, kundeName);
    }

    // Plusieurs projets actifs pour ce client : demander lequel.
    const liste = aktiveProjekte.map((p, i) => `${i + 1}. ${formatProjektNummer(p)} — ${p.titel}`).join("\n");
    const eingabe = window.prompt(
      `Mehrere aktive Projekte für ${kundeName} gefunden. Welchem Projekt gehört dieser Termin an?\n\n${liste}\n\nZahl eingeben, oder "neu" für ein neues Projekt:`,
      "1"
    );
    if (eingabe === null) return null; // annulé
    if (eingabe.trim().toLowerCase() === "neu") {
      return erstelleNeuesProjekt(kundeId, kundeName);
    }
    const idx = parseInt(eingabe.trim(), 10) - 1;
    if (idx >= 0 && idx < aktiveProjekte.length) return aktiveProjekte[idx].id;
    setError('Ungültige Eingabe. Bitte "Speichern" erneut klicken und eine gültige Zahl oder "neu" eingeben.');
    return null;
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

    // Si aucun client existant n'est lié, on en crée un nouveau à la volée
    // (réutilisable ensuite pour d'autres projets), sans jamais modifier
    // rétroactivement un client déjà lié quand on édite un projet existant.
    let kundeId = form.kundeId;
    if (!kundeId) {
      const { data: neuerKunde, error: kErr } = await supabase
        .from("kunden")
        .insert({
          name: form.kunde.trim(),
          kontakt_name: form.kontaktName.trim(),
          kontakt_telefon: form.kontaktTelefon.trim(),
          strasse: form.strasse.trim(),
          plz: form.plz.trim(),
          stadt: form.stadt.trim(),
        })
        .select()
        .single();
      if (kErr) { setError(`Fehler beim Anlegen des Kunden: ${kErr.message}`); return; }
      kundeId = neuerKunde.id;
      setData((d) => ({ ...d, kunden: [...d.kunden, mapKundeRow(neuerKunde)].sort((a, b) => a.name.localeCompare(b.name)) }));
    }

    // Projekt : résolu automatiquement pour un NOUVEAU Termin (jamais
    // re-demandé lors de la modification d'un Termin déjà existant).
    let projektId = form.projektId;
    if (!form.id) {
      projektId = await resolveProjektFuerBuchung(kundeId, form.kunde.trim());
      if (!projektId) return; // l'utilisateur a annulé une étape du choix — on n'enregistre rien
    }

    const baustelleFields = {
      projekt_id: projektId,
      kunde_id: kundeId,
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
      projektId: baustelleFields.projekt_id,
      kundeId: baustelleFields.kunde_id,
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

  if (!loaded || !authLoaded) {
    return (
      <div style={{ background: COLORS.bgMain, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ color: COLORS.textMuted }}>Planung wird geladen …</div>
      </div>
    );
  }

  if (!authSession || !me) {
    return (
      <IdentityGate
        mitarbeiter={data.mitarbeiter}
        hatSession={!!authSession}
        onError={setError}
        error={error}
        onCleanError={() => setError(null)}
      />
    );
  }

  if (!me.genehmigt) {
    return (
      <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 30, width: "100%", maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Konto wartet auf Freischaltung</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20 }}>
            Amin oder Alex muss dein Konto freischalten, bevor du die Planung sehen kannst.
          </div>
          <button onClick={switchUser} style={{ ...btnSecondary, width: "100%" }}>Abmelden</button>
        </div>
      </div>
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

        <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            ["kalender", CalendarIcon, "Kalender"],
            ["projekte", ClipboardList, "Projekte"],
            ["kunden", Building2, "Kunden"],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => { setPage(key); setSidebarOpen(false); }}
              style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 9,
                padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                background: page === key ? COLORS.accent : "transparent",
                color: page === key ? "#fff" : COLORS.textLightMuted,
                fontSize: 13.5, fontWeight: page === key ? 700 : 500,
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
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
                display: "flex", alignItems: "center", gap: 7, justifyContent: "center", position: "relative",
              }}
            >
              <User size={13} /> Team verwalten
              {data.mitarbeiter.some((m) => !m.genehmigt) && (
                <span style={{
                  position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%",
                  background: COLORS.accent, color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {data.mitarbeiter.filter((m) => !m.genehmigt).length}
                </span>
              )}
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
        {page === "kalender" && (
          <>
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
          </>
        )}

        {page === "projekte" && (
          <ProjekteListPage
            baustellen={data.baustellen}
            projekte={data.projekte}
            alleMitarbeiter={data.mitarbeiter}
            alleKunden={data.kunden}
            isAdmin={isAdmin}
            onOpenSidebar={() => setSidebarOpen(true)}
            onNew={() => openNewBaustelle()}
            onNewProjekt={() => openNewProjekt()}
            onEditProjekt={openEditProjekt}
            onEdit={openEditBaustelle}
            onToggleStatus={toggleProjektStatus}
            error={error}
          />
        )}

        {page === "kunden" && (
          <KundenListPage
            kunden={data.kunden}
            baustellen={data.baustellen}
            onOpenSidebar={() => setSidebarOpen(true)}
            onNew={openNewKunde}
            onEdit={openEditKunde}
            error={error}
          />
        )}
      </div>

      {modalOpen && (
        <BaustelleModal
          form={form}
          setForm={setForm}
          mitarbeiterListe={isAdmin ? data.mitarbeiter : data.mitarbeiter.filter((m) => m.id === currentUserId)}
          alleMitarbeiter={data.mitarbeiter}
          alleKunden={data.kunden}
          alleProjekte={data.projekte}
          onSelectKunde={applyKundeToForm}
          onToggleMitarbeiter={toggleFormMitarbeiter}
          onUpdateZuweisung={updateFormZuweisung}
          conflicts={findConflicts(form)}
          onSave={saveBaustelle}
          onDelete={form.id ? deleteBaustelle : null}
          onClose={() => setModalOpen(false)}
        />
      )}

      {kundeModalOpen && (
        <KundeModal
          form={kundeForm}
          setForm={setKundeForm}
          onSave={saveKunde}
          onDelete={kundeForm.id ? deleteKunde : null}
          onClose={() => setKundeModalOpen(false)}
        />
      )}

      {projektModalOpen && (
        <ProjektModal
          form={projektForm}
          setForm={setProjektForm}
          alleKunden={data.kunden}
          onSave={saveProjekt}
          onDelete={projektForm.id ? deleteProjekt : null}
          onClose={() => setProjektModalOpen(false)}
        />
      )}

      {teamModalOpen && isAdmin && (
        <TeamModal
          mitarbeiter={data.mitarbeiter}
          currentUserId={currentUserId}
          newName={newName}
          setNewName={setNewName}
          newIsAdmin={newIsAdmin}
          setNewIsAdmin={setNewIsAdmin}
          onAdd={addMitarbeiter}
          onRemove={removeMitarbeiter}
          onApprove={approveMitarbeiter}
          onToggleAdmin={toggleMitarbeiterAdmin}
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

function passwortOk(pw) {
  return pw.length >= 8;
}

function IdentityGate({ mitarbeiter, hatSession, error, onCleanError }) {
  const [modus, setModus] = useState("login"); // login | claim | register
  const [claimTarget, setClaimTarget] = useState(null); // profil {id, name, ...} en cours de revendication

  const unclaimed = mitarbeiter.filter((m) => !m.authUserId);
  const claimed = mitarbeiter.filter((m) => m.authUserId);

  // Cas rare : session valide mais aucun profil lié (ex. suppression pendant la session)
  if (hatSession) {
    return (
      <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 14 }}>
            Angemeldet, aber kein Profil verknüpft. Bitte einen Admin kontaktieren.
          </div>
          <button onClick={() => supabase.auth.signOut()} style={{ ...btnSecondary, width: "100%" }}>Abmelden</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 380 }}>
        <img src="/logo.png" alt="Elektro Schmidtke" style={{ width: "100%", maxWidth: 220, display: "block", margin: "0 auto 18px" }} />
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: COLORS.textMuted, fontWeight: 700, textTransform: "uppercase" }}>Baustellenplanung</div>

        {error && (
          <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, margin: "8px 0" }}>
            {error}
          </div>
        )}

        {modus === "login" && (
          <LoginForm onCleanError={onCleanError} />
        )}

        {modus === "claim" && !claimTarget && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Wähle dein bestehendes Profil</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {unclaimed.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setClaimTarget(m)}
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
              {unclaimed.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>Alle Profile sind bereits eingerichtet.</div>}
            </div>
          </div>
        )}

        {modus === "claim" && claimTarget && (
          <ClaimForm profil={claimTarget} onBack={() => setClaimTarget(null)} onCleanError={onCleanError} />
        )}

        {modus === "register" && (
          <RegisterForm onCleanError={onCleanError} />
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 16, borderTop: `1px solid ${COLORS.borderSoft}`, paddingTop: 14, flexWrap: "wrap" }}>
          {modus !== "login" && (
            <button onClick={() => { setModus("login"); setClaimTarget(null); onCleanError(); }} style={{ ...btnSecondary, fontSize: 11.5, padding: "7px 10px" }}>
              Anmelden
            </button>
          )}
          {modus !== "claim" && claimed.length >= 0 && unclaimed.length > 0 && (
            <button onClick={() => { setModus("claim"); onCleanError(); }} style={{ ...btnSecondary, fontSize: 11.5, padding: "7px 10px" }}>
              Bestehendes Profil einrichten
            </button>
          )}
          {modus !== "register" && (
            <button onClick={() => { setModus("register"); onCleanError(); }} style={{ ...btnSecondary, fontSize: 11.5, padding: "7px 10px" }}>
              Neu hier? Konto erstellen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onCleanError }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");

  const submit = async () => {
    onCleanError();
    setFehler("");
    if (!email.trim() || !passwort) return;
    setLaedt(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort });
    setLaedt(false);
    if (err) setFehler(err.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : `Anmeldefehler: ${err.message}`);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>Anmelden</div>
      {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
      <input
        style={{ ...inputStyle, marginBottom: 8 }} type="email" placeholder="E-Mail" value={email}
        onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        style={{ ...inputStyle, marginBottom: 12 }} type="password" placeholder="Passwort" value={passwort}
        onChange={(e) => setPasswort(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button onClick={submit} disabled={laedt} style={{ ...btnPrimary, width: "100%", opacity: laedt ? 0.6 : 1 }}>
        {laedt ? "…" : "Anmelden"}
      </button>
    </div>
  );
}

function ClaimForm({ profil, onBack, onCleanError }) {
  const [email, setEmail] = useState(profil.email || "");
  const [passwort, setPasswort] = useState("");
  const [passwort2, setPasswort2] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");

  const submit = async () => {
    onCleanError();
    setFehler("");
    if (!email.trim()) { setFehler("Bitte E-Mail-Adresse angeben."); return; }
    if (!passwortOk(passwort)) { setFehler("Passwort muss mindestens 8 Zeichen haben."); return; }
    if (passwort !== passwort2) { setFehler("Passwörter stimmen nicht überein."); return; }
    setLaedt(true);
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email: email.trim(), password: passwort });
    if (signUpErr) {
      setLaedt(false);
      setFehler(signUpErr.message.includes("already registered") ? "Diese E-Mail ist bereits registriert." : `Fehler bei der Registrierung: ${signUpErr.message}`);
      return;
    }
    const userId = signUpData.user?.id;
    if (userId) {
      const { error: updErr } = await supabase.from("mitarbeiter").update({ auth_user_id: userId, email: email.trim() }).eq("id", profil.id);
      if (updErr) { setLaedt(false); setFehler("Konto erstellt, aber Verknüpfung fehlgeschlagen. Bitte Admin kontaktieren."); return; }
    }
    setLaedt(false);
    // La session est active automatiquement après signUp (si "Confirm email" deaktiviert ist in Supabase) ;
    // onAuthStateChange im Hauptkomponenten übernimmt den Rest.
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: profil.farbe }} />
        <div style={{ fontSize: 17, fontWeight: 800 }}>{profil.name} — Passwort festlegen</div>
      </div>
      {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
      <input style={{ ...inputStyle, marginBottom: 8 }} type="email" placeholder="Deine E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 8 }} type="password" placeholder="Neues Passwort (min. 8 Zeichen)" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 12 }} type="password" placeholder="Passwort bestätigen" value={passwort2} onChange={(e) => setPasswort2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onBack} style={btnSecondary}>Zurück</button>
        <button onClick={submit} disabled={laedt} style={{ ...btnPrimary, flex: 1, opacity: laedt ? 0.6 : 1 }}>
          {laedt ? "…" : "Passwort festlegen"}
        </button>
      </div>
    </div>
  );
}

function RegisterForm({ onCleanError }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [passwort2, setPasswort2] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");
  const [erfolg, setErfolg] = useState(false);

  const submit = async () => {
    onCleanError();
    setFehler("");
    if (!name.trim()) { setFehler("Bitte Namen angeben."); return; }
    if (!email.trim()) { setFehler("Bitte E-Mail-Adresse angeben."); return; }
    if (!passwortOk(passwort)) { setFehler("Passwort muss mindestens 8 Zeichen haben."); return; }
    if (passwort !== passwort2) { setFehler("Passwörter stimmen nicht überein."); return; }
    setLaedt(true);
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email: email.trim(), password: passwort });
    if (signUpErr) {
      setLaedt(false);
      setFehler(signUpErr.message.includes("already registered") ? "Diese E-Mail ist bereits registriert." : `Fehler bei der Registrierung: ${signUpErr.message}`);
      return;
    }
    const userId = signUpData.user?.id;
    const color = PERSON_PALETTE[0]; // sera réévalué proprement à la prochaine ouverture "Team verwalten"
    // ist_admin toujours false et genehmigt (validé) toujours false ici : un compte
    // créé en libre-service ne doit jamais pouvoir s'octroyer lui-même des droits,
    // et doit être validé par un admin avant d'accéder aux données.
    const { error: insErr } = await supabase.from("mitarbeiter").insert({
      name: name.trim(), email: email.trim(), farbe: color, ist_admin: false, genehmigt: false, auth_user_id: userId,
    });
    setLaedt(false);
    if (insErr) { setFehler("Konto erstellt, aber Profil konnte nicht angelegt werden."); return; }
    setErfolg(true);
  };

  if (erfolg) {
    return (
      <div style={{ marginTop: 14, textAlign: "center", padding: "10px 0" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
        <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>Konto erstellt</div>
        <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>
          Ein Admin (Amin oder Alex) muss dein Konto noch freischalten, bevor du dich anmelden kannst.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Neues Konto erstellen</div>
      {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
      <input style={{ ...inputStyle, marginBottom: 8 }} placeholder="Dein Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 8 }} type="email" placeholder="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 8 }} type="password" placeholder="Passwort (min. 8 Zeichen)" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
      <input style={{ ...inputStyle, marginBottom: 10 }} type="password" placeholder="Passwort bestätigen" value={passwort2} onChange={(e) => setPasswort2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 12 }}>
        Ein Admin muss dein Konto freischalten, bevor du die Planung sehen kannst.
      </div>
      <button onClick={submit} disabled={laedt} style={{ ...btnPrimary, width: "100%", opacity: laedt ? 0.6 : 1 }}>
        {laedt ? "…" : "Konto erstellen"}
      </button>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid rgba(28,33,38,0.16)` }}>
        {DAY_LABELS.map((d, idx) => {
          const istWochenende = idx === 5 || idx === 6; // Sa, So
          return (
            <div key={d} style={{
              padding: "10px 8px", textAlign: "center", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
              borderLeft: idx === 0 ? "none" : "1px solid rgba(28,33,38,0.16)",
              color: istWochenende ? COLORS.accentDark : COLORS.textMuted,
              background: istWochenende ? hexToRgba(COLORS.accent, 0.045) : "transparent",
            }}>
              {d}
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", background: "rgba(28,33,38,0.16)" }}>
        {grid.map((date, i) => {
          const items = baustellenFor(date);
          const dimmed = date.getMonth() !== currentMonth;
          const isToday = isSameDay(date, today);
          const spalte = i % 7;
          const istWochenende = spalte === 5 || spalte === 6; // Sa, So
          return (
            <div
              key={i}
              onClick={() => onDayClick(date)}
              style={{
                minHeight: 96, minWidth: 0, cursor: "pointer",
                background: dimmed ? "#FAFAF9" : istWochenende ? "#FDF9F9" : COLORS.card,
                display: "flex", flexDirection: "column",
              }}
            >
              <div style={{
                padding: "5px 7px", borderBottom: `1px solid ${COLORS.borderSoft}`,
                display: "flex", alignItems: "center", background: isToday ? "#FFF3EA" : "transparent",
              }}>
                <span style={{
                  fontSize: 12, fontWeight: isToday ? 800 : 700, color: dimmed ? COLORS.textMuted : COLORS.textDark,
                  width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "50%", background: isToday ? COLORS.accent : "transparent",
                  ...(isToday ? { color: "#fff" } : {}),
                }}>
                  {date.getDate()}
                </span>
              </div>
              <div style={{ padding: 6, display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
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
                        display: "flex", alignItems: "center", gap: 4, overflow: "hidden", minWidth: 0,
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
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{b.kunde}</span>
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
          const istWochenende = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div key={i} style={{
              padding: "10px 8px", textAlign: "center", borderLeft: `1px solid ${COLORS.borderSoft}`,
              background: isToday ? "#FFF3EA" : istWochenende ? hexToRgba(COLORS.accent, 0.045) : "transparent", minWidth: 0,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: istWochenende && !isToday ? COLORS.accentDark : COLORS.textMuted, textTransform: "uppercase" }}>
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
            const istWochenende = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={i}
                onClick={() => onCellClick(d)}
                style={{
                  borderLeft: `1px solid ${COLORS.borderSoft}`, padding: 5, minHeight: 60, minWidth: 0, cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 3,
                  background: istWochenende ? hexToRgba(COLORS.accent, 0.03) : "transparent",
                }}
              >
                {items.map((b) => {
                  const rowColor = person.farbe || COLORS.textMuted;
                  return (
                    <div
                      key={b.id}
                      onClick={(e) => { e.stopPropagation(); onBaustelleClick(b); }}
                      style={{
                        borderLeft: `3px solid ${rowColor}`, background: hexToRgba(rowColor, 0.1),
                        borderRadius: 5, padding: "4px 6px", fontSize: 11.5, minWidth: 0, maxWidth: "100%", boxSizing: "border-box",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: COLORS.textDark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.kunde}</div>
                      {formatAdresse(b) && (
                        <div style={{ color: COLORS.textMuted, fontSize: 10.5, display: "flex", alignItems: "center", gap: 3, minWidth: 0, overflow: "hidden" }}>
                          <MapPin size={9} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{formatAdresse(b)}</span>
                        </div>
                      )}
                      {formatZeitraum(b) && (
                        <div style={{ color: COLORS.textMuted, fontSize: 10.5, display: "flex", alignItems: "center", gap: 3, minWidth: 0, overflow: "hidden" }}>
                          <Clock size={9} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{formatZeitraum(b)}</span>
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

function BaustelleModal({ form, setForm, mitarbeiterListe, alleMitarbeiter, alleKunden, alleProjekte, onSelectKunde, onToggleMitarbeiter, onUpdateZuweisung, conflicts, onSave, onDelete, onClose }) {
  const conflictsFor = (id) => conflicts.filter((c) => c.mitarbeiterId === id);
  const [kundeSuche, setKundeSuche] = useState("");
  const [kundeDropdownOpen, setKundeDropdownOpen] = useState(false);
  const kundeMatches = kundeSuche.trim()
    ? alleKunden.filter((k) => k.name.toLowerCase().includes(kundeSuche.trim().toLowerCase()))
    : alleKunden;

  const handleSave = () => {
    const projektHatWochenende = enthaeltWochenende(form.beginn, form.ende);
    const zuweisungHatWochenende = form.zuweisungen.some((z) => enthaeltWochenende(z.beginn, z.ende));
    if (projektHatWochenende || zuweisungHatWochenende) {
      const ok = window.confirm("Dieser Zeitraum umfasst ein Wochenende (Samstag und/oder Sonntag). Trotzdem speichern?");
      if (!ok) return;
    }
    onSave();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{form.id ? "Termin bearbeiten" : "Neuer Termin"}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Projekt">
          {form.id ? (
            (() => {
              const projekt = alleProjekte.find((p) => p.id === form.projektId);
              return projekt ? (
                <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.textDark }}>
                  {formatProjektNummer(projekt)} — {projekt.titel}
                  {projekt.status === "abgeschlossen" && (
                    <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>Abgeschlossen</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontStyle: "italic" }}>Kein Projekt zugeordnet</div>
              );
            })()
          ) : (
            <div style={{ fontSize: 11.5, color: COLORS.textMuted, background: "#F6F5F2", borderRadius: 8, padding: "9px 11px" }}>
              Wird beim Speichern automatisch bestimmt: neues Projekt, oder Zuordnung zu einem aktiven Projekt des Kunden.
            </div>
          )}
        </Field>

        <Field label="Kunde">
          <div style={{ position: "relative" }}>
            <input
              style={inputStyle} value={form.kunde}
              onChange={(e) => {
                setForm({ ...form, kunde: e.target.value, kundeId: null });
                setKundeSuche(e.target.value);
                setKundeDropdownOpen(true);
              }}
              onFocus={() => { setKundeSuche(form.kunde); setKundeDropdownOpen(true); }}
              onBlur={() => setTimeout(() => setKundeDropdownOpen(false), 150)}
              placeholder="Kunde suchen oder neu eingeben"
            />
            {form.kundeId && (
              <div style={{ fontSize: 10.5, color: COLORS.brandGreen, fontWeight: 700, marginTop: 4 }}>
                ✓ Bestehender Kunde verknüpft
              </div>
            )}
            {!form.kundeId && form.kunde.trim() && (
              <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 4 }}>
                Neuer Kunde — wird beim Speichern in der Kundenliste angelegt.
              </div>
            )}
            {kundeDropdownOpen && kundeMatches.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 61,
                background: "#fff", borderRadius: 10, border: `1px solid ${COLORS.border}`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 6, maxHeight: 200, overflowY: "auto",
              }}>
                {kundeMatches.map((k) => (
                  <button
                    key={k.id}
                    onMouseDown={() => { onSelectKunde(k); setKundeDropdownOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7,
                      border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: COLORS.textDark,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F5F2")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 700 }}>{k.name}</div>
                    {formatAdresse(k) && <div style={{ fontSize: 11, color: COLORS.textMuted }}>{formatAdresse(k)}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
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
          <button
            onClick={handleSave}
            disabled={!form.kunde.trim() || conflicts.length > 0}
            style={{ ...btnPrimary, opacity: form.kunde.trim() && conflicts.length === 0 ? 1 : 0.5 }}
          >
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

function TeamModal({ mitarbeiter, currentUserId, newName, setNewName, newIsAdmin, setNewIsAdmin, onAdd, onRemove, onApprove, onToggleAdmin, onClose }) {
  const wartend = mitarbeiter.filter((m) => !m.genehmigt);
  const aktiv = mitarbeiter.filter((m) => m.genehmigt);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Team verwalten</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        {wartend.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", marginBottom: 8 }}>
              ⏳ Warten auf Freischaltung ({wartend.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {wartend.map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#FFF7ED", border: "1px solid #FDE1B8", borderRadius: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                  <button
                    onClick={() => onApprove(m.id)}
                    style={{ border: "none", background: COLORS.brandGreen, color: "#fff", borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                  >
                    Genehmigen
                  </button>
                  <button onClick={() => onRemove(m.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B42318" }} title="Ablehnen">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {aktiv.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#F6F5F2", borderRadius: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
              {m.id === currentUserId ? (
                m.istAdmin && <span style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", fontWeight: 700 }}>Admin</span>
              ) : (
                <button
                  onClick={() => onToggleAdmin(m.id, !m.istAdmin)}
                  title={m.istAdmin ? "Admin-Rechte entfernen" : "Zum Admin machen"}
                  style={{
                    border: `1px solid ${m.istAdmin ? COLORS.accent : COLORS.border}`,
                    background: m.istAdmin ? COLORS.accent : "#fff",
                    color: m.istAdmin ? "#fff" : COLORS.textMuted,
                    borderRadius: 6, padding: "4px 8px", fontSize: 10.5, fontWeight: 700,
                    textTransform: "uppercase", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  {m.istAdmin ? "Admin ✓" : "Admin machen"}
                </button>
              )}
              <button onClick={() => onRemove(m.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {aktiv.length === 0 && <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>Noch keine Mitarbeiter.</div>}
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

function PageHeader({ onOpenSidebar, title, actionLabel, onAction }) {
  return (
    <div className="app-topbar" style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <button
        className="hamburger-btn"
        onClick={onOpenSidebar}
        style={{
          alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 10,
          border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: "pointer", color: COLORS.textDark,
          flexShrink: 0, WebkitTapHighlightColor: "transparent",
        }}
      >
        <MenuIcon size={20} />
      </button>
      <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>{title}</div>
      {onAction && (
        <button
          onClick={onAction}
          style={{
            display: "flex", alignItems: "center", gap: 6, background: COLORS.accent, color: "#fff",
            border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          <Plus size={16} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

function ProjekteListPage({ baustellen, projekte, alleMitarbeiter, alleKunden, isAdmin, onOpenSidebar, onNew, onNewProjekt, onEditProjekt, onEdit, onToggleStatus, error }) {
  const [suche, setSuche] = useState("");
  const [statusFilter, setStatusFilter] = useState("alle"); // alle | aktiv | abgeschlossen
  const [aufgeklappt, setAufgeklappt] = useState({});

  const namenFuer = (b) =>
    (b.zuweisungen || [])
      .map((z) => alleMitarbeiter.find((m) => m.id === z.mitarbeiterId)?.name)
      .filter(Boolean)
      .join(", ");

  const kundeName = (kundeId) => alleKunden.find((k) => k.id === kundeId)?.name || "";

  // Regroupe les rendez-vous par projet ; ceux sans projet vont dans un groupe à part.
  const gruppen = projekte.map((p) => ({
    projekt: p,
    termine: baustellen.filter((b) => b.projektId === p.id),
  }));
  const ohneProjekt = baustellen.filter((b) => !b.projektId);
  if (ohneProjekt.length > 0) {
    gruppen.push({ projekt: null, termine: ohneProjekt });
  }

  const gefiltert = gruppen
    .filter(({ projekt }) => statusFilter === "alle" || (projekt ? projekt.status === statusFilter : statusFilter === "aktiv"))
    .filter(({ projekt, termine }) => {
      if (!suche.trim()) return true;
      const q = suche.trim().toLowerCase();
      const titel = projekt ? `${formatProjektNummer(projekt)} ${projekt.titel} ${kundeName(projekt.kundeId)}`.toLowerCase() : "ohne projekt";
      return titel.includes(q) || termine.some((b) => b.kunde.toLowerCase().includes(q) || formatAdresse(b).toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (!a.projekt) return 1;
      if (!b.projekt) return -1;
      return b.projekt.nummer - a.projekt.nummer;
    });

  const toggle = (key) => setAufgeklappt((a) => ({ ...a, [key]: !a[key] }));

  return (
    <>
      <PageHeader onOpenSidebar={onOpenSidebar} title="Projekte" actionLabel={isAdmin ? "Neues Projekt" : undefined} onAction={isAdmin ? onNewProjekt : undefined} />
      {error && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12.5, padding: "8px 22px" }}>{error}</div>}

      <div style={{ padding: "16px 22px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 12, color: COLORS.textMuted }} />
          <input
            style={{ ...inputStyle, paddingLeft: 32 }} value={suche}
            onChange={(e) => setSuche(e.target.value)} placeholder="Projekt, Kunde oder Adresse suchen…"
          />
        </div>
        <div style={{ display: "flex", background: COLORS.bgMain, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["alle", "Alle"], ["aktiv", "Aktiv"], ["abgeschlossen", "Abgeschlossen"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              style={{
                padding: "7px 13px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12.5, fontWeight: 700,
                background: statusFilter === v ? COLORS.card : "transparent",
                color: statusFilter === v ? COLORS.textDark : COLORS.textMuted,
                boxShadow: statusFilter === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {gefiltert.length === 0 ? (
          <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 13.5, padding: 40 }}>
            Keine Projekte gefunden.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {gefiltert.map(({ projekt, termine }) => {
              const key = projekt ? projekt.id : "ohne-projekt";
              const offen = aufgeklappt[key] !== false; // ouvert par défaut
              const status = projekt ? projekt.status : "aktiv";
              return (
                <div key={key} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => toggle(key)}
                    style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#FAFAF9" }}
                  >
                    <div style={{ color: COLORS.textMuted, flexShrink: 0 }}>{offen ? "▾" : "▸"}</div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, color: COLORS.textDark }}>
                        {projekt ? `${formatProjektNummer(projekt)} — ${projekt.titel}` : "Ohne Projekt"}
                      </div>
                      {projekt && kundeName(projekt.kundeId) && (
                        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{kundeName(projekt.kundeId)}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: COLORS.textMuted }}>{termine.length} Termin{termine.length !== 1 ? "e" : ""}</div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase",
                      background: status === "aktiv" ? "#EAF6EF" : "#F1F0EC",
                      color: status === "aktiv" ? COLORS.brandGreen : COLORS.textMuted,
                    }}>
                      {status === "aktiv" ? "Aktiv" : "Abgeschlossen"}
                    </div>
                    {projekt && isAdmin && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditProjekt(projekt); }}
                          style={{ ...btnSecondary, padding: "5px 10px", fontSize: 11.5 }}
                        >
                          Bearbeiten
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleStatus(projekt.id, status === "aktiv" ? "abgeschlossen" : "aktiv"); }}
                          style={{
                            ...btnSecondary, padding: "5px 10px", fontSize: 11.5,
                            color: status === "aktiv" ? "#B45309" : COLORS.brandGreen,
                          }}
                        >
                          {status === "aktiv" ? "Abschließen" : "Wieder öffnen"}
                        </button>
                      </>
                    )}
                  </div>

                  {offen && (
                    <div style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
                      {termine.length === 0 ? (
                        <div style={{ padding: "12px 16px", fontSize: 12.5, color: COLORS.textMuted, fontStyle: "italic" }}>
                          Noch keine Termine für dieses Projekt.
                        </div>
                      ) : (
                        termine
                          .sort((a, b) => (a.beginn < b.beginn ? 1 : -1))
                          .map((b) => (
                            <div
                              key={b.id}
                              onClick={() => onEdit(b)}
                              style={{
                                padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                                borderTop: `1px solid ${COLORS.borderSoft}`,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 160 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.textDark }}>{b.kunde}</div>
                                {formatAdresse(b) && (
                                  <div style={{ fontSize: 11.5, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                                    <MapPin size={10} /> {formatAdresse(b)}
                                  </div>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: COLORS.textMuted, minWidth: 130 }}>
                                {b.beginn} → {b.ende}
                                {formatZeitraum(b) && <div style={{ fontSize: 10.5 }}>{formatZeitraum(b)}</div>}
                              </div>
                              <div style={{ fontSize: 11.5, color: COLORS.textMuted, minWidth: 120 }}>
                                {namenFuer(b) || <span style={{ fontStyle: "italic" }}>Nicht zugewiesen</span>}
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KundenListPage({ kunden, baustellen, onOpenSidebar, onNew, onEdit, error }) {
  const [suche, setSuche] = useState("");
  const gefiltert = kunden
    .filter((k) => !suche.trim() || k.name.toLowerCase().includes(suche.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const projektAnzahl = (kundeId) => baustellen.filter((b) => b.kundeId === kundeId).length;

  return (
    <>
      <PageHeader onOpenSidebar={onOpenSidebar} title="Kunden" actionLabel="Neuer Kunde" onAction={onNew} />
      {error && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12.5, padding: "8px 22px" }}>{error}</div>}

      <div style={{ padding: "16px 22px 0" }}>
        <div style={{ position: "relative", maxWidth: 360 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 12, color: COLORS.textMuted }} />
          <input
            style={{ ...inputStyle, paddingLeft: 32 }} value={suche}
            onChange={(e) => setSuche(e.target.value)} placeholder="Kunde suchen…"
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {gefiltert.length === 0 ? (
          <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 13.5, padding: 40 }}>
            Keine Kunden gefunden.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {gefiltert.map((k) => {
              const vollstaendig = kundeVollstaendig(k);
              return (
              <div
                key={k.id}
                onClick={() => onEdit(k)}
                style={{
                  background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10,
                  padding: "14px 16px", cursor: "pointer", position: "relative",
                }}
              >
                <div style={{
                  position: "absolute", top: 12, right: 12, fontSize: 10, fontWeight: 700, padding: "3px 9px",
                  borderRadius: 20, textTransform: "uppercase",
                  background: vollstaendig ? "#EAF6EF" : "#FDECEA",
                  color: vollstaendig ? COLORS.brandGreen : "#B42318",
                }}>
                  {vollstaendig ? "Vollständig" : "Unvollständig"}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: COLORS.textDark, display: "flex", alignItems: "center", gap: 7, paddingRight: 90 }}>
                  <Building2 size={15} style={{ color: COLORS.textMuted, flexShrink: 0 }} /> {k.name}
                </div>
                {formatAdresse(k) && (
                  <div style={{ fontSize: 12, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                    <MapPin size={11} /> {formatAdresse(k)}
                  </div>
                )}
                {k.kontaktName && (
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 3 }}>
                    {k.kontaktName}{k.kontaktTelefon ? ` · ${k.kontaktTelefon}` : ""}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, marginTop: 8 }}>
                  {projektAnzahl(k.id)} Projekt{projektAnzahl(k.id) !== 1 ? "e" : ""}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KundeModal({ form, setForm, onSave, onDelete, onClose }) {
  const vollstaendig = kundeVollstaendig(form);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{form.id ? "Kunde bearbeiten" : "Neuer Kunde"}</div>
            {form.id && (
              <div style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase",
                background: vollstaendig ? "#EAF6EF" : "#FDECEA",
                color: vollstaendig ? COLORS.brandGreen : "#B42318",
              }}>
                {vollstaendig ? "Vollständig" : "Unvollständig"}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Name">
          <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Firmen- oder Kundenname" />
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Ansprechpartner" style={{ flex: 1 }}>
            <input style={inputStyle} value={form.kontaktName} onChange={(e) => setForm({ ...form, kontaktName: e.target.value })} placeholder="Name des Kontakts" />
          </Field>
          <Field label="Telefon" style={{ flex: 1 }}>
            <input type="tel" style={inputStyle} value={form.kontaktTelefon} onChange={(e) => setForm({ ...form, kontaktTelefon: e.target.value })} placeholder="+49 …" />
          </Field>
        </div>
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
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: -6, marginBottom: 14 }}>
          Diese Angaben sind die Standardwerte für neue Projekte dieses Kunden — pro Projekt änderbar, ohne den Kunden selbst zu ändern.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ ...btnSecondary, color: "#B42318", borderColor: "#F3D6D2", display: "flex", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} /> Löschen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>Abbrechen</button>
          <button onClick={onSave} disabled={!form.name.trim()} style={{ ...btnPrimary, opacity: form.name.trim() ? 1 : 0.5 }}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjektModal({ form, setForm, alleKunden, onSave, onDelete, onClose }) {
  const [kundeDropdownOpen, setKundeDropdownOpen] = useState(false);
  const kundeMatches = form.kundeNameEingabe.trim()
    ? alleKunden.filter((k) => k.name.toLowerCase().includes(form.kundeNameEingabe.trim().toLowerCase()))
    : alleKunden;

  const kannSpeichern = form.titel.trim() && form.kundeNameEingabe.trim();

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{form.id ? "Projekt bearbeiten" : "Neues Projekt"}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Titel">
          <input style={inputStyle} value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} placeholder="z. B. Umbau Erdgeschoss" autoFocus />
        </Field>

        <Field label="Kunde">
          <div style={{ position: "relative" }}>
            <input
              style={inputStyle} value={form.kundeNameEingabe}
              onChange={(e) => {
                setForm({ ...form, kundeNameEingabe: e.target.value, kundeId: null });
                setKundeDropdownOpen(true);
              }}
              onFocus={() => setKundeDropdownOpen(true)}
              onBlur={() => setTimeout(() => setKundeDropdownOpen(false), 150)}
              placeholder="Kunde suchen oder neu eingeben"
            />
            {form.kundeId && (
              <div style={{ fontSize: 10.5, color: COLORS.brandGreen, fontWeight: 700, marginTop: 4 }}>
                ✓ Bestehender Kunde verknüpft
              </div>
            )}
            {!form.kundeId && form.kundeNameEingabe.trim() && (
              <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 4 }}>
                Neuer Kunde — wird beim Speichern in der Kundenliste angelegt.
              </div>
            )}
            {kundeDropdownOpen && kundeMatches.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 61,
                background: "#fff", borderRadius: 10, border: `1px solid ${COLORS.border}`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 6, maxHeight: 180, overflowY: "auto",
              }}>
                {kundeMatches.map((k) => (
                  <button
                    key={k.id}
                    onMouseDown={() => { setForm({ ...form, kundeId: k.id, kundeNameEingabe: k.name }); setKundeDropdownOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7,
                      border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: COLORS.textDark,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F5F2")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {k.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: -6, marginBottom: 14 }}>
          Die Projektnummer wird automatisch vergeben. Der Status (Aktiv/Abgeschlossen) wird auf der Projekte-Seite von einem Admin gesteuert — Termine schließen das Projekt nicht automatisch ab.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ ...btnSecondary, color: "#B42318", borderColor: "#F3D6D2", display: "flex", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} /> Löschen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>Abbrechen</button>
          <button onClick={onSave} disabled={!kannSpeichern} style={{ ...btnPrimary, opacity: kannSpeichern ? 1 : 0.5 }}>
            Speichern
          </button>
        </div>
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
