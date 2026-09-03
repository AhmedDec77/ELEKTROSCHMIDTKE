import React, { useState, useEffect, useCallback } from "react";
import { Plus, X, MapPin, User, ChevronLeft, ChevronRight, Trash2, Users, LogOut, ShieldCheck, Calendar as CalendarIcon, Mail, Phone, Home, Send, Menu as MenuIcon, Clock, ClipboardList, Building2, Search, FileText, Download, Map as MapIcon } from "lucide-react";
// jsPDF, jspdf-autotable et xlsx sont chargés à la demande (voir pdfErstellen
// / excelExportieren) plutôt qu'au chargement de l'app — plus robuste sur
// certains navigateurs mobiles, et allège le chargement initial.
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
  if (ds < baustelle.beginn || ds > baustelle.ende) return false;
  const tag = date.getDay();
  if (tag === 6 && baustelle.samstagAktiv === false) return false; // Samstag explizit ausgeschlossen
  if (tag === 0 && baustelle.sonntagAktiv === false) return false; // Sonntag explizit ausgeschlossen
  return true;
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
const ARBEITSTAG_START = "08:00";
const ARBEITSTAG_ENDE = "17:00";
const ARBEITSTAG_ENDE_EINZELTAG = "19:00"; // tolérance si le Termin ne dure qu'un einziger Tag
const STANDARD_TAGESKAPAZITAET = 8; // 08:00–17:00, moins 1h de pause déjeuner
// Date fixe à partir de laquelle le suivi "Stundennachweis nicht gespeichert"
// commence — les semaines antérieures (avant l'existence de cette fonktion)
// ne sont jamais signalées.
const ZEITERFASSUNG_TRACKING_START = "2026-09-03";
// À partir de cette heure, si "Arbeit beginnen" n'a pas encore été pressé,
// on considère que la journée est probablement déjà terminée et on propose
// de saisir directement début + fin plutôt que de démarrer maintenant.
const TAG_SPAETER_SCHWELLE = "18:00";

