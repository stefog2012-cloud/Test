# DXF Gewichtsrechner

Web-App (PWA), die auf **Windows, Android und iPhone/iPad** läuft. Sie berechnet aus
einem Ordner mit DXF-Dateien die Fläche jedes Bauteils, daraus das Gewicht und am Ende
Gesamtgewicht, Verschnitt und Kosten.

## Funktionen

- **Ordner wählen** (Windows/Android) oder **Dateien wählen** (iPhone/iPad), alternativ Drag & Drop.
- **ZIP-Dateien** (z. B. per WhatsApp verschickte Aufträge) werden direkt geöffnet und entpackt.
  Auftragsname = Ordner im ZIP bzw. ZIP-Dateiname. Ein neues ZIP ersetzt die bisherige Liste.
- **Android:** Die installierte App erscheint im Teilen-Menü. In WhatsApp die ZIP-Datei antippen/gedrückt halten →
  *Teilen* → **DXF Gewicht**. Die App öffnet sich und rechnet sofort.
  **iPhone:** ZIP in WhatsApp öffnen → Teilen → *In Dateien sichern*, dann in der App „Dateien / ZIP wählen“.
- Liest aus dem Dateinamen **Stückzahl, Position und Materialstärke**:
  `5x_Pos_123_10mm.dxf` → 5 Stück, Pos. 123, 10 mm
  (auch `2,5mm`, `Pos_7a`, `5stk` usw.). Fehlende Werte können in der Tabelle ergänzt werden.
- Wertet **nur Layer 0** aus (in den Einstellungen änderbar), alle anderen Layer werden ignoriert.
- Außenkontur minus Innenkonturen (Bohrungen, Ausschnitte) = Netto-Fläche.
  Unterstützt LINE, ARC, CIRCLE, LWPOLYLINE/POLYLINE (inkl. Bögen), ELLIPSE, SPLINE und Blöcke (INSERT).
  Linien und Bögen werden automatisch zu geschlossenen Konturen verbunden, doppelte Konturen entfernt.
- **Auftragsname** wird aus dem Ordnernamen übernommen (änderbar) und erscheint im Ausdruck und im CSV-Dateinamen.
- **Bohrungen und Langlöcher** werden automatisch erkannt, egal ob als Kreis, aus Bögen/Linien oder als Polylinie
  gezeichnet. Rechteckige oder sonstige Ausschnitte zählen nicht dazu. Anzahl je Stück ist in der Tabelle änderbar.
  Im Vorschaubild sind Bohrungen grün und Langlöcher orange markiert.
- **Aufpreis je Bohrung** und **je Langloch** frei eingebbar; im Gesamtpreis werden Anzahl und Kosten einzeln aufgeführt.
- **Zusatzkosten je Auftrag:** Kantungen (Anzahl × Preis) und Datenaufbereitung (€), im Gesamtpreis einzeln aufgeführt.
  Preis je Kantung und Datenaufbereitung werden gespeichert, Anzahl Kantungen und Notiz gelten nur für den aktuellen Auftrag.
- **Notiz:** einzeiliges Freitextfeld, erscheint in PDF, Ausdruck und CSV.
- **Briefkopf** mit Firmenlogo und Adresse in PDF und Ausdruck (Daten in `firma.js`, Original-Logo in `firma/logo.jpg`).
- **Zusammenfassung nach Materialstärke** (Stück, Fläche, Gewicht, Gewicht inkl. Verschnitt).
- **Flächenberechnung wählbar:** *kleinstes umschließendes Rechteck* (Standard) oder *Netto-Kontur* (Außenkontur minus Löcher)
  (auch schräg liegend, Löcher nicht abgezogen, deckt einen Teil des Verschnitts ab). Das Rechteck wird im
  Vorschaubild rot gestrichelt angezeigt. Die Spalte „Abmessung“ zeigt immer Länge × Breite dieses Rechtecks.
- Gewicht = Fläche × Stärke × spezifisches Gewicht (Materialauswahl oder eigener Wert in kg/dm³).
- Tabelle aller Positionen mit Vorschaubild, Summe unten.
- **Verschnitt in %** und **Kosten in €/kg oder €/t** frei eingebbar.
- **PDF speichern**: erzeugt ein fertiges PDF (A4 quer) mit Vorschaubildern, Zusammenfassung und Gesamtpreis.
  Am iPhone/iPad öffnet sich das Teilen-Menü („In Dateien sichern“), sonst wird die Datei heruntergeladen.
- Export als **CSV (Excel)** und **Drucken**.
- Einstellungen werden gespeichert, Berechnung erfolgt komplett lokal (keine Daten verlassen das Gerät).

## Benutzung

### Windows (ohne Installation)
`index.html` im Ordner doppelklicken → öffnet sich in Edge/Chrome. Fertig.

### Als App installieren (Windows, Android, iPhone)
Die App muss einmal über **https** erreichbar sein, z. B. über GitHub Pages:

1. Im Repository: *Settings → Pages → Branch* auswählen → *Save*.
2. Die angezeigte Adresse öffnen:
   - **Android (Chrome):** Menü ⋮ → *App installieren* / *Zum Startbildschirm hinzufügen*
   - **iPhone/iPad (Safari):** Teilen-Symbol → *Zum Home-Bildschirm*
   - **Windows (Edge/Chrome):** Installieren-Symbol in der Adressleiste
3. Danach funktioniert die App auch offline.

Alternativ kann der Ordner auf jeden anderen Webserver kopiert werden (z. B. Netlify Drop).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `app.js` | Tabelle, Berechnung, Export |
| `dxf.js` | DXF-Parser und Flächenberechnung |
| `lib/` | fflate (ZIP), jsPDF und jsPDF-AutoTable (alle MIT-Lizenz) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline-Fähigkeit / Installation |

## Hinweise

- Nur ASCII-DXF (Standard). Binäre DXF bitte im CAD als ASCII speichern.
- Einheit wird aus der DXF gelesen (`$INSUNITS`), Standard mm.
- Bögen werden mit max. 0,001 mm Abweichung angenähert → Flächenfehler praktisch null.
- Warnungen in der Tabelle: offene (nicht geschlossene) Konturen, mehrere Außenkonturen,
  fehlende Stückzahl im Dateinamen.
