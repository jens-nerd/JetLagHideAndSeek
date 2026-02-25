/**
 * Deutsche Tutorial-Schritte für TutorialDialog.
 * Als JSX gespeichert, damit Rich-Content (Links, Formatierung) möglich ist.
 */
import type { ReactNode } from "react";

import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "@/components/QuestionCards";
import { SidebarGroup, SidebarMenu } from "@/components/ui/sidebar-l";

export interface TutorialStep {
    title: string;
    content: ReactNode;
    targetSelector?: string;
    position?: "top" | "bottom" | "center";
    isDescription?: boolean;
}

export const tutorialStepsDe: TutorialStep[] = [
    {
        title: "Willkommen beim Jet Lag Hide and Seek Map Generator!",
        content: (
            <>
                Willkommen beim Hide-and-Seek-Kartengenerator für das Jet Lag
                Home Game! Dieses ausführliche Tutorial führt dich durch alle
                Funktionen, Optionen und Fragetypen dieses leistungsstarken
                Werkzeugs.
                <br />
                <br />
                Dieses Tool richtet sich an alle, die das Jet Lag Hide and Seek
                Home Game gekauft haben – es ist jedoch nicht offiziell mit den
                Entwicklern verbunden. Es unterstützt über 48 Fragenvariationen
                aus dem Spiel!
                <br />
                <br />
                Falls du die Grundlagen bereits kennst, kannst du{" "}
                <strong>das Tutorial überspringen, indem du nach unten scrollst</strong>.
                Dieses Tutorial behandelt jedoch auch fortgeschrittene Funktionen,
                die du vielleicht noch nicht kennst. Um dieses kostenlose Tool zu
                unterstützen, erwäge bitte,{" "}
                <a
                    href="https://github.com/taibeled/JetLagHideAndSeek"
                    className="text-blue-500 cursor-pointer"
                    target="_blank"
                    rel="noreferrer"
                >
                    das Repository auf GitHub mit einem Stern zu versehen
                </a>{" "}
                oder es mit anderen Jet-Lag-Fans zu teilen! Beides sind kostenlose
                Möglichkeiten, deine Unterstützung zu zeigen.
            </>
        ),
        position: "center",
    },
    {
        title: "Überblick: Spielaufbau-Prozess",
        content: (
            <>
                Bevor wir ins Detail gehen, hier der typische Ablauf:
                <br />
                <br />
                <strong>1. Standort einrichten:</strong> Definiere dein Spielgebiet
                anhand von Voreinstellungen oder benutzerdefiniertem Zeichnen von
                Polygonen
                <br />
                <br />
                <strong>2. Fragen erstellen:</strong> Füge die 5 Fragetypen hinzu
                und konfiguriere sie (Radius, Thermometer, Tentakel, Matching,
                Messen)
                <br />
                <br />
                <strong>3. Teilen:</strong> Teile die Fragen und Spielgrenzen mit
                anderen Spielern
                <br />
                <br />
                <strong>4. Verstecker-Modus:</strong> Lass den Verstecker Fragen
                automatisch basierend auf seinem Standort beantworten
                <br />
                <br />
                <strong>5. Zonen-Analyse:</strong> Zeige potenzielle Versteckzonen
                und ihre Einschränkungen an
                <br />
                <br />
                Lass uns jeden Schritt im Detail erkunden!
            </>
        ),
        position: "center",
    },
    {
        title: "Standort einrichten: Ortsauswahl",
        content: (
            <>
                Die Ortsauswahl ermöglicht es dir, das Spielgebiet anhand von
                Voreinstellungen zu definieren. Klicke auf das Suchfeld, um Orte
                zu erkunden.
                <br />
                <br />
                <strong>Unterstützte Ortstypen:</strong>
                <br />• Städte, Ortschaften und Stadtteile
                <br />• Verwaltungsregionen (Länder, Bundesstaaten, Präfekturen)
                <br />• Geografische Merkmale (Inseln, Parks)
            </>
        ),
        targetSelector: '[data-tutorial-id="place-picker"]',
        position: "bottom",
    },
    {
        title: "Standortverwaltung: Hinzufügen, Abziehen, Entfernen",
        content: (
            <>
                Sobald du nach Orten gesucht hast, zeigt dieses Menü leistungsstarke
                Verwaltungsoptionen:
                <br />
                <br />
                <strong>Orte hinzufügen (+ Schaltfläche):</strong> Erweitert dein
                Spielgebiet durch Einbeziehung der ausgewählten Region
                <br />
                <br />
                <strong>Orte abziehen (- Schaltfläche):</strong> Erstellt
                &ldquo;Löcher&rdquo; in deinem Spielgebiet durch Ausschluss
                bestimmter Regionen. Ideal zum Entfernen von Gewässern,
                gesperrten Bereichen oder zum Erstellen komplexer Grenzen.
                <br />
                <br />
                <strong>Orte entfernen (X Schaltfläche):</strong> Entfernt den Ort
                vollständig aus deinem Spiel
                <br />
                <br />
                <strong>
                    Schaltfläche &ldquo;Fragen &amp; Cache löschen&rdquo;:
                </strong>{" "}
                Setzt alle Fragen zurück und löscht gecachte Daten, wenn du
                Standorte wesentlich änderst
                <br />
                <br />
                <strong>
                    Schaltfläche &ldquo;Voreingestellte Orte wiederverwenden&rdquo;:
                </strong>{" "}
                Erscheint, wenn benutzerdefinierte Polygone vorhanden sind, und
                ermöglicht die Rückkehr zum Voreinstellungs-Modus
            </>
        ),
        targetSelector: '[data-tutorial-id="place-picker-content"]',
        position: "bottom",
    },
    {
        title: "Erweiterter Standort-Setup: Benutzerdefiniertes Polygon zeichnen",
        content: (
            <>
                Für benutzerdefinierte Spielbereiche ermöglicht das Polygon-Werkzeug
                das Zeichnen von:
                <br />
                <br />
                <strong>Polygon-Werkzeug:</strong> Zeichne benutzerdefinierte
                Grenzen, die genau zu deinem geplanten Spielbereich passen.
                Ideal für unregelmäßige Formen oder wenn voreingestellte Standorte
                nicht ganz passen.
                <br />
                <br />
                <strong>Zeichen-Tipps:</strong>
                <br />• Klicken zum Starten, weiterklicken zum Hinzufügen von Punkten
                <br />• Erneut auf den ersten Punkt klicken, um das Polygon zu schließen
                <br />• Mehrere Polygone für komplexe Bereiche verwenden
                <br />
                <br />
                <strong>Anwendungsfälle:</strong> Universitätscampusse, bestimmte
                Stadtteile, benutzerdefinierte Spielgrenzen oder Bereiche, die
                mehrere Verwaltungsregionen umfassen.
            </>
        ),
        targetSelector: ".leaflet-draw-draw-polygon",
        position: "top",
    },
    {
        title: "Fragen-Seitenleiste öffnen",
        content: (
            <>
                Fragen können auf zwei Arten hinzugefügt werden: über die Seitenleiste
                oder auf der Karte. Um die Seitenleiste zu öffnen, musst du auf die
                hervorgehobene Schaltfläche klicken oder zum nächsten Schritt
                fortfahren. Außerdem kannst du eine Frage auf der Karte hinzufügen,
                indem du auf dem Desktop rechtsklickst oder auf Mobilgeräten lang
                drückst. Eine Frage wird am angeklickten Ort hinzugefügt, und du
                kannst dann den Fragetyp auswählen.
            </>
        ),
        targetSelector: '[data-tutorial-id="left-sidebar-trigger"]',
        position: "bottom",
    },
    {
        title: "Frageerstellungs-Oberfläche (Teil 1)",
        content: (
            <>
                Diese Seitenleiste ist dein Fragen-Steuerzentrum. Jede Schaltfläche
                erstellt einen anderen Fragetyp. Fahre mit dem nächsten Schritt
                fort, um mehr über jeden Fragetyp im Detail zu erfahren.
            </>
        ),
        targetSelector: '[data-tutorial-id="add-questions-buttons"]',
        position: "top",
    },
    {
        title: "Frageerstellungs-Oberfläche (Teil 2)",
        content: (
            <>
                Hier sind die Beispielfragen:
                <br />
                <br />
                <strong>1. RADIUS:</strong> &ldquo;Ist der Verstecker innerhalb
                von X Distanz von diesem Punkt?&rdquo;
                <br />
                <br />
                <strong>2. THERMOMETER:</strong> &ldquo;Ist der Verstecker näher
                an Punkt A oder Punkt B?&rdquo;
                <br />
                <br />
                <strong>3. TENTAKEL:</strong> &ldquo;Welcher spezifische Ort
                innerhalb von X Distanz der Sucher ist dem Verstecker am
                nächsten?&rdquo;
                <br />
                <br />
                <strong>4. MATCHING:</strong> &ldquo;Hat der Verstecker dieselbe
                Eigenschaft wie dieser Referenzpunkt?&rdquo;
                <br />
                <br />
                <strong>5. MESSEN:</strong> &ldquo;Ist der Verstecker näher/
                weiter als der Sucher von diesem Merkmal entfernt?&rdquo;
                <br />
                <br />
                Außerdem gibt es folgende zusätzliche Schaltflächen:
                <br />
                <br />
                <strong>&ldquo;Frage einfügen&rdquo;:</strong> Funktion zum
                Importieren von Fragen aus der Zwischenablage (JSON-Format)
                <br />
                <br />
                <strong>Schaltfläche &ldquo;Speichern&rdquo;:</strong> Erscheint,
                wenn die automatische Speicherung deaktiviert ist, für manuelle
                Speicherungen
            </>
        ),
        position: "center",
    },
    {
        title: "Radius-Fragen: Die Grundlage",
        content: (
            <>
                Radius-Fragen sind der einfachste Fragetyp. Hier ist eine
                Beispiel-Frageoberfläche:
                <br />
                <br />
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <RadiusQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                lat: 35.6762,
                                lng: 139.6503,
                                radius: 10,
                                unit: "miles",
                                color: "blue",
                                within: false,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Radius-Steuerung:</strong> Beliebige Distanz einstellen
                (unterstützt Dezimalzahlen)
                <br />
                <br />
                <strong>Einheiten:</strong> Meilen, Kilometer oder Meter
                <br />
                <br />
                <strong>Position:</strong> Marker auf der Karte verschieben oder
                genaue Koordinaten eingeben. Alternativ kannst du deinen aktuellen
                Standort verwenden oder einen Ort einfügen
                <br />
                <br />
                <strong>Innen/Außen:</strong> Umschalten, ob der Verstecker
                innerhalb oder außerhalb des Radius ist
                <br />
                <br />
                <strong>Sperren/Entsperren:</strong> Verhindert versehentliche
                Änderungen bei gesperrtem Zustand
            </>
        ),
        isDescription: false,
        position: "center",
    },
    {
        title: "Thermometer-Fragen: Relative Positionierung",
        content: (
            <>
                Thermometer-Fragen teilen die Karte in zwei Bereiche auf – beide
                enthalten alle Punkte, die näher am jeweiligen Start- oder Endpunkt
                sind:
                <br />
                <br />
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <ThermometerQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                latA: 35.6762,
                                lngA: 139.6503,
                                latB: 35.6762,
                                lngB: 139.7503,
                                colorA: "red",
                                colorB: "blue",
                                warmer: false,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Zwei-Punkt-System:</strong> Punkt A (der Startpunkt) und
                Punkt B (der Endpunkt), jeweils mit unabhängigen Koordinaten und
                Farben
                <br />
                <br />
                <strong>&ldquo;Wärmer&rdquo;-Logik:</strong>
                <br />• Wärmer = Verstecker ist näher an Punkt B (dem Endpunkt)
                <br />• Kälter = Verstecker ist näher an Punkt A (dem Startpunkt)
                <br />
                <br />
                <strong>Koordinateneingabe:</strong> Genaue Standorte einstellen
                oder Marker visuell verschieben
                <br />
                <br />
                <strong>Farbcodierung:</strong> Verschiedene Farben helfen dabei,
                die Punkte auf der Karte zu unterscheiden
            </>
        ),
        position: "center",
    },
    {
        title: "Tentakel-Fragen: Standortentdeckung",
        content: (
            <>
                Tentakel-Fragen identifizieren bestimmte Orte innerhalb eines Radius –
                ideal zum Eingrenzen genauer Verstecke:
                <br />
                <br />
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <TentacleQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                lat: 35.6762,
                                lng: 139.6503,
                                radius: 15,
                                unit: "miles",
                                color: "red",
                                locationType: "theme_park",
                                location: false,
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Standorttypen:</strong>
                <br />• <strong>25-km-Radius:</strong> Freizeitparks, Zoos, Aquarien
                <br />• <strong>1,5-km-Radius:</strong> Museen, Krankenhäuser, Kinos,
                Bibliotheken
                <br />• <strong>Benutzerdefiniert:</strong> Eigene Points of Interest
                definieren
                <br />
                <br />
                <strong>Radius-Steuerung:</strong> Passt den Suchbereich zum Finden
                von Standorten an
                <br />
                <br />
                <strong>Intelligente Erkennung:</strong> Findet automatisch alle
                geeigneten Standorte im Radius mithilfe von OpenStreetMap-Daten
                <br />
                <br />
                <strong>Benutzerdefinierter Modus:</strong> Zeichenmodus aktivieren,
                um Standortpunkte manuell zu platzieren oder zu bearbeiten
            </>
        ),
        position: "center",
    },
    {
        title: "Matching-Fragen: Eigenschaftsvergleich (Teil 1)",
        content: (
            <>
                Matching-Fragen vergleichen Eigenschaften zwischen dem Standort des
                Versteckers und einem Referenzpunkt. Dies ist der komplexeste
                Fragetyp mit zahlreichen Variationen:
                <br />
                <br />
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <MatchingQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                lat: 35.6762,
                                lng: 139.6503,
                                color: "blue",
                                same: true,
                                type: "airport",
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Zonenbasiertes Matching:</strong>
                <br />• <strong>Gleiche Zone:</strong> Verwaltungsregionen
                (Präfekturen, Bundesstaaten usw.)
                <br />• <strong>Gleicher Anfangsbuchstabe der Zone:</strong> Zonen
                mit dem gleichen Anfangsbuchstaben
                <br />• <strong>Zonen-Ebenen:</strong> OSM-Verwaltungsebenen 3–10
                für unterschiedliche Granularitäten
                <br />
                <br />
                <strong>Flughafen-Matching:</strong>
                <br />• Vergleicht die nächstgelegenen kommerziellen Flughäfen
                (mit IATA-Codes)
                <br />• Verwendet Voronoi-Diagramme zur Bestimmung von
                Flughafen-Einzugsgebieten
                <br />
                <br />
                <strong>Städte-Matching:</strong>
                <br />• Vergleicht die nächstgelegenen Großstädte (über 1.000.000
                Einwohner)
                <br />• Nützlich für geografische Fragen in großem Maßstab
            </>
        ),
        position: "center",
    },
    {
        title: "Matching-Fragen: Eigenschaftsvergleich (Teil 2)",
        content: (
            <>
                <strong>Vollspiel-Variationen (Kleine/Mittlere Spiele):</strong>
                <br />
                Diese erfordern ein relativ kleines Spielgebiet (Alternativen
                gibt es auch für den Versteckzonen-Modus bei größeren Spielen):
                <br />• Aquarien, Zoos, Freizeitparks
                <br />• Berge, Museen, Krankenhäuser, Kinos
                <br />• Bibliotheken, Golfplätze, ausländische Konsulate, Parks
                <br />
                <br />
                <strong>Versteckzonen-Modus-Variationen:</strong>
                <br />
                Diese funktionieren speziell mit Bahnhofsdaten:
                <br />• <strong>Gleicher Anfangsbuchstabe des Bahnhofs:</strong>{" "}
                Bahnhofsnamen mit dem gleichen Anfangsbuchstaben
                <br />• <strong>Gleiche Namenslänge des Bahnhofs:</strong>{" "}
                Bahnhofsnamen mit identischer Zeichenanzahl
                <br />• <strong>Gleiche Bahnlinie:</strong> Durch Bahnlinien
                verbundene Bahnhöfe
                <br />
                <br />
                <strong>Benutzerdefiniertes Matching:</strong>
                <br />• <strong>Benutzerdefinierte Zone:</strong> Eigene Zonen zum
                Vergleich zeichnen
                <br />• <strong>Benutzerdefinierte Punkte:</strong> Eigene
                Punktkategorien definieren
            </>
        ),
        position: "center",
    },
    {
        title: "Mess-Fragen: Distanzvergleich (Teil 1)",
        content: (
            <>
                Mess-Fragen vergleichen die Entfernung des Versteckers zu Merkmalen
                mit der des Suchers:
                <br />
                <br />
                <SidebarGroup className="text-foreground">
                    <SidebarMenu>
                        <MeasuringQuestionComponent
                            questionKey={Math.random()}
                            data={{
                                collapsed: false,
                                drag: true,
                                lat: 35.6762,
                                lng: 139.6503,
                                color: "green",
                                hiderCloser: true,
                                type: "coastline",
                            }}
                        />
                    </SidebarMenu>
                </SidebarGroup>
                <br />
                <strong>Geografische Merkmale:</strong>
                <br />• <strong>Küste:</strong> Entfernung zur nächsten Küste mit
                detaillierten Küstendaten
                <br />• <strong>Kommerzielle Flughäfen:</strong> Entfernung zum
                nächsten Flughafen mit IATA-Code
                <br />• <strong>Großstädte:</strong> Entfernung zu Städten mit
                über 1 Mio. Einwohnern
                <br />• <strong>Hochgeschwindigkeitsbahn:</strong> Entfernung zu
                Hochgeschwindigkeitsstrecken (wie Shinkansen)
                <br />
                <br />
                <strong>Vollspiel-Variationen:</strong>
                <br />
                Dieselben Standorttypen wie bei Matching-Fragen, jedoch auf
                Distanz statt Kategorisierung fokussiert:
                <br />• Aquarien, Zoos, Freizeitparks, Berge,
                <br />• Museen, Krankenhäuser, Kinos, Bibliotheken
                <br />• Golfplätze, ausländische Konsulate, Parks
                <br />
                <br />
                <strong>Näher/Weiter-Logik:</strong> Umschalten, ob der Verstecker
                näher oder weiter war als der Sucher
            </>
        ),
        position: "center",
    },
    {
        title: "Mess-Fragen: Distanzvergleich (Teil 2)",
        content: (
            <>
                <strong>Versteckzonen-Modus-Variationen:</strong>
                <br />
                Diese funktionieren mit dem Zonenanalysesystem:
                <br />• <strong>McDonald&apos;s:</strong> Entfernung zum nächsten
                McDonald&apos;s
                <br />• <strong>7-Eleven:</strong> Entfernung zum nächsten
                7-Eleven-Convenience-Store
                <br />• <strong>Bahnhof:</strong> Entfernung zum nächsten Bahnhof
                <br />
                <br />
                <strong>Benutzerdefiniertes Messen:</strong>
                <br />• <strong>Benutzerdefiniertes Messen:</strong> Eigene Merkmale
                zum Messen der Entfernung zeichnen
                <br />• Zeichenmodus aktivieren, um benutzerdefinierte Punkte oder
                Bereiche zu erstellen
                <br />• Ideal für spielspezifische Merkmale oder lokale
                Wahrzeichen
                <br />
                <br />
                <strong>Implementierungsdetails:</strong>
                <br />• Verwendet geodätische Distanzberechnungen für Genauigkeit
                <br />• Puffer um Merkmale erstellen Zonen gleicher Entfernung
                <br />• Ergebnisse zeigen, welche Bereiche näher/weiter als der
                Referenzpunkt sind
            </>
        ),
        position: "center",
    },
    {
        title: "Teilen und Zusammenarbeitsfunktionen",
        content: (
            <>
                Nahtloses Teilen ist entscheidend für Mehrspieler-Spiele. Das
                Teilen-System bietet mehrere Methoden:
                <br />
                <br />
                <strong>URL-Teilen:</strong>
                <br />• <strong>Direkte Links:</strong> Gesamten Spielzustand in
                URL einbetten
                <br />• <strong>Komprimierte Links:</strong> Kleinere URLs für
                komplexe Spiele
                <br />• <strong>Pastebin-Integration:</strong> Für sehr große
                Spielzustände
                <br />
                <br />
                <strong>Was geteilt wird:</strong>
                <br />• Alle Standortgrenzen (Voreinstellungen und benutzerdefiniert)
                <br />• Vollständige Fragekonfigurationen
                <br />• Fragen-Antworten/Ergebnisse
                <br />• Spieloptionen und Einstellungen
                <br />• Visuelle Anpassungen (Farben, Einheiten)
                <br />
                <br />
                <strong>Was nicht geteilt wird:</strong>
                <br />• Tatsächlicher Standort des Versteckers (bei Verwendung des
                Verstecker-Modus)
                <br />• Persönliche API-Schlüssel
            </>
        ),
        targetSelector: '[data-tutorial-id="share-questions-button"]',
        position: "top",
    },
    {
        title: "Verstecker-Modus: Automatische Fragenbeantwortung",
        content: (
            <>
                Der Verstecker-Modus ist die leistungsstärkste Funktion zur
                Vereinfachung des Spielablaufs:
                <br />
                <br />
                <strong>Funktionsweise:</strong>
                <br />
                1. Verstecker erhält Spiellink von den Suchern
                <br />
                2. Aktiviert den Verstecker-Modus und gibt seinen genauen
                Standort ein
                <br />
                3. Alle Fragen werden automatisch basierend auf seiner Position
                beantwortet
                <br />
                4. Verstecker teilt den aktualisierten Link mit Antworten zurück
                an die Sucher
                <br />
                <br />
                <strong>Datenschutz:</strong> Die genauen Koordinaten des
                Versteckers werden niemals geteilt, nur die Fragentworten.
            </>
        ),
        position: "center",
    },
    {
        title: "Erweiterte Optionen und Einstellungen",
        content: (
            <>
                Das Optionen-Menü enthält leistungsstarke Anpassungsfunktionen,
                die dein Spielerlebnis erheblich beeinflussen:
                <br />
                <br />
                <strong>Anzeige-Optionen:</strong>
                <br />• <strong>Auto-Zoom:</strong> Passt die Karte automatisch
                an relevante Bereiche an, wenn Fragen hinzugefügt oder Zonen
                analysiert werden. Deaktivieren für manuelle Zoom-Kontrolle.
                <br />• <strong>Kartenbewegungen animieren:</strong> Sanfte
                Übergänge zwischen Kartenpositionen vs. sofortige Sprünge.
                <br />• <strong>Bahnlinien hervorheben:</strong> Visuelle
                Hervorhebung von Eisenbahnnetzen. Erfordert Thunderforest-API-Schlüssel,
                bietet aber wichtigen visuellen Kontext für bahnbezogene Fragen.
                <br />• <strong>Mir folgen:</strong> GPS-Verfolgung für die
                mobile Nutzung. Fügt einen Marker hinzu, der deinem Standort
                in Echtzeit folgt.
                <br />
                <br />
                <strong>Einheitenpräferenzen:</strong>
                <br />• <strong>Standardeinheit:</strong> Meilen, Kilometer oder
                Meter für neue Fragen. Dies wird der Standard für alle neuen Fragen.
                Wähle basierend auf den Konventionen deiner Region.
                <br />• Betrifft alle distanzbasierten Fragen und Messungen im
                gesamten Spiel
                <br />
                <br />
                <strong>Automatisierung:</strong>
                <br />• <strong>Automatisch speichern:</strong> Kontinuierliches
                Speichern vs. manuelle Speicherkontrolle. Wenn deaktiviert, erscheinen
                &ldquo;Speichern&rdquo;-Schaltflächen auf Fragekarten für manuelle
                Kontrolle.{" "}
                <strong>
                    Ich empfehle dringend, dies zu deaktivieren, da ich es für
                    einfacher halte, Daten zu ändern.
                </strong>
                <br />• <strong>Planungsmodus:</strong> Vorschau der
                Frageneffekte vor der Finalisierung.{" "}
                <strong>
                    Ich empfehle dringend, dies zu aktivieren, da es dir alle
                    möglichen Ergebnisse einer Frage zeigt und deine Strategie
                    verbessert.
                </strong>
                <br />
                <br />
                <strong>API-Integration:</strong>
                <br />• <strong>Thunderforest-API-Schlüssel:</strong> Verbesserte
                Kartenkacheln
                <br />• <strong>Pastebin-API-Schlüssel:</strong> Verbessertes
                Teilen für große Spiele
                <br />• <strong>Immer Pastebin verwenden:</strong> Externes Hosting
                für alle Freigaben erzwingen. Nützlich, wenn du einen QR-Code mit
                dem Link erstellen möchtest, da dieser dadurch weniger komplex wird.
            </>
        ),
        targetSelector: '[data-tutorial-id="option-questions-button"]',
        position: "top",
    },
    {
        title: "Datenquellen, Genauigkeit und Einschränkungen",
        content: (
            <>
                Das Verstehen der zugrundeliegenden Datenquellen hilft dabei,
                angemessene Erwartungen zu setzen:
                <br />
                <br />
                <strong>OpenStreetMap (OSM) Grundlage:</strong>
                <br />• Alle geografischen Daten stammen von OpenStreetMap
                <br />• Community-getriebenes Kartieren mit unterschiedlicher
                Vollständigkeit
                <br />• Generell ausgezeichnet in städtischen Gebieten, dünner
                in ländlichen Regionen
                <br />• Datenqualität hängt von der lokalen Kartier-Community ab
                <br />• Wird regelmäßig aktualisiert, kann aber hinter
                realen Änderungen zurückliegen
                <br />
                <br />
                <strong>Verwaltungsgrenzen:</strong>
                <br />• Offizielle Regierungsgrenzen aus maßgeblichen Quellen
                importiert
                <br />• Hohe Genauigkeit für wichtige Verwaltungsunterteilungen
                <br />• Vereinfacht auf ±100 Meter für Browser-Performance
                <br />• Einige umstrittene oder sich ändernde Grenzen können
                veraltet sein
                <br />
                <br />
                <strong>Verkehrsdaten:</strong>
                <br />• Bahnhöfe: Gute Abdeckung in entwickelten Regionen
                <br />• Kommerzielle Flughäfen: Auf solche mit IATA-Codes beschränkt
                <br />• Hochgeschwindigkeitsbahn: Umfasst große Systeme (Shinkansen,
                TGV usw.)
                <br />• Unternehmensdaten (McDonald&apos;s, 7-Eleven) hängen von
                lokaler Kartierung ab
                <br />
                <br />
                <strong>Points of Interest:</strong>
                <br />• Museen, Krankenhäuser, Kinos: Städtische Ausrichtung
                bei der Abdeckung
                <br />• Freizeitparks, Zoos: Große Attraktionen gut vertreten
                <br />• Bibliotheken, Golfplätze, Berge: Vollständigkeit variiert
                je nach Region
                <br />• Kritische Standorte für dein Spielgebiet immer prüfen
                <br />
                <br />
                <strong>Koordinatengenauigkeit:</strong>
                <br />• Distanzberechnungen verwenden geodätische Formeln
                <br />• Berücksichtigt die Erdkrümmung und Ellipsoidform
                <br />• Typische Genauigkeit innerhalb von 1–2 Metern
                <br />• Küstenliniendaten-Genauigkeit ca. ±100 Meter
                <br />• Vereinfachung von Verwaltungsgrenzen kann die Präzision
                beeinflussen
                <br />
                <br />
                <strong>Performance-Einschränkungen:</strong>
                <br />• Große Datensätze können den Browser verlangsamen
                <br />• Speichernutzung steigt mit der Größe des Spielgebiets
                <br />• Komplexe Polygone für Rendering-Performance vereinfacht
                <br />• API-Ratenlimits können das Laden von Echtzeit-Daten
                beeinflussen
                <br />• Mobilgeräte haben zusätzliche Speicherbeschränkungen
            </>
        ),
        position: "center",
    },
    {
        title: "Du bist bereit, Hide and Seek zu meistern!",
        content: (
            <>
                Herzlichen Glückwunsch! Du hast jetzt umfassende Kenntnisse über
                alle 48+ Fragenvariationen und erweiterten Funktionen in diesem
                Tool.
                <br />
                <br />
                <strong>Schnellstart-Checkliste:</strong>
                <br />✓ Spielgebiet mit Ortsauswahl oder benutzerdefinierten
                Polygonen einrichten
                <br />✓ Fragen mit den fünf Haupttypen hinzufügen und
                konfigurieren
                <br />✓ Setup bei Bedarf mit dem Planungsmodus testen
                <br />✓ Optionen für optimale Performance und Erlebnis
                konfigurieren
                <br />✓ Spiellink über die Teilen-Schaltfläche mit allen
                Spielern teilen
                <br />✓ Verstecker-Modus für automatische Fragenbeantwortung
                nutzen
                <br />✓ Ergebnisse analysieren
                <br />
                <br />
                <strong>Die fünf Fragetypen meistern:</strong>
                <br />• <strong>Radius:</strong> Distanzbasierte Kreise
                (innen/außen)
                <br />• <strong>Thermometer:</strong> Relativer Distanzvergleich
                (wärmer/kälter)
                <br />• <strong>Tentakel:</strong> Spezifische Standortidentifikation
                nach Kategorie
                <br />• <strong>Matching:</strong> Eigenschaftsvergleich (gleiche
                Zone, nächster Flughafen usw.)
                <br />• <strong>Messen:</strong> Distanzvergleich relativ zu den
                Suchern
                <br />
                <br />
                <strong>Hilfe benötigt?</strong> Dieses Tutorial ist jederzeit
                über die Tutorial-Schaltfläche verfügbar. Zögere nicht,{" "}
                <a
                    href="https://github.com/taibeled/JetLagHideAndSeek/issues"
                    className="text-blue-500 cursor-pointer"
                    target="_blank"
                    rel="noreferrer"
                >
                    Probleme zu melden oder Funktionen auf GitHub anzufragen
                </a>
                . Dein Feedback hilft dabei, das Tool für alle zu verbessern!
                <br />
                <br />
                <strong>Projekt unterstützen:</strong> Wenn dieses Tool deine
                Jet-Lag-Spiele bereichert, erwäge bitte,{" "}
                <a
                    href="https://github.com/taibeled/JetLagHideAndSeek"
                    className="text-blue-500 cursor-pointer"
                    target="_blank"
                    rel="noreferrer"
                >
                    einen GitHub-Stern zu hinterlassen
                </a>{" "}
                und es mit Fans zu teilen. Jeder Stern motiviert zur weiteren
                Entwicklung! Zum Zeitpunkt des Schreibens enthält dieses Projekt
                über 12.002 Zeilen Code. Bei einer großzügigen Schätzung von 50
                Zeilen pro Stunde haben wir Entwickler zusammen über 240 Stunden
                in dieses Projekt gesteckt! Ein kostenloser Stern ist eine
                großartige Möglichkeit, deine Wertschätzung zu zeigen.
                <br />
                <br />
                Viel Spaß beim Verstecken und Suchen!
            </>
        ),
        position: "center",
    },
];