// Nombre d'heures que représente un Termin pour UNE journée : basé sur
// l'heure de début/fin si précisée. Recadré sur 08:00–17:00, sauf si le
// Termin ne dure qu'un seul jour, auquel cas un dépassement le soir est
// toléré jusqu'à 19:00. Sinon (Termin sur plusieurs jours), toujours 17:00.
function stundenProTag(baustelle) {
  if (baustelle.startzeit && baustelle.endzeit) {
    const istEinzelTag = baustelle.beginn === baustelle.ende;
    const endeGrenze = istEinzelTag ? ARBEITSTAG_ENDE_EINZELTAG : ARBEITSTAG_ENDE;
    const start = baustelle.startzeit < ARBEITSTAG_START ? ARBEITSTAG_START : baustelle.startzeit;
    const ende = baustelle.endzeit > endeGrenze ? endeGrenze : baustelle.endzeit;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = ende.split(":").map(Number);
    let h = eh + em / 60 - (sh + sm / 60);
    if (h <= 0) h = STANDARD_TAGESKAPAZITAET; // horaire incohérent après recadrage → journée complète par défaut
    return Math.round(h * 4) / 4; // arrondi au quart d'heure
  }
  return STANDARD_TAGESKAPAZITAET;
}
function alleTageZwischen(beginn, ende) {
  const tage = [];
  let cur = beginn;
  let sicherheit = 0;
  while (cur <= ende && sicherheit < 1000) {
    tage.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    cur = fmt(new Date(y, m - 1, d + 1));
    sicherheit++;
  }
  return tage;
}
// Bornes [beginn, ende] pour une période "Tag" / "Woche" / "Monat" ancrée sur une date.
function periodenGrenzen(zeitraum, datum) {
  if (zeitraum === "tag") {
    const ds = fmt(datum);
    return { beginn: ds, ende: ds };
  }
  if (zeitraum === "woche") {
    const start = startOfWeek(datum);
    return { beginn: fmt(start), ende: fmt(addDays(start, 6)) };
  }
  const start = new Date(datum.getFullYear(), datum.getMonth(), 1);
  const ende = new Date(datum.getFullYear(), datum.getMonth() + 1, 0);
  return { beginn: fmt(start), ende: fmt(ende) };
}
// Capacité réelle d'un employé sur une période : jours du calendrier (moins
// le week-end si exclu) MOINS les jours où il est en absence (Urlaub/
// Krankheit/Fortbildung), puisqu'il ne peut de toute façon pas travailler.
function kapazitaetFuerMitarbeiter(mitarbeiterId, periodeBeginn, periodeEnde, abwesenheiten, wochenendeEinschliessen) {
  let kap = 0;
  let abwesendeTage = 0;
  for (const tag of alleTageZwischen(periodeBeginn, periodeEnde)) {
    if (!wochenendeEinschliessen && istWochenendtag(tag)) continue;
    const istAbwesend = (abwesenheiten || []).some((a) => a.mitarbeiterId === mitarbeiterId && a.beginn <= tag && tag <= a.ende);
    if (istAbwesend) {
      abwesendeTage++;
    } else {
      kap += STANDARD_TAGESKAPAZITAET;
    }
  }
  return { kapazitaet: kap, abwesendeTage };
}
function formatDatumDE(ds) {
  if (!ds) return "";
  const [y, m, d] = ds.split("-");
  return `${d}.${m}.${y}`;
}
// Détail des chantiers/tâches d'un employé pour UN jour donné (équivalent
// des colonnes Kunde/Leistung/Std.H. de la fiche hebdomadaire papier).
function eintraegeFuerTag(mitarbeiterId, ds, baustellen) {
  const dateObj = new Date(ds + "T00:00:00");
  const eintraege = [];
  for (const b of baustellen) {
    const z = (b.zuweisungen || []).find((zz) => zz.mitarbeiterId === mitarbeiterId);
    if (z && isZuweisungAktivAm(z, dateObj)) {
      eintraege.push({ baustelleId: b.id, kunde: b.kunde, leistung: b.beschreibung || "", startzeit: b.startzeit || "", endzeit: b.endzeit || "" });
    }
  }
  return eintraege;
}
// Ligne pré-remplie pour la fiche légale (§17 MiLoG) d'un jour donné :
// Beginn/Ende = plage couvrant tous les chantiers du jour, Pause fixe de
// 60 min les jours travaillés, Dauer = durée nette calculée.
function berechneStundennachweisTag(mitarbeiterId, ds, baustellen, abwesenheiten) {
  const abwesenheit = (abwesenheiten || []).find((a) => a.mitarbeiterId === mitarbeiterId && a.beginn <= ds && ds <= a.ende);
  const eintraege = eintraegeFuerTag(mitarbeiterId, ds, baustellen);
  if (abwesenheit || eintraege.length === 0) {
    return { datum: ds, arbeitstag: false, beginn: "", ende: "", pauseMin: 0, dauerStd: 0, aufzeichnungsDatum: "", eintraege, abwesenheit: abwesenheit || null };
  }
  const mitZeiten = eintraege.filter((e) => e.startzeit && e.endzeit);
  const beginn = mitZeiten.length ? mitZeiten.reduce((min, e) => (e.startzeit < min ? e.startzeit : min), mitZeiten[0].startzeit) : ARBEITSTAG_START;
  const ende = mitZeiten.length ? mitZeiten.reduce((max, e) => (e.endzeit > max ? e.endzeit : max), mitZeiten[0].endzeit) : ARBEITSTAG_ENDE;
  const pauseMin = 60;
  const [bh, bm] = beginn.split(":").map(Number);
  const [eh, em] = ende.split(":").map(Number);
  let dauerStd = eh + em / 60 - (bh + bm / 60) - pauseMin / 60;
  if (dauerStd < 0) dauerStd = 0;
  dauerStd = Math.round(dauerStd * 4) / 4;
  return { datum: ds, arbeitstag: true, beginn, ende, pauseMin, dauerStd, aufzeichnungsDatum: "", eintraege, abwesenheit: null };
}
function berechneStundennachweisMonat(mitarbeiterId, jahr, monat, baustellen, abwesenheiten) {
  const beginn = fmt(new Date(jahr, monat, 1));
  const ende = fmt(new Date(jahr, monat + 1, 0));
  return alleTageZwischen(beginn, ende).map((ds) => berechneStundennachweisTag(mitarbeiterId, ds, baustellen, abwesenheiten));
}
// Heures déjà réservées pour un employé sur une période donnée, en sommant
// chaque jour où son affectation est active.
function stundenGebuchtFuerPeriode(mitarbeiterId, periodeBeginn, periodeEnde, baustellen, wochenendeEinschliessen = true) {
  let summe = 0;
  const relevante = baustellen.filter((b) => (b.zuweisungen || []).some((z) => z.mitarbeiterId === mitarbeiterId));
  for (const tag of alleTageZwischen(periodeBeginn, periodeEnde)) {
    if (!wochenendeEinschliessen && istWochenendtag(tag)) continue;
    const aktive = relevante.filter((b) => {
      const z = (b.zuweisungen || []).find((zz) => zz.mitarbeiterId === mitarbeiterId);
      return z && isZuweisungAktivAm(z, new Date(tag + "T00:00:00"));
    });
    if (aktive.length === 0) continue;
    const mitZeiten = aktive.filter((b) => b.startzeit && b.endzeit);
    const ohneZeiten = aktive.filter((b) => !(b.startzeit && b.endzeit));
    let tagesSumme = 0;
    if (mitZeiten.length > 0) {
      // Heures précisées : brutes, la pause déjeuner (1h) n'est pas payée
      // et se déduit une seule fois par jour, pas par chantier.
      const rohTotal = mitZeiten.reduce((s, b) => s + stundenProTag(b), 0);
      tagesSumme += Math.max(0, rohTotal - Math.min(1, rohTotal));
    }
    if (ohneZeiten.length > 0) {
      // Sans heure précisée : on suppose une journée standard déjà NETTE
      // (stundenProTag renvoie déjà la pause exclue) — comptée une seule
      // fois pour le jour, peu importe le nombre de chantiers concernés.
      tagesSumme += STANDARD_TAGESKAPAZITAET;
    }
    summe += tagesSumme;
  }
  return summe;
}
// Vérifie si un employé est libre sur [von, bis] (dates) et, si précisé,
// sur le créneau horaire [uhrzeitVon, uhrzeitBis]. Retourne les conflits trouvés.
function findeKonflikteFuerVerfuegbarkeit(mitarbeiterId, von, bis, uhrzeitVon, uhrzeitBis, baustellen, wochenendeEinschliessen = true) {
  const gefunden = new Map(); // baustelle.id -> baustelle, pour éviter les doublons
  for (const tag of alleTageZwischen(von, bis)) {
    if (!wochenendeEinschliessen && istWochenendtag(tag)) continue;
    for (const b of baustellen) {
      const z = (b.zuweisungen || []).find((zz) => zz.mitarbeiterId === mitarbeiterId);
      if (!z || !isZuweisungAktivAm(z, new Date(tag + "T00:00:00"))) continue;
      if (uhrzeitVon && uhrzeitBis && b.startzeit && b.endzeit) {
        if (!zeitenUeberlappen(uhrzeitVon, uhrzeitBis, b.startzeit, b.endzeit)) continue;
      }
      gefunden.set(b.id, b);
    }
  }
  return Array.from(gefunden.values());
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
    nachname: row.nachname || "",
    email: row.email || "",
    telefon: row.telefon || "",
    adresse: row.adresse || "",
    farbe: row.farbe,
    istAdmin: row.ist_admin,
    genehmigt: row.genehmigt !== false, // true par défaut si absent
    privatFuer: row.privat_fuer || null, // si défini, ce profil n'est visible que pour ce mitarbeiter.id
    zeiterfassungBefreit: row.zeiterfassung_befreit === true,
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
    samstagAktiv: row.samstag_aktiv !== false,
    sonntagAktiv: row.sonntag_aktiv !== false,
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
function mapAbwesenheitRow(row) {
  return {
    id: row.id,
    mitarbeiterId: row.mitarbeiter_id,
    typ: row.typ, // "urlaub" | "krankheit" | "fortbildung"
    beginn: row.beginn,
    ende: row.ende,
    notiz: row.notiz || "",
  };
}
const ABWESENHEIT_LABEL = { urlaub: "Urlaub", krankheit: "Krankheit", fortbildung: "Fortbildung" };
function mapStundennachweisEintragRow(row) {
  return {
    id: row.id,
    mitarbeiterId: row.mitarbeiter_id,
    datum: row.datum,
    kunde: row.kunde || "",
    leistung: row.leistung || "",
    stunden: Number(row.stunden) || 0,
    aufzeichnungsDatum: row.aufzeichnungsdatum || "",
  };
}
function mapArbeitszeitRow(row) {
  return {
    id: row.id,
    mitarbeiterId: row.mitarbeiter_id,
    datum: row.datum,
    beginn: row.beginn ? row.beginn.slice(0, 5) : "",
    ende: row.ende ? row.ende.slice(0, 5) : "",
  };
}
function mapPauseRow(row) {
  return {
    id: row.id,
    mitarbeiterId: row.mitarbeiter_id,
    datum: row.datum,
    beginn: row.beginn ? row.beginn.slice(0, 5) : "",
    ende: row.ende ? row.ende.slice(0, 5) : "",
    motiv: row.motiv || "",
  };
}
function mapAnfrageRow(row) {
  return {
    id: row.id,
    erstelltAm: row.erstellt_am,
    adresse: row.adresse || "",
    kunde: row.kunde || "",
    beschreibung: row.beschreibung || "",
    kontaktName: row.kontakt_name || "",
    kontaktTelefon: row.kontakt_telefon || "",
    status: row.status || "offen",
    zugewiesenAn: row.zugewiesen_an || null,
    notiz: row.notiz || "",
  };
}
const ANFRAGE_STATUS_LABEL = {
  offen: "Offen",
  angebot_gestellt: "Angebot gestellt",
  warten_auf_antwort: "Warten auf Antwort",
  geplant: "Geplant",
  erledigt: "Erledigt",
};
const ANFRAGE_STATUS_FARBE = {
  offen: "#B45309",
  angebot_gestellt: "#0B7285",
  warten_auf_antwort: "#6B46C1",
  geplant: "#2B6CB0",
  erledigt: "#2F855A",
};
const ABWESENHEIT_FARBE = { urlaub: "#0B7285", krankheit: "#B42318", fortbildung: "#6B46C1" };
function findeAbwesenheitenFuerZeitraum(mitarbeiterId, beginn, ende, abwesenheiten) {
  return abwesenheiten.filter((a) => a.mitarbeiterId === mitarbeiterId && rangesOverlap(a.beginn, a.ende, beginn, ende));
}
function formatAdresse(b) {
  const zeile2 = [b.plz, b.stadt].filter(Boolean).join(" ");
  return [b.strasse, zeile2].filter(Boolean).join(", ");
}
// Ouvre Google Maps avec l'itinéraire depuis la position actuelle de
// l'utilisateur (Google Maps la détecte automatiquement) vers l'adresse.
function mapsRichtungUrl(b) {
  const adresse = formatAdresse(b);
  if (!adresse) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adresse)}`;
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
  samstagAktiv: false,
  sonntagAktiv: false,
  startzeit: "",
  endzeit: "",
  zuweisungen: [], // [{ mitarbeiterId, beginn, ende }]
};
const EMPTY_KUNDE_FORM = { id: null, name: "", kontaktName: "", kontaktTelefon: "", strasse: "", plz: "", stadt: "" };
const EMPTY_PROJEKT_FORM = { id: null, titel: "", kundeId: null, kundeNameEingabe: "" };

// Filet de sécurité : en cas d'erreur inattendue pendant le rendu, affiche
// le message d'erreur réel à l'écran (au lieu d'une page blanche muette),
// pour pouvoir le communiquer et le corriger rapidement.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null, componentStack: "" };
  }
  static getDerivedStateFromError(erreur) {
    return { erreur };
  }
  componentDidCatch(erreur, info) {
    console.error("Baustellenplanung – Rendering-Fehler:", erreur, info);
    this.setState({ componentStack: info?.componentStack || "" });
  }
  render() {
    if (this.state.erreur) {
      return (
        <div style={{ background: "#1C2126", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 480 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Etwas ist schiefgelaufen</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 14 }}>
              Bitte diesen Text als Screenshot senden, dann kann der Fehler behoben werden:
            </div>
            <div style={{
              background: "#FDECEA", color: "#B42318", fontSize: 11.5, padding: "10px 12px", borderRadius: 8,
              marginBottom: 10, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 130, overflowY: "auto",
            }}>
              {String(this.state.erreur?.message || this.state.erreur)}
            </div>
            {this.state.componentStack && (
              <div style={{
                background: "#F3F2ED", color: "#4A5568", fontSize: 10.5, padding: "10px 12px", borderRadius: 8,
                marginBottom: 16, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 150, overflowY: "auto",
              }}>
                {this.state.componentStack.trim()}
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{ width: "100%", background: "#BC313F", color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              Seite neu laden
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BaustellenplanungInnen() {
  const [data, setData] = useState({ mitarbeiter: [], baustellen: [], kunden: [], projekte: [], abwesenheiten: [], stundennachweis: [], arbeitszeiten: [], pausen: [], anfragen: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState("pointeuse"); // pointeuse | kalender | projekte | kunden

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
  const EMPTY_ANFRAGE_FORM = { id: null, adresse: "", kunde: "", beschreibung: "", kontaktName: "", kontaktTelefon: "", status: "offen", zugewiesenAn: null, notiz: "" };
  const [anfrageModalOpen, setAnfrageModalOpen] = useState(false);
  const [anfrageForm, setAnfrageForm] = useState(EMPTY_ANFRAGE_FORM);
  const [arbeitszeitModalGeschlossen, setArbeitszeitModalGeschlossen] = useState(false);
  const [stundennachweisErinnerungGeschlossen, setStundennachweisErinnerungGeschlossen] = useState(false);
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
          supabase.from("projekte").select("*").order("nummer", { ascending: false }),
          supabase.from("abwesenheiten").select("*").order("beginn", { ascending: false }),
          supabase.from("stundennachweis_eintraege").select("*").order("datum", { ascending: true }),
          supabase.from("arbeitszeiten").select("*").order("datum", { ascending: false }),
          supabase.from("pausen").select("*").order("datum", { ascending: false }),
          supabase.from("anfragen").select("*").order("erstellt_am", { ascending: false })
        );
      }
      const results = await Promise.all(calls);
      const [{ data: mRows, error: mErr }] = results;
      const bErrRes = results[1], zErrRes = results[2], kErrRes = results[3], pErrRes = results[4], aErrRes = results[5], sErrRes = results[6], wErrRes = results[7], pauErrRes = results[8], anfErrRes = results[9];
      const anyErr = mErr || bErrRes?.error || zErrRes?.error || kErrRes?.error || pErrRes?.error || aErrRes?.error || sErrRes?.error || wErrRes?.error || pauErrRes?.error || anfErrRes?.error;
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
        abwesenheiten: aErrRes ? (aErrRes.data || []).map(mapAbwesenheitRow) : [],
        stundennachweis: sErrRes ? (sErrRes.data || []).map(mapStundennachweisEintragRow) : [],
        arbeitszeiten: wErrRes ? (wErrRes.data || []).map(mapArbeitszeitRow) : [],
        pausen: pauErrRes ? (pauErrRes.data || []).map(mapPauseRow) : [],
        anfragen: anfErrRes ? (anfErrRes.data || []).map(mapAnfrageRow) : [],
      });
    } catch (e) {
      setError("Verbindung zu Supabase fehlgeschlagen. Bitte .env prüfen.");
    } finally {
      setLoaded(true);
    }
  }, []);

  // --- Session Supabase Auth (remplace l'ancienne identité stockée localement) ---
  const [passwortWiederherstellen, setPasswortWiederherstellen] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthSession(session);
      setAuthLoaded(true);
      loadData(session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setPasswortWiederherstellen(true);
      setAuthSession(session);
      loadData(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadData]);

  const me = data.mitarbeiter.find((m) => m.authUserId === authSession?.user?.id) || null;
  const currentUserId = me?.id || null;
  const isAdmin = !!me?.istAdmin;

  useEffect(() => {
    if (me?.zeiterfassungBefreit && page === "pointeuse") setPage("kalender");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

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
      .update({ name: fields.name, nachname: fields.nachname, email: fields.email, telefon: fields.telefon, adresse: fields.adresse })
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

  // --- Abwesenheiten (Urlaub, Krankheit, Fortbildung) ---
  const addAbwesenheit = async ({ mitarbeiterId, typ, beginn, ende, notiz }) => {
    const { data: inserted, error: err } = await supabase
      .from("abwesenheiten")
      .insert({ mitarbeiter_id: mitarbeiterId, typ, beginn, ende, notiz: notiz.trim() })
      .select()
      .single();
    if (err) { setError(`Fehler beim Speichern: ${err.message}`); return; }
    setData((d) => ({ ...d, abwesenheiten: [mapAbwesenheitRow(inserted), ...d.abwesenheiten] }));
  };
  const removeAbwesenheit = async (id) => {
    const { error: err } = await supabase.from("abwesenheiten").delete().eq("id", id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, abwesenheiten: d.abwesenheiten.filter((a) => a.id !== id) }));
  };

  // --- Stempeluhr (pointeuse) ---
  // Un seul enregistrement Beginn/Ende par employé et par jour (le premier
  // "Arbeit beginnen" du jour, le dernier "Arbeit beenden" du jour) — pas
  // par rendez-vous, pour éviter de multiplier les clics.
  const stempelBeginn = async (mitarbeiterId, gewaehlteZeit) => {
    const heute = fmt(new Date());
    const jetzt = gewaehlteZeit || new Date().toTimeString().slice(0, 5);
    const bestehend = data.arbeitszeiten.find((a) => a.mitarbeiterId === mitarbeiterId && a.datum === heute);
    const { data: row, error: err } = await supabase
      .from("arbeitszeiten")
      .upsert({ mitarbeiter_id: mitarbeiterId, datum: heute, beginn: bestehend?.beginn || jetzt }, { onConflict: "mitarbeiter_id,datum" })
      .select()
      .single();
    if (err) { setError(`Fehler beim Stempeln: ${err.message}`); return; }
    const neu = mapArbeitszeitRow(row);
    setData((d) => ({ ...d, arbeitszeiten: [neu, ...d.arbeitszeiten.filter((a) => a.id !== neu.id)] }));
  };
  const stempelEnde = async (mitarbeiterId) => {
    const heute = fmt(new Date());
    const jetzt = new Date().toTimeString().slice(0, 5);
    const { data: row, error: err } = await supabase
      .from("arbeitszeiten")
      .upsert({ mitarbeiter_id: mitarbeiterId, datum: heute, ende: jetzt }, { onConflict: "mitarbeiter_id,datum" })
      .select()
      .single();
    if (err) { setError(`Fehler beim Stempeln: ${err.message}`); return; }
    const neu = mapArbeitszeitRow(row);
    setData((d) => ({ ...d, arbeitszeiten: [neu, ...d.arbeitszeiten.filter((a) => a.id !== neu.id)] }));
  };
  // Saisie/correction manuelle (rattrapage d'un oubli, ou ajustement).
  const nachtragenArbeitszeit = async (mitarbeiterId, datum, beginn, ende) => {
    const { data: row, error: err } = await supabase
      .from("arbeitszeiten")
      .upsert({ mitarbeiter_id: mitarbeiterId, datum, beginn: beginn || null, ende: ende || null }, { onConflict: "mitarbeiter_id,datum" })
      .select()
      .single();
    if (err) { setError(`Fehler beim Speichern: ${err.message}`); return false; }
    const neu = mapArbeitszeitRow(row);
    setData((d) => ({ ...d, arbeitszeiten: [neu, ...d.arbeitszeiten.filter((a) => a.id !== neu.id)] }));
    return true;
  };
  const pauseBeginnen = async (mitarbeiterId, motiv) => {
    const heute = fmt(new Date());
    const jetzt = new Date().toTimeString().slice(0, 5);
    const { data: row, error: err } = await supabase
      .from("pausen")
      .insert({ mitarbeiter_id: mitarbeiterId, datum: heute, beginn: jetzt, motiv: motiv || "" })
      .select()
      .single();
    if (err) { setError(`Fehler beim Pausieren: ${err.message}`); return; }
    setData((d) => ({ ...d, pausen: [mapPauseRow(row), ...d.pausen] }));
  };
  const pauseBeenden = async (pauseId) => {
    const jetzt = new Date().toTimeString().slice(0, 5);
    const { data: row, error: err } = await supabase
      .from("pausen")
      .update({ ende: jetzt })
      .eq("id", pauseId)
      .select()
      .single();
    if (err) { setError(`Fehler beim Beenden der Pause: ${err.message}`); return; }
    const neu = mapPauseRow(row);
    setData((d) => ({ ...d, pausen: d.pausen.map((p) => (p.id === neu.id ? neu : p)) }));
  };

  // --- Anfragen (demandes clients entrantes) ---
  const saveAnfrage = async (form) => {
    const zeilen = {
      adresse: form.adresse.trim(),
      kunde: form.kunde.trim(),
      beschreibung: form.beschreibung.trim(),
      kontakt_name: form.kontaktName.trim(),
      kontakt_telefon: form.kontaktTelefon.trim(),
      status: form.status || "offen",
      zugewiesen_an: form.zugewiesenAn || null,
      notiz: form.notiz.trim(),
    };
    if (form.id) {
      const { data: row, error: err } = await supabase.from("anfragen").update(zeilen).eq("id", form.id).select().single();
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return false; }
      const neu = mapAnfrageRow(row);
      setData((d) => ({ ...d, anfragen: d.anfragen.map((a) => (a.id === neu.id ? neu : a)) }));
    } else {
      const { data: row, error: err } = await supabase.from("anfragen").insert(zeilen).select().single();
      if (err) { setError(`Fehler beim Speichern: ${err.message}`); return false; }
      const neu = mapAnfrageRow(row);
      setData((d) => ({ ...d, anfragen: [neu, ...d.anfragen] }));
    }
    return true;
  };
  const deleteAnfrage = async (id) => {
    const { error: err } = await supabase.from("anfragen").delete().eq("id", id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, anfragen: d.anfragen.filter((a) => a.id !== id) }));
  };

  // Remplace intégralement les lignes sauvegardées pour un employé/mois donné
  // (stratégie simple : on supprime tout ce qui existait pour cette période,
  // puis on réinsère l'état actuel). Retourne true si succès.
  const saveStundennachweis = async (mitarbeiterId, monatBeginn, monatEnde, eintraege) => {
    const { error: delErr } = await supabase
      .from("stundennachweis_eintraege")
      .delete()
      .eq("mitarbeiter_id", mitarbeiterId)
      .gte("datum", monatBeginn)
      .lte("datum", monatEnde);
    if (delErr) { setError(`Fehler beim Speichern: ${delErr.message}`); return false; }

    const zeilen = eintraege
      .filter((e) => e.kunde.trim() || Number(e.stunden) > 0)
      .map((e) => ({
        mitarbeiter_id: mitarbeiterId,
        datum: e.datum,
        kunde: e.kunde.trim(),
        leistung: e.leistung.trim(),
        stunden: Number(e.stunden) || 0,
        aufzeichnungsdatum: e.aufzeichnungsDatum || null,
      }));

    let inserted = [];
    if (zeilen.length > 0) {
      const { data: ins, error: insErr } = await supabase.from("stundennachweis_eintraege").insert(zeilen).select();
      if (insErr) { setError(`Fehler beim Speichern: ${insErr.message}`); return false; }
      inserted = ins;
    }

    setData((d) => ({
      ...d,
      stundennachweis: [
        ...d.stundennachweis.filter((e) => !(e.mitarbeiterId === mitarbeiterId && e.datum >= monatBeginn && e.datum <= monatEnde)),
        ...inserted.map(mapStundennachweisEintragRow),
      ],
    }));
    return true;
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
  const openNewAnfrage = () => { setAnfrageForm(EMPTY_ANFRAGE_FORM); setAnfrageModalOpen(true); };
  const openEditAnfrage = (a) => { setAnfrageForm(a); setAnfrageModalOpen(true); };
  const convertAnfrageToTermin = (a) => {
    const start = fmt(new Date());
    setForm({
      ...EMPTY_FORM,
      id: null,
      kunde: a.kunde || a.adresse,
      kontaktName: a.kontaktName,
      kontaktTelefon: a.kontaktTelefon,
      beschreibung: a.beschreibung,
      strasse: a.adresse,
      beginn: start,
      ende: start,
      zuweisungen: a.zugewiesenAn ? [{ mitarbeiterId: a.zugewiesenAn, beginn: start, ende: start }] : [],
    });
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
  const erstelleNeuesProjekt = async (kundeId, kundeName, vorgegebenerTitel) => {
    let finalTitel = vorgegebenerTitel?.trim();
    if (!finalTitel) {
      const titel = window.prompt(`Neues Projekt für ${kundeName} — wie soll es heißen? (leer lassen für automatischen Titel)`, "");
      if (titel === null) return null; // annulé
      finalTitel = titel.trim() || `Projekt ${kundeName}`;
    }
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

  // Crée un Termin générique "Privat" sur le(s) calendrier(s) public(s) des
  // propriétaires des profils privés concernés, pour marquer le créneau
  // comme occupé — sans jamais révéler le motif réel du rendez-vous privé.
  const blockiereOeffentlichenKalender = async (zuweisungen, beginn, ende, samstagAktiv, sonntagAktiv) => {
    const eigentuemerIds = [...new Set(
      zuweisungen
        .map((z) => data.mitarbeiter.find((m) => m.id === z.mitarbeiterId))
        .filter((m) => m && m.privatFuer)
        .map((m) => m.privatFuer)
    )];
    if (eigentuemerIds.length === 0) return;

    let privatKunde = data.kunden.find((k) => k.name === "Privat");
    if (!privatKunde) {
      const { data: neu, error: err } = await supabase.from("kunden").insert({ name: "Privat" }).select().single();
      if (err) { setError(`Fehler: ${err.message}`); return; }
      privatKunde = mapKundeRow(neu);
      setData((d) => ({ ...d, kunden: [...d.kunden, privatKunde] }));
    }
    let privatProjekt = data.projekte.find((p) => p.titel === "Privat" && p.kundeId === privatKunde.id);
    if (!privatProjekt) {
      const { data: neu, error: err } = await supabase.from("projekte").insert({ titel: "Privat", kunde_id: privatKunde.id, status: "aktiv" }).select().single();
      if (err) { setError(`Fehler: ${err.message}`); return; }
      privatProjekt = mapProjektRow(neu);
      setData((d) => ({ ...d, projekte: [privatProjekt, ...d.projekte] }));
    }

    for (const eigentuemerId of eigentuemerIds) {
      const { data: neueBaustelle, error: bErr } = await supabase
        .from("baustellen")
        .insert({
          projekt_id: privatProjekt.id, kunde_id: privatKunde.id, kunde: "Privat",
          kontakt_name: "", kontakt_telefon: "", beschreibung: "",
          strasse: "", plz: "", stadt: "",
          beginn, ende, samstag_aktiv: samstagAktiv, sonntag_aktiv: sonntagAktiv,
        })
        .select().single();
      if (bErr) { setError(`Fehler beim Blockieren: ${bErr.message}`); continue; }
      const { error: zErr } = await supabase.from("zuweisungen").insert({ baustelle_id: neueBaustelle.id, mitarbeiter_id: eigentuemerId, beginn, ende });
      if (zErr) { setError(`Fehler beim Blockieren: ${zErr.message}`); continue; }
      setData((d) => ({
        ...d,
        baustellen: [...d.baustellen, {
          id: neueBaustelle.id, projektId: privatProjekt.id, kundeId: privatKunde.id, kunde: "Privat",
          kontaktName: "", kontaktTelefon: "", beschreibung: "", strasse: "", plz: "", stadt: "",
          beginn, ende, samstagAktiv, sonntagAktiv, startzeit: "", endzeit: "",
          zuweisungen: [{ mitarbeiterId: eigentuemerId, beginn, ende }],
        }],
      }));
    }
  };

  const saveBaustelle = async () => {
    if (!form.kunde.trim() || !form.beginn || !form.ende) return;
    const outOfRange = form.zuweisungen.filter((z) => z.beginn < form.beginn || z.ende > form.ende);
    if (outOfRange.length > 0) {
      const names = outOfRange.map((z) => data.mitarbeiter.find((m) => m.id === z.mitarbeiterId)?.name || "?");
      setError(`Zeitraum außerhalb des Termins: ${names.join(", ")}. Bitte innerhalb ${form.beginn} – ${form.ende} anpassen.`);
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

    // Projekt : résolu automatiquement pour un NOUVEAU Termin. Pour un Termin
    // déjà existant, le projet reste inchangé — SAUF si l'utilisateur a
    // explicitement utilisé "Projekt ändern" et tapé un nouveau titre non
    // trouvé dans la liste, auquel cas on crée ce nouveau projet.
    let projektId = form.projektId;
    if (!form.id) {
      projektId = await resolveProjektFuerBuchung(kundeId, form.kunde.trim());
      if (!projektId) return; // l'utilisateur a annulé une étape du choix — on n'enregistre rien
    } else if (!projektId && form.projektTitelEingabe.trim()) {
      projektId = await erstelleNeuesProjekt(kundeId, form.kunde.trim(), form.projektTitelEingabe.trim());
      if (!projektId) return;
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
      samstag_aktiv: form.samstagAktiv,
      sonntag_aktiv: form.sonntagAktiv,
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

    // Duplication automatique vers un éventuel profil privé lié (ex. "Amin 2"
    // pour "Amin") : tout rendez-vous où le profil "public" est affecté est
    // aussi enregistré, aux mêmes dates, sur son profil privé.
    let zuweisungenMitSpiegelung = [...form.zuweisungen];
    data.mitarbeiter
      .filter((m) => m.privatFuer)
      .forEach((privat) => {
        const oeffentlich = zuweisungenMitSpiegelung.find((z) => z.mitarbeiterId === privat.privatFuer);
        const dejaVorhanden = zuweisungenMitSpiegelung.some((z) => z.mitarbeiterId === privat.id);
        if (oeffentlich && !dejaVorhanden) {
          zuweisungenMitSpiegelung.push({ mitarbeiterId: privat.id, beginn: oeffentlich.beginn, ende: oeffentlich.ende });
        }
      });

    if (zuweisungenMitSpiegelung.length > 0) {
      const rows = zuweisungenMitSpiegelung.map((z) => ({
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
      samstagAktiv: baustelleFields.samstag_aktiv,
      sonntagAktiv: baustelleFields.sonntag_aktiv,
      startzeit: form.startzeit || "",
      endzeit: form.endzeit || "",
      zuweisungen: zuweisungenMitSpiegelung,
    };
    setData((d) => ({
      ...d,
      baustellen: form.id
        ? d.baustellen.map((b) => (b.id === baustelleId ? savedBaustelle : b))
        : [...d.baustellen, savedBaustelle],
    }));
    setError(null);
    setModalOpen(false);

    // Si ce NOUVEAU Termin n'est affecté qu'à des profils privés (ex. Amin
    // réserve directement sur "Amin 2"), on lui demande s'il souhaite aussi
    // bloquer son calendrier public, sans révéler le motif à personne.
    const istNeuerTermin = !form.id;
    const alleZuweisungenPrivat = form.zuweisungen.length > 0 && form.zuweisungen.every((z) => {
      const m = data.mitarbeiter.find((mm) => mm.id === z.mitarbeiterId);
      return m && m.privatFuer;
    });
    if (istNeuerTermin && alleZuweisungenPrivat) {
      const blockieren = window.confirm(
        "Dieser private Termin ist nur auf deinem privaten Kalender sichtbar.\n\nMöchtest du zusätzlich deinen normalen (öffentlichen) Kalender für diesen Zeitraum als belegt markieren, ohne den Grund zu zeigen — damit dich niemand dafür einplant?\n\nOK = ja, blockieren.\nAbbrechen = nein, Zeitraum bleibt für andere frei."
      );
      if (blockieren) {
        await blockiereOeffentlichenKalender(form.zuweisungen, form.beginn, form.ende, form.samstagAktiv, form.sonntagAktiv);
      }
    }
  };
  const deleteBaustelle = async () => {
    const { error: err } = await supabase.from("baustellen").delete().eq("id", form.id);
    if (err) { setError(`Fehler beim Löschen: ${err.message}`); return; }
    setData((d) => ({ ...d, baustellen: d.baustellen.filter((b) => b.id !== form.id) }));
    setModalOpen(false);
  };
  const toggleFormMitarbeiter = (id) => {
    const exists = form.zuweisungen.some((z) => z.mitarbeiterId === id);
    if (!exists) {
      const abwesenheiten = findeAbwesenheitenFuerZeitraum(id, form.beginn, form.ende, data.abwesenheiten);
      if (abwesenheiten.length > 0) {
        const person = data.mitarbeiter.find((m) => m.id === id);
        const details = abwesenheiten.map((a) => `${ABWESENHEIT_LABEL[a.typ] || a.typ} (${a.beginn} – ${a.ende})${a.notiz ? ` — ${a.notiz}` : ""}`).join("\n");
        window.alert(`${person?.name || "Diese Person"} ist in diesem Zeitraum abwesend:\n\n${details}`);
      }
    }
    setForm((f) => ({
      ...f,
      zuweisungen: exists
        ? f.zuweisungen.filter((z) => z.mitarbeiterId !== id)
        : [...f.zuweisungen, { mitarbeiterId: id, beginn: f.beginn, ende: f.ende }],
    }));
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
  // Un profil "privé" (privatFuer défini) n'est visible que pour son propriétaire.
  const sichtbareMitarbeiter = data.mitarbeiter.filter((m) => !m.privatFuer || m.privatFuer === currentUserId);

  const visibleMitarbeiterList = isAdmin
    ? sichtbareMitarbeiter
    : sichtbareMitarbeiter.filter((m) => m.id === currentUserId);

  const displayedColleagues = filterId
    ? sichtbareMitarbeiter.filter((m) => m.id === filterId)
    : visibleMitarbeiterList;

  // Un chantier n'est masqué que si TOUS ses employés assignés sont des
  // profils privés qui ne m'appartiennent pas — sinon il reste visible
  // normalement (le cas normal, sans aucun profil privé impliqué).
  const istBaustelleSichtbar = (b) => {
    const zugewiesene = (b.zuweisungen || []).map((z) => data.mitarbeiter.find((m) => m.id === z.mitarbeiterId)).filter(Boolean);
    if (zugewiesene.length === 0) return true;
    return zugewiesene.some((m) => !m.privatFuer || m.privatFuer === currentUserId);
  };

  // Un projet est masqué s'il a au moins un Termin et qu'AUCUN de ses
  // Termine n'est visible (c-à-d. tous privés et non-possédés par moi).
  const sichtbareProjekte = data.projekte.filter((p) => {
    const alleTermine = data.baustellen.filter((b) => b.projektId === p.id);
    if (alleTermine.length === 0) return true;
    return alleTermine.some(istBaustelleSichtbar);
  });

  // Une absence n'est visible que si elle concerne un profil non-privé,
  // ou un profil privé qui m'appartient.
  const sichtbareAbwesenheiten = data.abwesenheiten.filter((a) => {
    const m = data.mitarbeiter.find((mm) => mm.id === a.mitarbeiterId);
    return !m || !m.privatFuer || m.privatFuer === currentUserId;
  });

  // Jours passés (30 derniers jours) où j'avais au moins un rendez-vous
  // planifié, mais où la pointeuse n'a pas d'heure de début ET de fin
  // complète — à faire confirmer/rattraper.
  const fehlendeArbeitszeitTage = (() => {
    if (!currentUserId || me?.zeiterfassungBefreit) return [];
    const debutSemaineEnCours = fmt(startOfWeek(new Date()));
    const limite = ZEITERFASSUNG_TRACKING_START; // pas d'historique avant la mise en place de la pointeuse
    const tage = new Map(); // datum -> [{ kunde }]
    data.baustellen.forEach((b) => {
      (b.zuweisungen || []).forEach((z) => {
        if (z.mitarbeiterId !== currentUserId) return;
        for (const ds of alleTageZwischen(z.beginn, z.ende)) {
          // Seules les semaines déjà terminées sont concernées — pas la
          // semaine en cours, dont les jours peuvent encore être pointés
          // normalement d'ici la fin de la semaine.
          if (ds >= debutSemaineEnCours || ds < limite) continue;
          // Un jour où l'employé est enregistré absent (n'importe quel
          // motif) toute la journée n'a pas besoin d'être documenté.
          const estAbsentToutLeJour = data.abwesenheiten.some((a) => a.mitarbeiterId === currentUserId && a.beginn <= ds && ds <= a.ende);
          if (estAbsentToutLeJour) continue;
          if (!tage.has(ds)) tage.set(ds, []);
          tage.get(ds).push(b.kunde);
        }
      });
    });
    return Array.from(tage.entries())
      .filter(([ds]) => {
        const a = data.arbeitszeiten.find((aa) => aa.mitarbeiterId === currentUserId && aa.datum === ds);
        return !a || !a.beginn || !a.ende;
      })
      .map(([datum, kunden]) => ({ datum, kunden }))
      .sort((a, b) => (a.datum < b.datum ? -1 : 1));
  })();

  // Semaines déjà terminées où j'avais des rendez-vous, mais où le
  // Stundennachweis (Wochendetail) n'a jamais été enregistré — pour éviter
  // d'attendre la fin du mois et n'avoir plus que de vagues souvenirs.
  const nichtGespeicherteWochen = (() => {
    if (!currentUserId || me?.zeiterfassungBefreit) return [];
    const debutSemaineEnCours = fmt(startOfWeek(new Date()));
    const limite = ZEITERFASSUNG_TRACKING_START; // pas d'historique avant cette date
    const wochenMitTermin = new Map(); // "KW-Jahr" -> { kw, jahr, beginn, ende }
    data.baustellen.forEach((b) => {
      (b.zuweisungen || []).forEach((z) => {
        if (z.mitarbeiterId !== currentUserId) return;
        for (const ds of alleTageZwischen(z.beginn, z.ende)) {
          if (ds >= debutSemaineEnCours || ds < limite) continue;
          const dateObj = new Date(ds + "T00:00:00");
          const wochenStart = fmt(startOfWeek(dateObj));
          const key = wochenStart;
          if (!wochenMitTermin.has(key)) {
            wochenMitTermin.set(key, { kw: getWeekNumber(dateObj), beginn: wochenStart, ende: fmt(addDays(startOfWeek(dateObj), 6)) });
          }
        }
      });
    });
    return Array.from(wochenMitTermin.values())
      .filter((w) => !data.stundennachweis.some((e) => e.mitarbeiterId === currentUserId && e.datum >= w.beginn && e.datum <= w.ende))
      .sort((a, b) => (a.beginn < b.beginn ? -1 : 1));
  })();


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
      return isActiveOn(b, date) && istBaustelleSichtbar(b);
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

  if (passwortWiederherstellen) {
    return <NeuesPasswortSetzen onDone={() => setPasswortWiederherstellen(false)} />;
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

  if (!me.nachname?.trim() || !me.email?.trim()) {
    return (
      <ProfilVervollstaendigenGate
        me={me}
        onSave={(fields) => updateMitarbeiterProfil(me.id, fields)}
        onLogout={switchUser}
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

        <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            ...(me?.zeiterfassungBefreit ? [] : [["pointeuse", Clock, "Zeiterfassung"]]),
            ["kalender", CalendarIcon, "Kalender"],
            ["projekte", ClipboardList, "Projekte"],
            ["kunden", Building2, "Kunden"],
            ["ressourcen", Users, "Ressourcen"],
            ["anfragen", Phone, "Anfragen"],
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
          {nichtGespeicherteWochen.length > 0 && !stundennachweisErinnerungGeschlossen && (
            <div style={{ background: "#3A2A18", border: "1px solid #6B4A22", borderRadius: 8, padding: "9px 10px" }}>
              <div style={{ fontSize: 11, color: "#F0C77E", fontWeight: 700, marginBottom: 4 }}>
                ⚠ Stundennachweis fehlt für {nichtGespeicherteWochen.length} Woche{nichtGespeicherteWochen.length !== 1 ? "n" : ""}
              </div>
              <div style={{ fontSize: 10.5, color: COLORS.textLightMuted, marginBottom: 7 }}>
                {nichtGespeicherteWochen.map((w) => `KW-${String(w.kw).padStart(2, "0")}`).join(", ")} — bitte zeitnah speichern, nicht bis Monatsende warten.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { setPage("ressourcen"); setStundennachweisErinnerungGeschlossen(true); }}
                  style={{ flex: 1, background: COLORS.accent, color: "#fff", border: "none", borderRadius: 6, padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  Jetzt prüfen
                </button>
                <button
                  onClick={() => setStundennachweisErinnerungGeschlossen(true)}
                  style={{ background: "transparent", color: COLORS.textLightMuted, border: "none", fontSize: 11, cursor: "pointer" }}
                >
                  Später
                </button>
              </div>
            </div>
          )}
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
        {page === "pointeuse" && (
          <PointeuseSeite
            me={me}
            baustellen={data.baustellen}
            arbeitszeiten={data.arbeitszeiten}
            pausen={data.pausen}
            vorwocheOffeneTage={fehlendeArbeitszeitTage}
            onOpenSidebar={() => setSidebarOpen(true)}
            onBeginn={(zeit) => stempelBeginn(currentUserId, zeit)}
            onEnde={() => stempelEnde(currentUserId)}
            onPauseBeginnen={(motiv) => pauseBeginnen(currentUserId, motiv)}
            onPauseBeenden={(pauseId) => pauseBeenden(pauseId)}
            onNachtragenOeffnen={() => setArbeitszeitModalGeschlossen(false)}
            onNachtragHeute={(beginn, ende) => nachtragenArbeitszeit(currentUserId, fmt(new Date()), beginn, ende)}
            onBaustelleClick={openEditBaustelle}
          />
        )}
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
                <Plus size={16} /> Neuer Termin
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
                  alleMitarbeiter={sichtbareMitarbeiter}
                  abwesenheiten={sichtbareAbwesenheiten}
                  onDayClick={openNewBaustelle}
                  onBaustelleClick={openEditBaustelle}
                />
              )}
              {(view === "woche" || view === "tag") && (
                <ResourceView
                  dates={view === "tag" ? [currentDate] : weekDates}
                  mitarbeiter={displayedColleagues.length ? displayedColleagues : visibleMitarbeiterList}
                  baustellen={data.baustellen}
                  alleMitarbeiter={sichtbareMitarbeiter}
                  abwesenheiten={sichtbareAbwesenheiten}
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
            baustellen={data.baustellen.filter(istBaustelleSichtbar)}
            projekte={sichtbareProjekte}
            alleMitarbeiter={sichtbareMitarbeiter}
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

        {page === "ressourcen" && (
          <RessourcenPage
            baustellen={data.baustellen}
            mitarbeiter={sichtbareMitarbeiter}
            abwesenheiten={sichtbareAbwesenheiten}
            stundennachweis={data.stundennachweis}
            arbeitszeiten={data.arbeitszeiten}
            pausen={data.pausen}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onOpenSidebar={() => setSidebarOpen(true)}
            onBaustelleClick={openEditBaustelle}
            onAddAbwesenheit={addAbwesenheit}
            onRemoveAbwesenheit={removeAbwesenheit}
            onSaveStundennachweis={saveStundennachweis}
            error={error}
          />
        )}

        {page === "anfragen" && (
          <AnfragenListPage
            anfragen={data.anfragen}
            mitarbeiter={sichtbareMitarbeiter}
            onOpenSidebar={() => setSidebarOpen(true)}
            onNew={openNewAnfrage}
            onEdit={openEditAnfrage}
            onConvert={convertAnfrageToTermin}
            error={error}
          />
        )}
      </div>

      {modalOpen && (
        <BaustelleModal
          form={form}
          setForm={setForm}
          mitarbeiterListe={isAdmin ? sichtbareMitarbeiter : sichtbareMitarbeiter.filter((m) => m.id === currentUserId)}
          alleMitarbeiter={sichtbareMitarbeiter}
          alleKunden={data.kunden}
          alleProjekte={sichtbareProjekte}
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

      {anfrageModalOpen && (
        <AnfrageModal
          form={anfrageForm}
          setForm={setAnfrageForm}
          mitarbeiter={sichtbareMitarbeiter}
          onSave={async (f) => { const ok = await saveAnfrage(f); if (ok) setAnfrageModalOpen(false); }}
          onDelete={anfrageForm.id ? async () => { await deleteAnfrage(anfrageForm.id); setAnfrageModalOpen(false); } : null}
          onConvert={anfrageForm.id ? () => { setAnfrageModalOpen(false); convertAnfrageToTermin(anfrageForm); } : null}
          onClose={() => setAnfrageModalOpen(false)}
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

      {fehlendeArbeitszeitTage.length > 0 && !arbeitszeitModalGeschlossen && (
        <ArbeitszeitNachtragenModal
          tage={fehlendeArbeitszeitTage}
          onSave={(datum, beginn, ende) => nachtragenArbeitszeit(currentUserId, datum, beginn, ende)}
          onClose={() => setArbeitszeitModalGeschlossen(true)}
        />
      )}

      {teamModalOpen && isAdmin && (
        <TeamModal
          mitarbeiter={sichtbareMitarbeiter}
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

export default function Baustellenplanung() {
  return (
    <ErrorBoundary>
      <BaustellenplanungInnen />
    </ErrorBoundary>
  );
}

function passwortOk(pw) {
  return pw.length >= 8;
}

function ProfilVervollstaendigenGate({ me, onSave, onLogout }) {
  const [name, setName] = useState(me.name || "");
  const [nachname, setNachname] = useState(me.nachname || "");
  const [email, setEmail] = useState(me.email || "");
  const [speichert, setSpeichert] = useState(false);

  const kannSpeichern = name.trim() && nachname.trim() && email.trim();

  const speichern = async () => {
    if (!kannSpeichern) return;
    setSpeichert(true);
    await onSave({ name: name.trim(), nachname: nachname.trim(), email: email.trim(), telefon: me.telefon, adresse: me.adresse });
    setSpeichert(false);
  };

  return (
    <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 30, width: "100%", maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Profil vervollständigen</div>
        <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 18 }}>
          Vorname, Nachname und E-Mail werden benötigt, unter anderem für den Stundennachweis. Bitte einmalig ausfüllen, um fortzufahren.
        </div>
        <Field label="Vorname">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vorname" />
        </Field>
        <Field label="Nachname">
          <input style={inputStyle} value={nachname} onChange={(e) => setNachname(e.target.value)} placeholder="Nachname" />
        </Field>
        <Field label="E-Mail">
          <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.de" />
        </Field>
        <button onClick={speichern} disabled={!kannSpeichern || speichert} style={{ ...btnPrimary, width: "100%", marginTop: 6, opacity: kannSpeichern ? 1 : 0.5 }}>
          {speichert ? "…" : "Speichern und fortfahren"}
        </button>
        <button onClick={onLogout} style={{ ...btnSecondary, width: "100%", marginTop: 8 }}>Abmelden</button>
      </div>
    </div>
  );
}

function NeuesPasswortSetzen({ onDone }) {
  const [passwort, setPasswort] = useState("");
  const [passwort2, setPasswort2] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");
  const [erfolg, setErfolg] = useState(false);

  const submit = async () => {
    setFehler("");
    if (!passwortOk(passwort)) { setFehler("Passwort muss mindestens 8 Zeichen haben."); return; }
    if (passwort !== passwort2) { setFehler("Passwörter stimmen nicht überein."); return; }
    setLaedt(true);
    const { error: err } = await supabase.auth.updateUser({ password: passwort });
    setLaedt(false);
    if (err) { setFehler(`Fehler: ${err.message}`); return; }
    setErfolg(true);
  };

  return (
    <div style={{ background: COLORS.bgDark, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 30, width: "100%", maxWidth: 380 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>Neues Passwort festlegen</div>
        {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
        {erfolg ? (
          <>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
              ✓ Passwort erfolgreich geändert. Du kannst dich jetzt normal anmelden.
            </div>
            <button onClick={onDone} style={{ ...btnPrimary, width: "100%" }}>Weiter zur Anmeldung</button>
          </>
        ) : (
          <>
            <input style={{ ...inputStyle, marginBottom: 8 }} type="password" placeholder="Neues Passwort (min. 8 Zeichen)" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
            <input style={{ ...inputStyle, marginBottom: 12 }} type="password" placeholder="Passwort bestätigen" value={passwort2} onChange={(e) => setPasswort2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            <button onClick={submit} disabled={laedt} style={{ ...btnPrimary, width: "100%", opacity: laedt ? 0.6 : 1 }}>
              {laedt ? "…" : "Passwort speichern"}
            </button>
          </>
        )}
      </div>
    </div>
  );
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
  const [vergessenModus, setVergessenModus] = useState(false);
  const [vergessenGesendet, setVergessenGesendet] = useState(false);

  const submit = async () => {
    onCleanError();
    setFehler("");
    if (!email.trim() || !passwort) return;
    setLaedt(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort });
    setLaedt(false);
    if (err) setFehler(err.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : `Anmeldefehler: ${err.message}`);
  };

  const passwortVergessenSenden = async () => {
    onCleanError();
    setFehler("");
    if (!email.trim()) { setFehler("Bitte zuerst deine E-Mail-Adresse eingeben."); return; }
    setLaedt(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setLaedt(false);
    if (err) { setFehler(`Fehler: ${err.message}`); return; }
    setVergessenGesendet(true);
  };

  if (vergessenModus) {
    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>Passwort vergessen</div>
        {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
        {vergessenGesendet ? (
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 12 }}>
            ✓ Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail mit einem Link zum Zurücksetzen verschickt. Bitte Posteingang (und Spam-Ordner) prüfen.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 10 }}>
              Gib deine E-Mail-Adresse ein — wir schicken dir einen Link, um ein neues Passwort zu setzen.
            </div>
            <input
              style={{ ...inputStyle, marginBottom: 12 }} type="email" placeholder="E-Mail" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && passwortVergessenSenden()}
            />
            <button onClick={passwortVergessenSenden} disabled={laedt} style={{ ...btnPrimary, width: "100%", opacity: laedt ? 0.6 : 1 }}>
              {laedt ? "…" : "Link zum Zurücksetzen senden"}
            </button>
          </>
        )}
        <button
          onClick={() => { setVergessenModus(false); setVergessenGesendet(false); setFehler(""); onCleanError(); }}
          style={{ border: "none", background: "none", color: COLORS.textMuted, fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 12 }}
        >
          Zurück zur Anmeldung
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>Anmelden</div>
      {fehler && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12, padding: "8px 10px", borderRadius: 7, marginBottom: 10 }}>{fehler}</div>}
      <input
        style={{ ...inputStyle, marginBottom: 8 }} type="email" placeholder="E-Mail" value={email}
        onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        style={{ ...inputStyle, marginBottom: 6 }} type="password" placeholder="Passwort" value={passwort}
        onChange={(e) => setPasswort(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button
        onClick={() => { setVergessenModus(true); setFehler(""); onCleanError(); }}
        style={{ border: "none", background: "none", color: COLORS.accent, fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0, marginBottom: 12, display: "block" }}
      >
        Passwort vergessen?
      </button>
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

function MonthView({ grid, currentDate, baustellenFor, alleMitarbeiter, abwesenheiten, onDayClick, onBaustelleClick }) {
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
          const ds = fmt(date);
          const abwesendeHeute = (abwesenheiten || [])
            .filter((a) => a.beginn <= ds && ds <= a.ende)
            .map((a) => alleMitarbeiter.find((m) => m.id === a.mitarbeiterId))
            .filter(Boolean);
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
                {abwesendeHeute.length > 0 && (
                  <div
                    title={abwesendeHeute.map((m) => m.name).join(", ")}
                    style={{ fontSize: 9.5, color: COLORS.textMuted, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    🏖 {abwesendeHeute.length === 1 ? abwesendeHeute[0].name : `${abwesendeHeute.length} abwesend`}
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

function ResourceView({ dates, mitarbeiter, baustellen, alleMitarbeiter, abwesenheiten, isAdmin, onCellClick, onBaustelleClick }) {
  const today = new Date();
  const rowFor = (person, date) => {
    if (person.id === "__unassigned") {
      return baustellen.filter((b) => isActiveOn(b, date) && !(b.zuweisungen || []).some((z) => isZuweisungAktivAm(z, date)));
    }
    return baustellen.filter((b) => (b.zuweisungen || []).some((z) => z.mitarbeiterId === person.id && isZuweisungAktivAm(z, date)));
  };
  const abwesenheitFuer = (person, date) => {
    if (person.id === "__unassigned" || person.id === "__none") return null;
    const ds = fmt(date);
    // Une absence enregistrée sur le profil public ("Amin") doit aussi
    // apparaître sur son profil privé lié ("Amin 2"), et inversement —
    // c'est la même personne, simplement affiché à deux endroits.
    const verwandteIds = [person.id];
    if (person.privatFuer) verwandteIds.push(person.privatFuer);
    (alleMitarbeiter || []).forEach((m) => { if (m.privatFuer === person.id) verwandteIds.push(m.id); });
    return (abwesenheiten || []).find((a) => verwandteIds.includes(a.mitarbeiterId) && a.beginn <= ds && ds <= a.ende) || null;
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
            const abwesenheit = abwesenheitFuer(person, d);
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
                {abwesenheit && (
                  <div
                    title={abwesenheit.notiz || ""}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: "3px 6px", borderRadius: 4, color: "#fff",
                      background: ABWESENHEIT_FARBE[abwesenheit.typ] || COLORS.textMuted,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {ABWESENHEIT_LABEL[abwesenheit.typ] || abwesenheit.typ}
                  </div>
                )}
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
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{formatAdresse(b)}</span>
                          <a
                            href={mapsRichtungUrl(b)} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Route in Google Maps öffnen"
                            style={{ flexShrink: 0, color: COLORS.accent, display: "flex" }}
                          >
                            <MapIcon size={11} />
                          </a>
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
  const [projektAendernOffen, setProjektAendernOffen] = useState(false);
  const [projektSuche, setProjektSuche] = useState("");
  const [projektDropdownOpen, setProjektDropdownOpen] = useState(false);
  const projektMatches = projektSuche.trim()
    ? alleProjekte.filter((p) => p.titel.toLowerCase().includes(projektSuche.trim().toLowerCase()) || formatProjektNummer(p).toLowerCase().includes(projektSuche.trim().toLowerCase()))
    : alleProjekte;

  const handleSave = () => {
    const projektHatAktivesWochenende = enthaeltWochenende(form.beginn, form.ende) && (form.samstagAktiv || form.sonntagAktiv);
    const zuweisungHatWochenende = form.zuweisungen.some((z) => enthaeltWochenende(z.beginn, z.ende));
    if (projektHatAktivesWochenende || zuweisungHatWochenende) {
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
            projektAendernOffen ? (
              <div style={{ position: "relative" }}>
                <input
                  style={inputStyle} value={form.projektTitelEingabe}
                  autoFocus
                  onChange={(e) => {
                    setForm({ ...form, projektTitelEingabe: e.target.value, projektId: null });
                    setProjektSuche(e.target.value);
                    setProjektDropdownOpen(true);
                  }}
                  onFocus={() => { setProjektSuche(form.projektTitelEingabe); setProjektDropdownOpen(true); }}
                  onBlur={() => setTimeout(() => setProjektDropdownOpen(false), 150)}
                  placeholder="Projekt suchen oder neuen Titel eingeben"
                />
                {form.projektId && (
                  <div style={{ fontSize: 10.5, color: COLORS.brandGreen, fontWeight: 700, marginTop: 4 }}>
                    ✓ Wird mit bestehendem Projekt verknüpft (Kunde wird übernommen)
                  </div>
                )}
                {!form.projektId && form.projektTitelEingabe.trim() && (
                  <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 4 }}>
                    Neues Projekt für {form.kunde || "diesen Kunden"} — wird beim Speichern angelegt.
                  </div>
                )}
                {projektDropdownOpen && projektMatches.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 61,
                    background: "#fff", borderRadius: 10, border: `1px solid ${COLORS.border}`,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 6, maxHeight: 200, overflowY: "auto",
                  }}>
                    {projektMatches.map((p) => (
                      <button
                        key={p.id}
                        onMouseDown={() => {
                          const kunde = alleKunden.find((k) => k.id === p.kundeId);
                          setForm((f) => ({
                            ...f,
                            projektId: p.id,
                            projektTitelEingabe: p.titel,
                            ...(kunde ? { kundeId: kunde.id, kunde: kunde.name, kontaktName: kunde.kontaktName, kontaktTelefon: kunde.kontaktTelefon, strasse: kunde.strasse, plz: kunde.plz, stadt: kunde.stadt } : {}),
                          }));
                          setProjektDropdownOpen(false);
                        }}
                        style={{
                          display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7,
                          border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: COLORS.textDark,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F5F2")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontWeight: 700 }}>{formatProjektNummer(p)} — {p.titel}</div>
                        <div style={{ fontSize: 10.5, color: COLORS.textMuted }}>
                          {alleKunden.find((k) => k.id === p.kundeId)?.name || "—"}
                          {p.status === "abgeschlossen" ? " · Abgeschlossen" : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setProjektAendernOffen(false)}
                  style={{ border: "none", background: "none", color: COLORS.textMuted, fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 6 }}
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              (() => {
                const projekt = alleProjekte.find((p) => p.id === form.projektId);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {projekt ? (
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.textDark }}>
                        {formatProjektNummer(projekt)} — {projekt.titel}
                        {projekt.status === "abgeschlossen" && (
                          <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>Abgeschlossen</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontStyle: "italic" }}>Kein Projekt zugeordnet</div>
                    )}
                    <button
                      onClick={() => { setProjektAendernOffen(true); setProjektSuche(""); }}
                      style={{ border: "none", background: "none", color: COLORS.accent, fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                    >
                      Projekt ändern
                    </button>
                  </div>
                );
              })()
            )
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
        {mapsRichtungUrl(form) && (
          <a
            href={mapsRichtungUrl(form)} target="_blank" rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "9px 0", marginBottom: 14,
              color: COLORS.accent, fontSize: 12.5, fontWeight: 700, textDecoration: "none",
            }}
          >
            <MapIcon size={14} /> Route in Google Maps öffnen
          </a>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Beginn (Termin)" style={{ flex: 1 }}>
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
          <Field label="Ende (Termin)" style={{ flex: 1 }}>
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
          Jeder Mitarbeiter kann einen eigenen Zeitraum haben, aber nur innerhalb der Termindauer.
        </div>
        {enthaeltWochenende(form.beginn, form.ende) && (
          <div style={{ display: "flex", gap: 16, marginTop: -4, marginBottom: 14, background: "#FFF7ED", border: "1px solid #FDE1B8", borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ fontSize: 11, color: "#B45309", fontWeight: 700, flexShrink: 0, alignSelf: "center" }}>
              Zeitraum überbrückt ein Wochenende:
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.textDark, fontWeight: 600 }}>
              <input type="checkbox" checked={form.samstagAktiv} onChange={(e) => setForm({ ...form, samstagAktiv: e.target.checked })} />
              Samstag einschließen
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.textDark, fontWeight: 600 }}>
              <input type="checkbox" checked={form.sonntagAktiv} onChange={(e) => setForm({ ...form, sonntagAktiv: e.target.checked })} />
              Sonntag einschließen
            </label>
          </div>
        )}
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
                    {(z.beginn > form.beginn || z.ende < form.ende) && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 11.5, color: "#B45309", fontWeight: 600, marginBottom: 4 }}>
                          ⚠ Deckt nicht den ganzen Termin ab ({form.beginn} – {form.ende}) — an den übrigen Tagen erscheint {person?.name || "diese Person"} nicht im Kalender.
                        </div>
                        <button
                          onClick={() => { onUpdateZuweisung(z.mitarbeiterId, "beginn", form.beginn); onUpdateZuweisung(z.mitarbeiterId, "ende", form.ende); }}
                          style={{ border: "none", background: "none", color: "#B45309", fontWeight: 700, fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                        >
                          Auf ganzen Termin ausdehnen
                        </button>
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
  const [nachname, setNachname] = useState(person?.nachname || "");
  const [email, setEmail] = useState(person?.email || "");
  const [telefon, setTelefon] = useState(person?.telefon || "");
  const [adresse, setAdresse] = useState(person?.adresse || "");
  const [saved, setSaved] = useState(false);

  if (!person) return null;

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), nachname: nachname.trim(), email: email.trim(), telefon: telefon.trim(), adresse: adresse.trim() });
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

        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Vorname" style={{ flex: 1 }}>
            <input
              style={inputStyle} value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Vorname" disabled={!canEdit}
            />
          </Field>
          <Field label="Nachname" style={{ flex: 1 }}>
            <input
              style={inputStyle} value={nachname}
              onChange={(e) => setNachname(e.target.value)} placeholder="Nachname" disabled={!canEdit}
            />
          </Field>
        </div>
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
                            border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                            color: "#fff",
                            background: status === "aktiv" ? "#B45309" : COLORS.brandGreen,
                          }}
                        >
                          {status === "aktiv" ? "Projekt abschließen" : "Wieder öffnen"}
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

function AnfragenListPage({ anfragen, mitarbeiter, onOpenSidebar, onNew, onEdit, onConvert, error }) {
  const [statusFilter, setStatusFilter] = useState("aktiv"); // aktiv | alle | erledigt

  const sichtbar = anfragen.filter((a) => {
    if (statusFilter === "alle") return true;
    if (statusFilter === "erledigt") return a.status === "erledigt";
    return a.status !== "erledigt";
  });

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <PageHeader onOpenSidebar={onOpenSidebar} title="Anfragen" actionLabel="Neue Anfrage" onAction={onNew} />
      {error && <div style={{ margin: "12px 22px 0", background: "#FDECEA", color: "#B42318", fontSize: 12.5, padding: "8px 12px", borderRadius: 7 }}>{error}</div>}

      <div style={{ padding: "16px 22px 0" }}>
        <div style={{ display: "flex", background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 4, gap: 3, width: "fit-content" }}>
          {[["aktiv", "Aktiv"], ["erledigt", "Erledigt"], ["alle", "Alle"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              style={{
                padding: "9px 16px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700,
                background: statusFilter === v ? COLORS.accent : "transparent",
                color: statusFilter === v ? "#fff" : COLORS.textDark,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 22 }}>
        {sichtbar.length === 0 ? (
          <div style={{ fontSize: 13, color: COLORS.textMuted, fontStyle: "italic" }}>Keine Anfragen.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sichtbar.map((a) => {
              const zugewiesen = mitarbeiter.find((m) => m.id === a.zugewiesenAn);
              return (
                <div
                  key={a.id}
                  onClick={() => onEdit(a)}
                  style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14, cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{a.kunde || a.adresse || "—"}</div>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, flexShrink: 0,
                      color: "#fff", background: ANFRAGE_STATUS_FARBE[a.status] || "#666",
                    }}>
                      {ANFRAGE_STATUS_LABEL[a.status] || a.status}
                    </span>
                  </div>
                  {a.adresse && a.kunde && (
                    <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                      <MapPin size={11} /> {a.adresse}
                    </div>
                  )}
                  {a.beschreibung && <div style={{ fontSize: 13, marginBottom: 4 }}>{a.beschreibung}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11.5, color: COLORS.textMuted }}>
                    {a.kontaktName && <span>{a.kontaktName}</span>}
                    {a.kontaktTelefon && <span>{a.kontaktTelefon}</span>}
                    {zugewiesen && <span>→ {zugewiesen.name}</span>}
                  </div>
                  {a.notiz && <div style={{ fontSize: 11.5, color: COLORS.textMuted, fontStyle: "italic", marginTop: 4 }}>{a.notiz}</div>}
                  {a.status !== "erledigt" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onConvert(a); }}
                      style={{ marginTop: 10, ...btnSecondary, fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <CalendarIcon size={13} /> In Termin umwandeln
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AnfrageModal({ form, setForm, mitarbeiter, onSave, onDelete, onConvert, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{form.id ? "Anfrage bearbeiten" : "Neue Anfrage"}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}><X size={18} /></button>
        </div>

        <Field label="Kunde / Firma">
          <input style={inputStyle} value={form.kunde} onChange={(e) => setForm({ ...form, kunde: e.target.value })} placeholder="z. B. MELTEC" />
        </Field>
        <Field label="Adresse">
          <input style={inputStyle} value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="Straße, PLZ Ort" />
        </Field>
        <Field label="Beschreibung">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} value={form.beschreibung} onChange={(e) => setForm({ ...form, beschreibung: e.target.value })} placeholder="Was wird benötigt?" />
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Kontaktperson" style={{ flex: 1 }}>
            <input style={inputStyle} value={form.kontaktName} onChange={(e) => setForm({ ...form, kontaktName: e.target.value })} />
          </Field>
          <Field label="Telefon" style={{ flex: 1 }}>
            <input style={inputStyle} value={form.kontaktTelefon} onChange={(e) => setForm({ ...form, kontaktTelefon: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Status" style={{ flex: 1 }}>
            <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(ANFRAGE_STATUS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>
          <Field label="Zugewiesen an" style={{ flex: 1 }}>
            <select style={inputStyle} value={form.zugewiesenAn || ""} onChange={(e) => setForm({ ...form, zugewiesenAn: e.target.value || null })}>
              <option value="">—</option>
              {mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notiz">
          <input style={inputStyle} value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} placeholder="z. B. ab Januar, nochmal hin…" />
        </Field>

        {onConvert && (
          <button onClick={onConvert} style={{ ...btnSecondary, width: "100%", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <CalendarIcon size={14} /> In Termin umwandeln
          </button>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ ...btnSecondary, color: "#B42318" }}>
              <Trash2 size={15} />
            </button>
          )}
          <button onClick={() => onSave(form)} style={{ ...btnPrimary, flex: 1 }}>Speichern</button>
        </div>
      </div>
    </div>
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

function RessourcenPage({ baustellen, mitarbeiter, abwesenheiten, stundennachweis, arbeitszeiten, pausen, isAdmin, currentUserId, onOpenSidebar, onBaustelleClick, onAddAbwesenheit, onRemoveAbwesenheit, onSaveStundennachweis, error }) {
  const [modus, setModus] = useState("verfuegbarkeit"); // verfuegbarkeit | stunden | abwesenheiten

  return (
    <>
      <PageHeader onOpenSidebar={onOpenSidebar} title="Ressourcen" />
      {error && <div style={{ background: "#FDECEA", color: "#B42318", fontSize: 12.5, padding: "8px 22px" }}>{error}</div>}

      <div style={{ padding: "16px 22px 0" }}>
        <div style={{ display: "flex", background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 4, gap: 3, width: "fit-content", flexWrap: "wrap" }}>
          {[["verfuegbarkeit", "Verfügbarkeit prüfen"], ["stunden", "Stunden-Übersicht"], ["abwesenheiten", "Abwesenheiten"], ["stundennachweis", "Stundennachweis"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setModus(v)}
              style={{
                padding: "9px 16px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, letterSpacing: "0.01em", transition: "background 0.12s, color 0.12s",
                background: modus === v ? COLORS.accent : "transparent",
                color: modus === v ? "#fff" : COLORS.textDark,
                boxShadow: modus === v ? "0 2px 6px rgba(188,49,63,0.28)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {modus === "verfuegbarkeit" && (
          <VerfuegbarkeitPruefen baustellen={baustellen} mitarbeiter={mitarbeiter} abwesenheiten={abwesenheiten} onBaustelleClick={onBaustelleClick} />
        )}
        {modus === "stunden" && (
          <StundenUebersicht baustellen={baustellen} mitarbeiter={mitarbeiter} abwesenheiten={abwesenheiten} />
        )}
        {modus === "abwesenheiten" && (
          <AbwesenheitenPage
            mitarbeiter={mitarbeiter}
            abwesenheiten={abwesenheiten}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onAdd={onAddAbwesenheit}
            onRemove={onRemoveAbwesenheit}
          />
        )}
        {modus === "stundennachweis" && (
          <StundennachweisPage
            mitarbeiter={mitarbeiter}
            baustellen={baustellen}
            abwesenheiten={abwesenheiten}
            stundennachweis={stundennachweis}
            arbeitszeiten={arbeitszeiten}
            pausen={pausen}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onSave={onSaveStundennachweis}
          />
        )}
      </div>
    </>
  );
}

function VerfuegbarkeitPruefen({ baustellen, mitarbeiter, abwesenheiten, onBaustelleClick }) {
  const heute = fmt(new Date());
  const [von, setVon] = useState(heute);
  const [bis, setBis] = useState(heute);
  const [uhrzeitVon, setUhrzeitVon] = useState("");
  const [uhrzeitBis, setUhrzeitBis] = useState("");
  const [wochenendeEinschliessen, setWochenendeEinschliessen] = useState(true);
  const [geprueft, setGeprueft] = useState(false);

  const ergebnisse = mitarbeiter.map((m) => {
    const konflikte = findeKonflikteFuerVerfuegbarkeit(m.id, von, bis, uhrzeitVon, uhrzeitBis, baustellen, wochenendeEinschliessen);
    const abwesend = findeAbwesenheitenFuerZeitraum(m.id, von, bis, abwesenheiten || []);
    return { mitarbeiter: m, frei: konflikte.length === 0 && abwesend.length === 0, konflikte, abwesend };
  });
  const freie = ergebnisse.filter((e) => e.frei);
  const besetzte = ergebnisse.filter((e) => !e.frei);

  return (
    <div>
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: 16, maxWidth: 560 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <Field label="Von (Datum)" style={{ flex: 1, minWidth: 140 }}>
            <input type="date" style={inputStyle} value={von} onChange={(e) => { setVon(e.target.value); if (e.target.value > bis) setBis(e.target.value); setGeprueft(false); }} />
          </Field>
          <Field label="Bis (Datum)" style={{ flex: 1, minWidth: 140 }}>
            <input type="date" style={inputStyle} value={bis} min={von} onChange={(e) => { setBis(e.target.value); setGeprueft(false); }} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Uhrzeit von (optional)" style={{ flex: 1 }}>
            <input type="time" style={inputStyle} value={uhrzeitVon} onChange={(e) => { setUhrzeitVon(e.target.value); setGeprueft(false); }} />
          </Field>
          <Field label="Uhrzeit bis (optional)" style={{ flex: 1 }}>
            <input type="time" style={inputStyle} value={uhrzeitBis} onChange={(e) => { setUhrzeitBis(e.target.value); setGeprueft(false); }} />
          </Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.textMuted, marginTop: 10, marginBottom: 4 }}>
          <input type="checkbox" checked={wochenendeEinschliessen} onChange={(e) => { setWochenendeEinschliessen(e.target.checked); setGeprueft(false); }} />
          Wochenenden (Sa/So) einbeziehen
        </label>
        <button onClick={() => setGeprueft(true)} style={{ ...btnPrimary, width: "100%", marginTop: 4 }}>
          Verfügbarkeit prüfen
        </button>
      </div>

      {geprueft && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.brandGreen, textTransform: "uppercase", marginBottom: 8 }}>
              ✓ Verfügbar ({freie.length})
            </div>
            {freie.length === 0 ? (
              <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontStyle: "italic" }}>Niemand verfügbar in diesem Zeitraum.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {freie.map(({ mitarbeiter: m }) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#EAF6EF", borderRadius: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B45309", textTransform: "uppercase", marginBottom: 8 }}>
              Nicht verfügbar ({besetzte.length})
            </div>
            {besetzte.length === 0 ? (
              <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontStyle: "italic" }}>Niemand belegt in diesem Zeitraum.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {besetzte.map(({ mitarbeiter: m, konflikte, abwesend }) => (
                  <div key={m.id} style={{ padding: "8px 12px", background: "#FFF7ED", borderRadius: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                    </div>
                    {abwesend.map((a) => (
                      <div key={a.id} style={{ fontSize: 11.5, color: ABWESENHEIT_FARBE[a.typ] || COLORS.textMuted, fontWeight: 700, paddingLeft: 17 }}>
                        → {ABWESENHEIT_LABEL[a.typ] || a.typ} ({a.beginn}{a.beginn !== a.ende ? ` – ${a.ende}` : ""}){a.notiz ? ` — ${a.notiz}` : ""}
                      </div>
                    ))}
                    {konflikte.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => onBaustelleClick(b)}
                        style={{ fontSize: 11.5, color: COLORS.textMuted, cursor: "pointer", paddingLeft: 17 }}
                      >
                        → {b.kunde} ({b.beginn}{b.beginn !== b.ende ? ` – ${b.ende}` : ""}{formatZeitraum(b) ? `, ${formatZeitraum(b)}` : ""})
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StundenUebersicht({ baustellen, mitarbeiter, abwesenheiten }) {
  const [zeitraum, setZeitraum] = useState("woche"); // tag | woche | monat
  const [anker, setAnker] = useState(new Date());
  const [wochenendeEinschliessen, setWochenendeEinschliessen] = useState(true);

  const { beginn, ende } = periodenGrenzen(zeitraum, anker);
  const anzahlTage = alleTageZwischen(beginn, ende).filter((t) => wochenendeEinschliessen || !istWochenendtag(t)).length;

  const gehePrev = () => setAnker((d) => (zeitraum === "tag" ? addDays(d, -1) : zeitraum === "woche" ? addDays(d, -7) : new Date(d.getFullYear(), d.getMonth() - 1, 1)));
  const geheNext = () => setAnker((d) => (zeitraum === "tag" ? addDays(d, 1) : zeitraum === "woche" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1)));

  const label = zeitraum === "tag"
    ? anker.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    : `${beginn} – ${ende}`;

  const zeilen = mitarbeiter.map((m) => {
    const { kapazitaet, abwesendeTage } = kapazitaetFuerMitarbeiter(m.id, beginn, ende, abwesenheiten, wochenendeEinschliessen);
    const gebucht = stundenGebuchtFuerPeriode(m.id, beginn, ende, baustellen, wochenendeEinschliessen);
    const verfuegbar = kapazitaet - gebucht;
    const auslastungProzent = kapazitaet > 0 ? Math.min(100, Math.round((gebucht / kapazitaet) * 100)) : 0;
    return { mitarbeiter: m, kapazitaet, gebucht, verfuegbar, auslastungProzent, abwesendeTage };
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: COLORS.bgMain, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setZeitraum(v)}
              style={{
                padding: "7px 13px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12.5, fontWeight: 700,
                background: zeitraum === v ? COLORS.card : "transparent",
                color: zeitraum === v ? COLORS.textDark : COLORS.textMuted,
                boxShadow: zeitraum === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={gehePrev} style={navBtnStyle}><ChevronLeft size={16} /></button>
          <div style={{ fontSize: 13, fontWeight: 700, minWidth: 160, textAlign: "center", textTransform: "capitalize" }}>{label}</div>
          <button onClick={geheNext} style={navBtnStyle}><ChevronRight size={16} /></button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.textMuted }}>
          <input type="checkbox" checked={wochenendeEinschliessen} onChange={(e) => setWochenendeEinschliessen(e.target.checked)} />
          Wochenenden einbeziehen
        </label>
      </div>

      <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 12 }}>
        Angenommene Tageskapazität: {STANDARD_TAGESKAPAZITAET} Std./Tag, {anzahlTage} Tag{anzahlTage !== 1 ? "e" : ""} im Zeitraum. Termine ohne Uhrzeitangabe zählen als ganzer Tag. Tage mit eingetragener Abwesenheit zählen nicht zur Kapazität.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {zeilen.map(({ mitarbeiter: m, kapazitaet, gebucht, verfuegbar, auslastungProzent, abwesendeTage }) => (
          <div key={m.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.farbe, flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: verfuegbar < 0 ? "#B42318" : COLORS.brandGreen }}>
                {verfuegbar < 0 ? `${verfuegbar} Std. überbucht` : `${verfuegbar} Std. verfügbar`}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: "#F0EFEA", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${auslastungProzent}%`, borderRadius: 4,
                background: auslastungProzent >= 100 ? "#B42318" : auslastungProzent >= 75 ? "#B45309" : COLORS.brandGreen,
              }} />
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
              {gebucht} von {kapazitaet} Std. gebucht ({auslastungProzent}%)
              {abwesendeTage > 0 && ` · ${abwesendeTage} Tag${abwesendeTage !== 1 ? "e" : ""} abwesend`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Bouton "Arbeit beginnen" intelligent : si l'heure actuelle est encore
// raisonnable, demande de confirmer/ajuster l'heure de début réelle (au
// cas où le login a lieu après le début effectif du travail). Si la
// journée est déjà bien avancée (>= TAG_SPAETER_SCHWELLE), propose
// directement de saisir début ET fin plutôt que de "commencer maintenant".
function SmartBeginnControl({ onBeginn, onNachtragHeute, gross }) {
  const jetzt = new Date().toTimeString().slice(0, 5);
  const istSpaet = jetzt >= TAG_SPAETER_SCHWELLE;
  const [modus, setModus] = useState(null); // null | "confirm" | "nachtrag"
  const [zeit, setZeit] = useState(jetzt);
  const [nachtragBeginn, setNachtragBeginn] = useState(ARBEITSTAG_START);
  const [nachtragEnde, setNachtragEnde] = useState(jetzt);
  const [laedt, setLaedt] = useState(false);

  const pad = gross ? "20px 0" : "9px 0";
  const fontSize = gross ? 18 : 13;
  const radius = gross ? 14 : 8;
  const iconSize = gross ? 22 : 14;

  const btnStyle = (bg) => ({
    display: "flex", alignItems: "center", justifyContent: "center", gap: gross ? 10 : 7, width: "100%",
    background: bg, color: "#fff", border: "none", borderRadius: radius, padding: pad,
    fontSize, fontWeight: gross ? 800 : 700, cursor: "pointer", opacity: laedt ? 0.6 : 1,
  });
  const boxStyle = { background: gross ? "#F6F5F2" : "#2A3038", borderRadius: radius, padding: gross ? 18 : 10 };
  const labelStyle = { fontSize: gross ? 14 : 11, color: gross ? COLORS.textMuted : COLORS.textLightMuted, marginBottom: gross ? 12 : 7 };
  const inputStyle2 = { ...inputStyle, flex: 1 };

  if (modus === "confirm") {
    return (
      <div style={boxStyle}>
        <div style={labelStyle}>Wann hast du tatsächlich begonnen?</div>
        <input type="time" value={zeit} onChange={(e) => setZeit(e.target.value)} style={{ ...inputStyle2, width: "100%", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setModus(null)} style={{ ...btnStyle("#4A5568"), flex: 1 }}>Abbrechen</button>
          <button
            onClick={async () => { setLaedt(true); await onBeginn(zeit); setLaedt(false); }}
            disabled={laedt} style={{ ...btnStyle(COLORS.brandGreen), flex: 1.4 }}
          >
            Bestätigen
          </button>
        </div>
      </div>
    );
  }

  if (modus === "nachtrag") {
    return (
      <div style={boxStyle}>
        <div style={labelStyle}>Es ist bereits {jetzt} — trag die heutige Arbeitszeit direkt ein:</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input type="time" value={nachtragBeginn} onChange={(e) => setNachtragBeginn(e.target.value)} style={inputStyle2} />
          <input type="time" value={nachtragEnde} onChange={(e) => setNachtragEnde(e.target.value)} style={inputStyle2} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setModus(null)} style={{ ...btnStyle("#4A5568"), flex: 1 }}>Abbrechen</button>
          <button
            onClick={async () => { setLaedt(true); await onNachtragHeute(nachtragBeginn, nachtragEnde); setLaedt(false); }}
            disabled={laedt} style={{ ...btnStyle(COLORS.accent), flex: 1.4 }}
          >
            Speichern
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => (istSpaet ? setModus("nachtrag") : (setZeit(jetzt), setModus("confirm")))}
      style={btnStyle(COLORS.brandGreen)}
    >
      <Clock size={iconSize} /> Arbeit beginnen
    </button>
  );
}

function PointeuseSeite({ me, baustellen, arbeitszeiten, pausen, vorwocheOffeneTage, onOpenSidebar, onBeginn, onEnde, onPauseBeginnen, onPauseBeenden, onNachtragenOeffnen, onNachtragHeute, onBaustelleClick }) {
  const [laedt, setLaedt] = useState(false);
  const heute = fmt(new Date());
  const heutigeZeit = (arbeitszeiten || []).find((a) => a.mitarbeiterId === me.id && a.datum === heute);
  const heutigePausen = (pausen || []).filter((p) => p.mitarbeiterId === me.id && p.datum === heute);
  const offenePause = heutigePausen.find((p) => !p.ende);
  const gesamtPauseMin = heutigePausen.reduce((s, p) => {
    if (!p.beginn || !p.ende) return s;
    const [bh, bm] = p.beginn.split(":").map(Number);
    const [eh, em] = p.ende.split(":").map(Number);
    return s + Math.max(0, eh * 60 + em - (bh * 60 + bm));
  }, 0);
  const heutigeTermine = (baustellen || [])
    .filter((b) => (b.zuweisungen || []).some((z) => z.mitarbeiterId === me.id && isZuweisungAktivAm(z, new Date())))
    .sort((a, b) => (a.startzeit || "").localeCompare(b.startzeit || ""));

  const klick = async (fn) => {
    setLaedt(true);
    await fn();
    setLaedt(false);
  };

  const grossBtn = (bg) => ({
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%",
    background: bg, color: "#fff", border: "none", borderRadius: 14, padding: "20px 0",
    fontSize: 18, fontWeight: 800, cursor: "pointer", opacity: laedt ? 0.6 : 1,
  });

  let inhalt;
  if (vorwocheOffeneTage && vorwocheOffeneTage.length > 0 && !heutigeZeit?.beginn) {
    inhalt = (
      <div style={{ background: "#FDECEA", border: "1px solid #F3C7C0", borderRadius: 14, padding: 22, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#B42318", marginBottom: 6 }}>Vorwoche nicht dokumentiert</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
          Bitte zuerst die fehlenden Tage der letzten Woche nachtragen, bevor die neue Woche beginnen kann.
        </div>
        <button onClick={onNachtragenOeffnen} style={grossBtn(COLORS.accent)}>Jetzt nachtragen</button>
      </div>
    );
  } else if (!heutigeZeit?.beginn) {
    inhalt = <SmartBeginnControl onBeginn={onBeginn} onNachtragHeute={onNachtragHeute} gross />;
  } else if (!heutigeZeit.ende) {
    if (offenePause) {
      inhalt = (
        <div style={{ background: "#F6F5F2", borderRadius: 14, padding: 22, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 14 }}>
            ⏸ Pause seit <strong>{offenePause.beginn}</strong>{offenePause.motiv ? ` (${offenePause.motiv})` : ""}
          </div>
          <button onClick={() => klick(() => onPauseBeenden(offenePause.id))} disabled={laedt} style={grossBtn(COLORS.brandGreen)}>
            <Clock size={22} /> Pause beenden
          </button>
        </div>
      );
    } else {
      inhalt = (
        <div style={{ background: "#F6F5F2", borderRadius: 14, padding: 22, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 14 }}>
            🟢 Im Dienst seit <strong>{heutigeZeit.beginn}</strong>
            {gesamtPauseMin > 0 && ` · ${gesamtPauseMin} Min. Pause bisher`}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => klick(() => onPauseBeginnen(""))} disabled={laedt} style={{ ...grossBtn("#4A5568"), flex: 1 }}>
              Pause
            </button>
            <button onClick={() => klick(onEnde)} disabled={laedt} style={{ ...grossBtn(COLORS.accent), flex: 1.4 }}>
              <Clock size={22} /> Beenden
            </button>
          </div>
        </div>
      );
    }
  } else {
    inhalt = (
      <div style={{ background: "#F0F7F0", border: `1px solid ${hexToRgba(COLORS.brandGreen, 0.3)}`, borderRadius: 14, padding: 22, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Heute erledigt</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>
          {heutigeZeit.beginn} – {heutigeZeit.ende}{gesamtPauseMin > 0 && ` (${gesamtPauseMin} Min. Pause)`}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", background: COLORS.bgMain }}>
      <div className="app-topbar" style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 22px", display: "flex", alignItems: "center", gap: 14 }}>
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
        <div style={{ fontSize: 18, fontWeight: 800 }}>Hallo, {me.name}</div>
      </div>
      <div style={{ padding: 22, maxWidth: 480, margin: "0 auto" }}>
        {inhalt}

        {heutigeTermine.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 8 }}>
              Heute geplant
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {heutigeTermine.map((b) => (
                <div
                  key={b.id}
                  onClick={() => onBaustelleClick(b)}
                  style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12, cursor: "pointer" }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{b.kunde}</div>
                  {formatAdresse(b) && (
                    <div style={{ fontSize: 11.5, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                      <MapPin size={10} /> {formatAdresse(b)}
                    </div>
                  )}
                  {b.startzeit && b.endzeit && (
                    <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 2 }}>{b.startzeit} – {b.endzeit}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StempeluhrWidget({ mitarbeiterId, arbeitszeiten, pausen, vorwocheOffeneTage, onBeginn, onEnde, onPauseBeginnen, onPauseBeenden, onNachtragenOeffnen, onNachtragHeute }) {
  const [laedt, setLaedt] = useState(false);
  const heute = fmt(new Date());
  const heutigeZeit = arbeitszeiten.find((a) => a.mitarbeiterId === mitarbeiterId && a.datum === heute);
  const heutigePausen = pausen.filter((p) => p.mitarbeiterId === mitarbeiterId && p.datum === heute);
  const offenePause = heutigePausen.find((p) => !p.ende);
  const gesamtPauseMin = heutigePausen.reduce((s, p) => {
    if (!p.beginn || !p.ende) return s;
    const [bh, bm] = p.beginn.split(":").map(Number);
    const [eh, em] = p.ende.split(":").map(Number);
    return s + Math.max(0, eh * 60 + em - (bh * 60 + bm));
  }, 0);

  const klick = async (fn) => {
    setLaedt(true);
    await fn();
    setLaedt(false);
  };

  const btnStyle = (bg) => ({
    display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%",
    background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "9px 0",
    fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: laedt ? 0.6 : 1,
  });

  // Une nouvelle journée démarre toujours librement — sauf si une semaine
  // PRÉCÉDENTE (déjà terminée) n'a pas été entièrement documentée : dans ce
  // cas, "Arbeit beginnen" reste bloqué jusqu'à régularisation.
  if (!heutigeZeit?.beginn) {
    if (vorwocheOffeneTage && vorwocheOffeneTage.length > 0) {
      return (
        <div style={{ background: "#3A2018", border: "1px solid #7A3A2A", borderRadius: 8, padding: "9px 10px" }}>
          <div style={{ fontSize: 11, color: "#F0A07E", fontWeight: 700, marginBottom: 5 }}>
            🔒 Vorwoche nicht dokumentiert
          </div>
          <div style={{ fontSize: 10.5, color: COLORS.textLightMuted, marginBottom: 7 }}>
            Bitte zuerst die fehlenden Tage der letzten Woche nachtragen, bevor die neue Woche beginnen kann.
          </div>
          <button onClick={onNachtragenOeffnen} style={{ ...btnStyle(COLORS.accent) }}>
            Jetzt nachtragen
          </button>
        </div>
      );
    }
    return <SmartBeginnControl onBeginn={onBeginn} onNachtragHeute={onNachtragHeute} />;
  }

  if (!heutigeZeit.ende) {
    if (offenePause) {
      return (
        <div style={{ background: "#2A3038", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: COLORS.textLightMuted, marginBottom: 6 }}>
            ⏸ Pause seit {offenePause.beginn}{offenePause.motiv ? ` (${offenePause.motiv})` : ""}
          </div>
          <button onClick={() => klick(() => onPauseBeenden(offenePause.id))} disabled={laedt} style={btnStyle(COLORS.brandGreen)}>
            <Clock size={14} /> Pause beenden
          </button>
        </div>
      );
    }
    return (
      <div style={{ background: "#2A3038", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 11, color: COLORS.textLightMuted, marginBottom: 6 }}>
          🟢 Im Dienst seit {heutigeZeit.beginn}
          {gesamtPauseMin > 0 && ` · ${gesamtPauseMin} Min. Pause bisher`}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => klick(() => onPauseBeginnen(""))} disabled={laedt} style={{ ...btnStyle("#4A5568"), flex: 1 }}>
            Pause
          </button>
          <button onClick={() => klick(onEnde)} disabled={laedt} style={{ ...btnStyle(COLORS.accent), flex: 1.4 }}>
            <Clock size={14} /> Beenden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#2A3038", borderRadius: 8, padding: "9px 10px", fontSize: 11.5, color: COLORS.textLightMuted, textAlign: "center" }}>
      ✓ Heute: {heutigeZeit.beginn} – {heutigeZeit.ende}
      {gesamtPauseMin > 0 && ` (${gesamtPauseMin} Min. Pause)`}
    </div>
  );
}

function ArbeitszeitNachtragenModal({ tage, onSave, onClose }) {
  const [werte, setWerte] = useState(() =>
    Object.fromEntries(tage.map((t) => [t.datum, { beginn: "", ende: "", nichtGearbeitet: false }]))
  );
  const [speichertGerade, setSpeichertGerade] = useState(false);

  const update = (datum, fields) => setWerte((w) => ({ ...w, [datum]: { ...w[datum], ...fields } }));

  const alleAusgefuellt = tage.every((t) => {
    const v = werte[t.datum];
    return v.nichtGearbeitet || (v.beginn && v.ende);
  });

  const speichern = async () => {
    setSpeichertGerade(true);
    for (const t of tage) {
      const v = werte[t.datum];
      if (v.nichtGearbeitet) continue;
      await onSave(t.datum, v.beginn, v.ende);
    }
    setSpeichertGerade(false);
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 480 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>⏱ Vergessene Zeiterfassung</div>
        <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 16 }}>
          An folgenden Tagen gab es Termine, aber keine vollständige Zeiterfassung. Bitte kurz nachtragen:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18, maxHeight: 360, overflowY: "auto" }}>
          {tage.map((t) => {
            const v = werte[t.datum];
            return (
              <div key={t.datum} style={{ background: "#F6F5F2", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{formatDatumDE(t.datum)}</div>
                <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 8 }}>
                  {[...new Set(t.kunden)].join(", ")}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
                  <input type="checkbox" checked={v.nichtGearbeitet} onChange={(e) => update(t.datum, { nichtGearbeitet: e.target.checked })} />
                  Nicht gearbeitet an diesem Tag
                </label>
                {!v.nichtGearbeitet && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="time" value={v.beginn} onChange={(e) => update(t.datum, { beginn: e.target.value })} style={{ ...inputStyle, flex: 1 }} placeholder="Beginn" />
                    <input type="time" value={v.ende} onChange={(e) => update(t.datum, { ende: e.target.value })} style={{ ...inputStyle, flex: 1 }} placeholder="Ende" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={btnSecondary}>Später</button>
          <button onClick={speichern} disabled={!alleAusgefuellt || speichertGerade} style={{ ...btnPrimary, flex: 1, opacity: alleAusgefuellt ? 1 : 0.5 }}>
            {speichertGerade ? "…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AbwesenheitenPage({ mitarbeiter, abwesenheiten, isAdmin, currentUserId, onAdd, onRemove }) {
  const heute = fmt(new Date());
  const [formOffen, setFormOffen] = useState(false);
  const [mitarbeiterId, setMitarbeiterId] = useState(isAdmin ? "" : currentUserId || "");
  const [typ, setTyp] = useState("urlaub");
  const [beginn, setBeginn] = useState(heute);
  const [ende, setEnde] = useState(heute);
  const [notiz, setNotiz] = useState("");

  const sichtbare = (isAdmin ? mitarbeiter : mitarbeiter.filter((m) => m.id === currentUserId));
  const eintraege = abwesenheiten
    .filter((a) => isAdmin || a.mitarbeiterId === currentUserId)
    .sort((a, b) => (a.beginn < b.beginn ? 1 : -1));

  const submit = () => {
    if (!mitarbeiterId || !beginn || !ende) return;
    onAdd({ mitarbeiterId, typ, beginn, ende, notiz });
    setFormOffen(false);
    setNotiz("");
  };

  const TYP_FARBE = ABWESENHEIT_FARBE;

  return (
    <div style={{ maxWidth: 640 }}>
      {!formOffen ? (
        <button onClick={() => setFormOffen(true)} style={{ ...btnPrimary, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Abwesenheit eintragen
        </button>
      ) : (
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          {isAdmin && (
            <Field label="Mitarbeiter">
              <select style={inputStyle} value={mitarbeiterId} onChange={(e) => setMitarbeiterId(e.target.value)}>
                <option value="">Auswählen…</option>
                {sichtbare.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Grund">
            <div style={{ display: "flex", gap: 8 }}>
              {[["urlaub", "Urlaub"], ["krankheit", "Krankheit"], ["fortbildung", "Fortbildung"]].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setTyp(v)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                    border: `1.5px solid ${typ === v ? TYP_FARBE[v] : COLORS.border}`,
                    background: typ === v ? TYP_FARBE[v] : "#fff",
                    color: typ === v ? "#fff" : COLORS.textMuted,
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Von" style={{ flex: 1 }}>
              <input type="date" style={inputStyle} value={beginn} onChange={(e) => { setBeginn(e.target.value); if (e.target.value > ende) setEnde(e.target.value); }} />
            </Field>
            <Field label="Bis" style={{ flex: 1 }}>
              <input type="date" style={inputStyle} value={ende} min={beginn} onChange={(e) => setEnde(e.target.value)} />
            </Field>
          </div>
          <Field label="Notiz (optional)">
            <input style={inputStyle} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Grund, Vertretung, …" />
          </Field>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => setFormOffen(false)} style={btnSecondary}>Abbrechen</button>
            <button onClick={submit} disabled={!mitarbeiterId} style={{ ...btnPrimary, flex: 1, opacity: mitarbeiterId ? 1 : 0.5 }}>Speichern</button>
          </div>
        </div>
      )}

      {eintraege.length === 0 ? (
        <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 13.5, padding: 40 }}>
          Noch keine Abwesenheiten eingetragen.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {eintraege.map((a) => {
            const person = mitarbeiter.find((m) => m.id === a.mitarbeiterId);
            const vorbei = a.ende < heute;
            return (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", gap: 12, background: COLORS.card,
                border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 14px", opacity: vorbei ? 0.55 : 1,
              }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: person?.farbe, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{person?.name || "?"}</div>
                  {a.notiz && <div style={{ fontSize: 11.5, color: COLORS.textMuted }}>{a.notiz}</div>}
                </div>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, textTransform: "uppercase",
                  background: hexToRgba(TYP_FARBE[a.typ] || COLORS.textMuted, 0.12), color: TYP_FARBE[a.typ] || COLORS.textMuted,
                }}>
                  {ABWESENHEIT_LABEL[a.typ] || a.typ}
                </div>
                <div style={{ fontSize: 12, color: COLORS.textMuted, minWidth: 130, textAlign: "right" }}>
                  {a.beginn}{a.beginn !== a.ende ? ` – ${a.ende}` : ""}
                </div>
                {(isAdmin || a.mitarbeiterId === currentUserId) && (
                  <button onClick={() => onRemove(a.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted, flexShrink: 0 }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StundennachweisPage({ mitarbeiter, baustellen, abwesenheiten, stundennachweis, arbeitszeiten, pausen, isAdmin, currentUserId, onSave }) {
  const heute = new Date();
  const [mitarbeiterId, setMitarbeiterId] = useState(isAdmin ? (mitarbeiter[0]?.id || "") : currentUserId || "");
  const [jahr, setJahr] = useState(heute.getFullYear());
  const [monat, setMonat] = useState(heute.getMonth()); // 0-11
  const [eintraege, setEintraege] = useState([]); // [{ id, datum, kunde, leistung, stunden }] — SEULE source éditable
  const [aufzeichnungsDaten, setAufzeichnungsDaten] = useState({}); // { "YYYY-MM-DD": "YYYY-MM-DD" }
  const [arbeitgeber, setArbeitgeber] = useState("Elektro Schmidtke GmbH");
  const [arbeitnehmer, setArbeitnehmer] = useState("");
  const [geladenAus, setGeladenAus] = useState(null); // "gespeichert" | "kalender" | null
  const [speichertGerade, setSpeichertGerade] = useState(false);
  const [gespeichertHinweis, setGespeichertHinweis] = useState(false);

  const sichtbareMitarbeiter = isAdmin ? mitarbeiter : mitarbeiter.filter((m) => m.id === currentUserId);

  const berechneAusKalender = () => {
    if (!mitarbeiterId) return;
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    const neu = [];
    let n = 0;
    for (const ds of alleTageZwischen(monatBeginn, monatEnde)) {
      const roh = eintraegeFuerTag(mitarbeiterId, ds, baustellen);
      if (roh.length === 0) continue;

      // Priorité aux vraies heures pointées (Stempeluhr) si elles existent
      // pour ce jour : elles définissent le total net réel, réparti entre
      // les tâches du jour (au prorata de leurs propres heures si connues,
      // sinon également).
      const echtePointage = (arbeitszeiten || []).find((a) => a.mitarbeiterId === mitarbeiterId && a.datum === ds && a.beginn && a.ende);
      if (echtePointage) {
        const [bh, bm] = echtePointage.beginn.split(":").map(Number);
        const [eh, em] = echtePointage.ende.split(":").map(Number);
        const pausenDesTages = (pausen || []).filter((p) => p.mitarbeiterId === mitarbeiterId && p.datum === ds && p.beginn && p.ende);
        const echtePauseMin = pausenDesTages.reduce((s, p) => {
          const [ph, pm] = p.beginn.split(":").map(Number);
          const [qh, qm] = p.ende.split(":").map(Number);
          return s + Math.max(0, qh * 60 + qm - (ph * 60 + pm));
        }, 0);
        const pauseStd = pausenDesTages.length > 0 ? echtePauseMin / 60 : 1; // pause réelle si connue, sinon 60 min par défaut
        let totalNet = eh + em / 60 - (bh + bm / 60) - pauseStd;
        if (totalNet < 0) totalNet = 0;
        const mitZeiten = roh.filter((e) => e.startzeit && e.endzeit);
        const poids = mitZeiten.length === roh.length && roh.length > 0
          ? roh.map((e) => {
              const [sh, sm] = e.startzeit.split(":").map(Number);
              const [eh2, em2] = e.endzeit.split(":").map(Number);
              return Math.max(0.01, eh2 + em2 / 60 - (sh + sm / 60));
            })
          : roh.map(() => 1);
        const poidsTotal = poids.reduce((s, p) => s + p, 0) || 1;
        roh.forEach((e, i) => {
          const stunden = Math.round(totalNet * (poids[i] / poidsTotal) * 4) / 4;
          neu.push({ id: `auto-${n++}`, datum: ds, kunde: e.kunde, leistung: e.leistung, stunden });
        });
        continue;
      }

      const mitZeiten = roh.filter((e) => e.startzeit && e.endzeit);
      if (mitZeiten.length === 0) {
        // Aucune heure précisée sur aucune tâche du jour : on suppose une
        // journée standard déjà NETTE (pause déjà exclue), répartie entre
        // les tâches — pas de déduction supplémentaire ici.
        const proTache = Math.round((STANDARD_TAGESKAPAZITAET / roh.length) * 4) / 4;
        roh.forEach((e) => neu.push({ id: `auto-${n++}`, datum: ds, kunde: e.kunde, leistung: e.leistung, stunden: proTache }));
      } else {
        // Au moins une tâche a des heures précises : la pause déjeuner (1h)
        // n'est pas payée — déduite une seule fois du total brut du jour,
        // répartie proportionnellement entre les tâches concernées.
        const rohParTache = mitZeiten.map((e) => {
          const [sh, sm] = e.startzeit.split(":").map(Number);
          const [eh, em] = e.endzeit.split(":").map(Number);
          return Math.max(0, eh + em / 60 - (sh + sm / 60));
        });
        const rohTotal = rohParTache.reduce((s, h) => s + h, 0);
        const pauseAbzug = Math.min(1, rohTotal);
        mitZeiten.forEach((e, i) => {
          const anteil = rohTotal > 0 ? rohParTache[i] / rohTotal : 0;
          const stunden = Math.max(0, rohParTache[i] - pauseAbzug * anteil);
          neu.push({ id: `auto-${n++}`, datum: ds, kunde: e.kunde, leistung: e.leistung, stunden: Math.round(stunden * 4) / 4 });
        });
        // Tâches du même jour sans heure précisée : durée inconnue, laissée à 0 (comme avant).
        roh.filter((e) => !(e.startzeit && e.endzeit)).forEach((e) => {
          neu.push({ id: `auto-${n++}`, datum: ds, kunde: e.kunde, leistung: e.leistung, stunden: 0 });
        });
      }
    }
    setEintraege(neu);
    setAufzeichnungsDaten({});
    setGeladenAus("kalender");
  };

  const ladeGespeichertOderBerechne = () => {
    if (!mitarbeiterId) return;
    const p = mitarbeiter.find((m) => m.id === mitarbeiterId);
    setArbeitnehmer(p ? (p.nachname ? `${p.nachname}, ${p.name}` : p.name) : "");
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    const gespeicherte = (stundennachweis || []).filter((e) => e.mitarbeiterId === mitarbeiterId && e.datum >= monatBeginn && e.datum <= monatEnde);
    if (gespeicherte.length > 0) {
      setEintraege(gespeicherte.map((e) => ({ id: e.id, datum: e.datum, kunde: e.kunde, leistung: e.leistung, stunden: e.stunden })));
      const daten = {};
      gespeicherte.forEach((e) => { if (e.aufzeichnungsDatum && !daten[e.datum]) daten[e.datum] = e.aufzeichnungsDatum; });
      setAufzeichnungsDaten(daten);
      setGeladenAus("gespeichert");
    } else {
      berechneAusKalender();
    }
  };

  useEffect(() => {
    ladeGespeichertOderBerechne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiterId, jahr, monat]);

  const speichern = async () => {
    if (!mitarbeiterId) return;
    setSpeichertGerade(true);
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    const mitAufzeichnung = eintraege.map((e) => ({ ...e, aufzeichnungsDatum: aufzeichnungsDaten[e.datum] || "" }));
    const ok = await onSave(mitarbeiterId, monatBeginn, monatEnde, mitAufzeichnung);
    setSpeichertGerade(false);
    if (ok) {
      setGeladenAus("gespeichert");
      setGespeichertHinweis(true);
      setTimeout(() => setGespeichertHinweis(false), 2000);
    }
  };

  const monatLabel = new Date(jahr, monat, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const konfirmiertWechsel = () => {
    if (eintraege.length === 0 || geladenAus === "gespeichert") return true;
    return window.confirm("Nicht gespeicherte Änderungen im Wochendetail gehen dabei verloren. Trotzdem wechseln?");
  };
  const gehePrev = () => { if (!konfirmiertWechsel()) return; const d = new Date(jahr, monat - 1, 1); setJahr(d.getFullYear()); setMonat(d.getMonth()); };
  const geheNext = () => { if (!konfirmiertWechsel()) return; const d = new Date(jahr, monat + 1, 1); setJahr(d.getFullYear()); setMonat(d.getMonth()); };

  const updateEintrag = (id, fields) => { setEintraege((e) => e.map((x) => (x.id === id ? { ...x, ...fields } : x))); setGeladenAus((g) => (g === "gespeichert" ? "bearbeitet" : g)); };
  const removeEintrag = (id) => { setEintraege((e) => e.filter((x) => x.id !== id)); setGeladenAus((g) => (g === "gespeichert" ? "bearbeitet" : g)); };
  const addEintrag = (datum) => { setEintraege((e) => [...e, { id: `neu-${Date.now()}-${Math.random()}`, datum, kunde: "", leistung: "", stunden: 0 }]); setGeladenAus((g) => (g === "gespeichert" ? "bearbeitet" : g)); };

  // --- Regroupement par semaine pour l'affichage/édition (source unique) ---
  const wochenGruppen = (() => {
    const gruppen = new Map(); // KW -> { tage: Map(datum -> [eintraege]) }
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    for (const ds of alleTageZwischen(monatBeginn, monatEnde)) {
      const kw = getWeekNumber(new Date(ds + "T00:00:00"));
      if (!gruppen.has(kw)) gruppen.set(kw, new Map());
      gruppen.get(kw).set(ds, eintraege.filter((e) => e.datum === ds));
    }
    return Array.from(gruppen.entries()).sort((a, b) => a[0] - b[0]);
  })();

  // --- Vue mensuelle : entièrement DÉRIVÉE du détail hebdomadaire, jamais éditée séparément ---
  const tage = (() => {
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    return alleTageZwischen(monatBeginn, monatEnde).map((ds) => {
      const eintraegeTag = eintraege.filter((e) => e.datum === ds && Number(e.stunden) > 0);
      const dauerStd = Math.round(eintraegeTag.reduce((s, e) => s + (Number(e.stunden) || 0), 0) * 4) / 4;
      const abwesenheit = (abwesenheiten || []).find((a) => a.mitarbeiterId === mitarbeiterId && a.beginn <= ds && ds <= a.ende);
      if (dauerStd <= 0) {
        return { datum: ds, arbeitstag: false, beginn: "", ende: "", pauseMin: 0, dauerStd: 0, abwesenheit };
      }
      const pauseMin = 60;
      const beginnDez = 8; // 08:00 fixe
      const endeDez = beginnDez + pauseMin / 60 + dauerStd;
      const eh = Math.floor(endeDez);
      const em = Math.round((endeDez - eh) * 60);
      const ende = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
      return { datum: ds, arbeitstag: true, beginn: ARBEITSTAG_START, ende, pauseMin, dauerStd, abwesenheit: null };
    });
  })();
  const summe = Math.round(tage.reduce((s, t) => s + (t.dauerStd || 0), 0) * 4) / 4;

  const alleAufzeichnungsdatenSetzen = () => {
    const heuteStr = fmt(new Date());
    const neu = {};
    tage.forEach((t) => { if (t.arbeitstag) neu[t.datum] = heuteStr; });
    setAufzeichnungsDaten(neu);
    setGeladenAus((g) => (g === "gespeichert" ? "bearbeitet" : g));
  };

  const excelExportieren = async () => {
    const XLSX = await import("xlsx");
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    const heuteStr = formatDatumDE(fmt(new Date()));
    const zeilen = [];

    zeilen.push([`Stundennachweis — ${arbeitnehmer || "Mitarbeiter"}`]);
    zeilen.push([`Mitarbeiter: ${arbeitnehmer || "—"}`]);
    zeilen.push([`Zeitraum: ${formatDatumDE(monatBeginn)} – ${formatDatumDE(monatEnde)}`]);
    zeilen.push([`Erstellt am: ${heuteStr}`]);
    zeilen.push([]);

    wochenGruppen.forEach(([kw, tageMap]) => {
      const wochenTage = Array.from(tageMap.entries());
      const wochensumme = Math.round(wochenTage.reduce((s, [, z]) => s + z.reduce((ss, zz) => ss + (Number(zz.stunden) || 0), 0), 0) * 4) / 4;
      zeilen.push([`KW-${String(kw).padStart(2, "0")}`, "", "", `${wochensumme} Std.`]);
      zeilen.push(["Datum", "Kunde", "Leistung", "Std.H."]);
      wochenTage.forEach(([ds, zeilenTag]) => {
        if (zeilenTag.length === 0) {
          zeilen.push([formatDatumDE(ds), "—", "", ""]);
        } else {
          zeilenTag.forEach((z, i) => {
            zeilen.push([i === 0 ? formatDatumDE(ds) : "", z.kunde, z.leistung, Number(z.stunden) || 0]);
          });
        }
      });
      zeilen.push([]);
    });

    zeilen.push(["", "", "Gesamt:", `${summe} Std.`]);

    const ws = XLSX.utils.aoa_to_sheet(zeilen);
    ws["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 40 }, { wch: 12 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stundennachweis");
    const dateiname = `Wochendetail_${(arbeitnehmer || "Mitarbeiter").replace(/[,\s]+/g, "_")}_${jahr}-${String(monat + 1).padStart(2, "0")}.xlsx`;
    XLSX.writeFile(wb, dateiname);
  };

  const pdfErstellen = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 15;
    let y = 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Aufzeichnung der Arbeitszeiten gemäß § 17 Mindestlohngesetz", marginX, y);
    y += 8;

    doc.setFontSize(9);
    doc.text("Wichtiger Hinweis:", marginX, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    const hinweis = "Die Aufzeichnungen müssen spätestens mit Ablauf des 7. Kalendertages erstellt werden, der auf den Tag der Arbeitsleistung folgt. Sie sind 2 Jahre lang aufzubewahren, beginnend ab dem Tag, den für die Aufzeichnung maßgeblichen Zeitpunkt.";
    const hinweisZeilen = doc.splitTextToSize(hinweis, 180);
    doc.text(hinweisZeilen, marginX, y);
    y += hinweisZeilen.length * 4 + 5;

    doc.text(`Bezeichnung des Arbeitgebers: ${arbeitgeber}`, marginX, y); y += 5;
    doc.text(`Name, Vorname des Arbeitnehmers: ${arbeitnehmer}`, marginX, y); y += 5;
    const monatBeginn = fmt(new Date(jahr, monat, 1));
    const monatEnde = fmt(new Date(jahr, monat + 1, 0));
    doc.text(`Aufzeichnung für die Zeit vom: ${formatDatumDE(monatBeginn)} bis zum ${formatDatumDE(monatEnde)}`, marginX, y);
    y += 7;

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Datum der\nArbeitsleistung", "Uhrzeit Beginn\nder Arbeitsleistung", "Uhrzeit Ende\nder Arbeitsleistung", "Pause\nin Min.", "Dauer der\nArbeitsleistung (Std.)", "Datum der\nAufzeichnung"]],
      body: tage.map((t) => t.arbeitstag
        ? [formatDatumDE(t.datum), t.beginn, t.ende, String(t.pauseMin), String(t.dauerStd), formatDatumDE(aufzeichnungsDaten[t.datum] || "")]
        : [formatDatumDE(t.datum), "----------", "----------", "", "", ""]
      ),
      styles: { fontSize: 8, cellPadding: 1.6, halign: "center" },
      headStyles: { fillColor: [230, 228, 222], textColor: 20, fontStyle: "bold", fontSize: 7.5 },
      columnStyles: { 0: { halign: "left" } },
      theme: "grid",
    });

    let finalY = doc.lastAutoTable.finalY + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Summe: Std. ${summe}`, marginX, finalY);

    finalY += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.line(marginX, finalY, marginX + 70, finalY);
    doc.line(marginX + 95, finalY, marginX + 165, finalY);
    finalY += 4;
    doc.text("(Datum/Unterschrift Arbeitnehmer)", marginX, finalY);
    doc.text("(Datum/Unterschrift Arbeitgeber)", marginX + 95, finalY);

    const dateiname = `Stundennachweis_${(arbeitnehmer || "Mitarbeiter").replace(/[,\s]+/g, "_")}_${jahr}-${String(monat + 1).padStart(2, "0")}.pdf`;
    doc.save(dateiname);
  };

  if (!mitarbeiterId) {
    return <div style={{ fontSize: 13, color: COLORS.textMuted }}>Kein Mitarbeiter verfügbar.</div>;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        {isAdmin && (
          <Field label="Mitarbeiter" style={{ minWidth: 180 }}>
            <select
              style={inputStyle} value={mitarbeiterId}
              onChange={(e) => { if (!konfirmiertWechsel()) return; setMitarbeiterId(e.target.value); }}
            >
              {sichtbareMitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={gehePrev} style={navBtnStyle}><ChevronLeft size={16} /></button>
          <div style={{ fontSize: 13, fontWeight: 700, minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{monatLabel}</div>
          <button onClick={geheNext} style={navBtnStyle}><ChevronRight size={16} /></button>
        </div>
        <button
          onClick={() => {
            if (eintraege.length === 0 || geladenAus === "gespeichert" || window.confirm("Nicht gespeicherte Änderungen im Wochendetail gehen dabei verloren. Wirklich neu aus dem Kalender berechnen?")) {
              berechneAusKalender();
            }
          }}
          style={{ ...btnSecondary, fontSize: 12 }}
        >
          Neu aus Kalender berechnen
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: geladenAus === "gespeichert" ? COLORS.brandGreen : "#B45309", fontWeight: 700 }}>
          {gespeichertHinweis ? "✓ Gespeichert" : geladenAus === "gespeichert" ? "Gespeicherter Stand" : eintraege.length > 0 ? "● Nicht gespeichert" : ""}
        </div>
        <button onClick={speichern} disabled={speichertGerade || !mitarbeiterId} style={{ ...btnPrimary, fontSize: 12.5, opacity: speichertGerade ? 0.6 : 1 }}>
          {speichertGerade ? "…" : "Speichern"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Field label="Bezeichnung des Arbeitgebers" style={{ flex: 1, minWidth: 220 }}>
          <input style={inputStyle} value={arbeitgeber} onChange={(e) => setArbeitgeber(e.target.value)} />
        </Field>
        <Field label="Name, Vorname des Arbeitnehmers" style={{ flex: 1, minWidth: 220 }}>
          <input style={inputStyle} value={arbeitnehmer} onChange={(e) => setArbeitnehmer(e.target.value)} placeholder="Nachname, Vorname" />
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Wochendetail (wie bisherige Excel-Liste)</div>
        <button onClick={excelExportieren} style={{ ...btnSecondary, fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
          <Download size={13} /> Als Excel exportieren
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 8 }}>
        Hier korrigieren — die Monatsübersicht unten wird automatisch daraus berechnet.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {wochenGruppen.map(([kw, tageMap]) => {
          const wochenTage = Array.from(tageMap.entries());
          const wochensumme = Math.round(wochenTage.reduce((s, [, zeilen]) => s + zeilen.reduce((ss, z) => ss + (Number(z.stunden) || 0), 0), 0) * 4) / 4;
          return (
            <div key={kw} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", background: "#FAFAF9", borderBottom: `1px solid ${COLORS.border}`, fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                <span>KW-{String(kw).padStart(2, "0")}</span>
                <span>{wochensumme} Std.</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "82px 1fr 1.4fr 56px 28px", gap: 0, padding: "6px 12px", fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>
                <div>Datum</div>
                <div>Kunde</div>
                <div>Leistung</div>
                <div>Std.H.</div>
                <div></div>
              </div>
              {wochenTage.map(([ds, zeilen]) => (
                <div key={ds}>
                  {zeilen.length === 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "82px 1fr 28px", gap: 0, padding: "3px 12px", fontSize: 11.5, borderTop: `1px solid ${COLORS.borderSoft}`, alignItems: "center" }}>
                      <div style={{ color: COLORS.textMuted }}>{formatDatumDE(ds)}</div>
                      <div style={{ color: COLORS.textMuted, fontStyle: "italic" }}>—</div>
                      <button onClick={() => addEintrag(ds)} title="Eintrag hinzufügen" style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.accent }}>
                        <Plus size={14} />
                      </button>
                    </div>
                  ) : (
                    zeilen.map((z, i) => (
                      <div key={z.id} style={{ display: "grid", gridTemplateColumns: "82px 1fr 1.4fr 56px 28px", gap: 4, padding: "3px 12px", fontSize: 12, borderTop: `1px solid ${COLORS.borderSoft}`, alignItems: "center" }}>
                        <div style={{ color: COLORS.textMuted }}>{i === 0 ? formatDatumDE(ds) : ""}</div>
                        <input value={z.kunde} onChange={(e) => updateEintrag(z.id, { kunde: e.target.value })} style={{ ...inputStyle, padding: "3px 5px", fontSize: 11.5 }} placeholder="Kunde" />
                        <input value={z.leistung} onChange={(e) => updateEintrag(z.id, { leistung: e.target.value })} style={{ ...inputStyle, padding: "3px 5px", fontSize: 11.5 }} placeholder="Leistung" />
                        <input type="number" step="0.25" min="0" value={z.stunden} onChange={(e) => updateEintrag(z.id, { stunden: e.target.value })} style={{ ...inputStyle, padding: "3px 5px", fontSize: 11.5, width: 50 }} />
                        <div style={{ display: "flex", gap: 2 }}>
                          <button onClick={() => removeEintrag(z.id)} title="Löschen" style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.textMuted }}>
                            <Trash2 size={13} />
                          </button>
                          {i === zeilen.length - 1 && (
                            <button onClick={() => addEintrag(ds)} title="Weiterer Eintrag" style={{ border: "none", background: "transparent", cursor: "pointer", color: COLORS.accent }}>
                              <Plus size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Monatsübersicht (berechnet, für das PDF)</div>
        <button onClick={alleAufzeichnungsdatenSetzen} style={{ ...btnSecondary, fontSize: 11.5 }}>
          "Datum der Aufzeichnung" überall auf heute setzen
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 8 }}>
        Beginn (08:00 fix), Pause (60 Min. fix) und Ende werden automatisch aus der Summe des Wochendetails berechnet — hier nicht mehr einzeln editierbar, damit die Monatssumme immer exakt zum Wochendetail passt.
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 60px 60px 60px 60px 100px", gap: 0, background: "#FAFAF9", borderBottom: `1px solid ${COLORS.border}`, padding: "7px 10px", fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>
          <div>Datum</div>
          <div>Beginn</div>
          <div>Ende</div>
          <div>Pause</div>
          <div>Dauer</div>
          <div>Aufzeichnung</div>
        </div>
        {tage.map((t) => {
          const istWochenende = istWochenendtag(t.datum);
          return (
            <div key={t.datum} style={{
              display: "grid", gridTemplateColumns: "90px 60px 60px 60px 60px 100px", gap: 0, alignItems: "center",
              padding: "5px 10px", borderBottom: `1px solid ${COLORS.borderSoft}`, fontSize: 12.5,
              background: istWochenende ? hexToRgba(COLORS.accent, 0.03) : "transparent",
            }}>
              <div style={{ fontWeight: 600 }}>{formatDatumDE(t.datum)}</div>
              {t.arbeitstag ? (
                <>
                  <div>{t.beginn}</div>
                  <div>{t.ende}</div>
                  <div>{t.pauseMin}</div>
                  <div style={{ fontWeight: 700 }}>{t.dauerStd} Std.</div>
                  <input
                    type="date" value={aufzeichnungsDaten[t.datum] || ""}
                    onChange={(e) => { setAufzeichnungsDaten((d) => ({ ...d, [t.datum]: e.target.value })); setGeladenAus((g) => (g === "gespeichert" ? "bearbeitet" : g)); }}
                    style={{ ...inputStyle, padding: "3px 4px", fontSize: 10.5 }}
                  />
                </>
              ) : (
                <div style={{ gridColumn: "span 5", color: COLORS.textMuted, fontStyle: "italic", fontSize: 11.5 }}>
                  {t.abwesenheit ? `${ABWESENHEIT_LABEL[t.abwesenheit.typ] || t.abwesenheit.typ} — kein Arbeitstag` : "kein Arbeitstag"}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "flex-end", fontSize: 13.5, fontWeight: 800 }}>
          Summe: {summe} Std.
        </div>
      </div>

      <button onClick={pdfErstellen} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 7 }}>
        <FileText size={16} /> PDF erstellen
      </button>
    </div>
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
