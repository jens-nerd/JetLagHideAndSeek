export type Kartenart = "zeitbonus" | "fluch";

export type Fluchgruppe =
    | "aufgabe"
    | "gegenstand"
    | "bewegung"
    | "absprache"
    | "information"
    | "fragensperre"
    | "eigenvorteil";

export interface Karte {
    /** Stabile Kennung, z. B. "fluch-brueckenzoll" oder "zeitbonus-10" */
    id: string;
    art: Kartenart;
    name: string;
    /** Haupttext, Absätze mit \n\n getrennt */
    text: string;
    kosten?: string;
    nachweis?: string;
    ausweichregel?: string;
    /** nur bei art === "fluch" */
    gruppe?: Fluchgruppe;
    /**
     * Laufzeit in Minuten je Spielgröße. `null` heißt Aufgabenfluch: läuft,
     * bis die Suchenden "erledigt" melden. Nur bei art === "fluch" gesetzt;
     * `undefined` ist ein Fehler und wird vom Test abgefangen.
     */
    dauerMin?: { S: number; M: number; L: number } | null;
    /**
     * Wörtliche Dauer-Angabe der Karte, wenn sie sich nicht in Minuten
     * ausdrücken lässt ("bis Rundenende", "drei beantwortete Fragen").
     * Die Oberfläche zeigt sie statt der allgemeinen Beschriftung.
     */
    dauerText?: string;
    /** nur bei art === "zeitbonus": Minutenwert je Spielgröße */
    bonusMin?: { S: number; M: number; L: number };
    /**
     * Karten mit "Die Suchenden musst du nicht informieren": Ausspielen und
     * Beenden bleiben vor den Suchenden verborgen, sie stehen auch nicht in
     * deren Fluchliste.
     */
    geheim?: boolean;
    /** Exemplare im Deck */
    anzahl: number;
}

/** Eine Karte, wie sie auf der Hand liegt. `id` ist die Exemplarkennung. */
export interface HandKarte {
    id: string;
    karte: Karte;
}

/** Ein gespielter Fluch, wie ihn beide Rollen sehen. */
export interface Fluch {
    id: string;
    karte: Karte;
    playedAt: string;
    /** ISO8601, oder null bei einem Aufgabenfluch */
    expiresAt: string | null;
    endedAt: string | null;
    endedBy: "ablauf" | "suchende" | "versteckender" | null;
}

/** Ein offener Ziehvorgang. */
export interface PendingDraw {
    questionId: string;
    angeboten: HandKarte[];
    behalten: number;
}

/**
 * Kennung des Nachschlags. Er ist die einzige Karte, die auf die Ziehmechanik
 * wirkt; alle anderen Flueche sind Regeln, die die Spielenden selbst einhalten.
 */
export const NACHSCHLAG_ID = "fluch-nachschlag";

/** So viele beantwortete Fragen lang wirkt der Nachschlag. */
export const NACHSCHLAG_ANWENDUNGEN = 3;

/**
 * Kennung des Glücksrads. Es sperrt laufend eine Fragekategorie; welche,
 * führt der Server in curses.locked_category mit.
 */
export const GLUECKSRAD_ID = "fluch-gluecksrad";

/** Antwort auf POST /questions/:id/draw. */
export interface ZiehErgebnis {
    angeboten: HandKarte[];
    /** Behaltekosten, vom Nachschlag unberuehrt. */
    behalten: number;
    deckRest: number;
    /** true, wenn fuer diesen Zug eine Karte mehr aufgedeckt wurde als sonst. */
    nachschlagAktiv: boolean;
    /** Restanwendungen des laufenden Nachschlags, null ohne laufenden. */
    nachschlagRest: number | null;
}

/**
 * Ziehkosten je Fragenkategorie: `draw` ansehen, `keep` behalten.
 * Umgezogen aus src/lib/card-costs.ts, weil das Backend sie auch braucht.
 */
export const CARD_COSTS: Record<string, { draw: number; keep: number }> = {
    radius:      { draw: 2, keep: 1 },
    matching:    { draw: 3, keep: 1 },
    measuring:   { draw: 3, keep: 1 },
    thermometer: { draw: 2, keep: 1 },
    photo:       { draw: 1, keep: 1 },
    tentacles:   { draw: 4, keep: 2 },
};

export function getCardCost(type: string): { draw: number; keep: number } | null {
    return CARD_COSTS[type] ?? null;
}

/** Die Fragekategorien des Spiels — dieselben Kennungen wie in CARD_COSTS. */
export const FRAGEKATEGORIEN = [
    "radius",
    "matching",
    "measuring",
    "thermometer",
    "photo",
    "tentacles",
] as const;

export type Fragekategorie = (typeof FRAGEKATEGORIEN)[number];

/**
 * Die Kategorien, die in einer Spielgröße zur Verfügung stehen: bei S fünf,
 * weil Tentacle-Fragen dort wegfallen, sonst alle sechs.
 *
 * Eine unbekannte oder fehlende Spielgröße gilt als "M" — dieselbe Regel wie
 * in berechneAblauf, denn sessions.game_size ist freier Text ohne Prüfung.
 */
export function kategorienFuerSpielgroesse(
    gameSize: "S" | "M" | "L" | null | undefined,
): Fragekategorie[] {
    const g = gameSize === "S" || gameSize === "L" ? gameSize : "M";
    return g === "S"
        ? FRAGEKATEGORIEN.filter((k) => k !== "tentacles")
        : [...FRAGEKATEGORIEN];
}

export const KARTEN: Karte[] = [
    // Zeitboni
    {
        id: "zeitbonus-tuerstoerung",
        art: "zeitbonus",
        name: "Türstörung",
        text: "Du kannst diese Karte nicht ausspielen. Liegt sie am Rundenende noch auf deiner Hand, zählt die Zeit zu deiner Versteckzeit. Wirfst du sie ab, ist sie weg.\n\nDie kleinste Münze im Spiel. Kommt ständig, wiegt wenig, summiert sich trotzdem.",
        bonusMin: { S: 2, M: 3, L: 5 },
        anzahl: 22,
    },
    {
        id: "zeitbonus-anschluss-weg",
        art: "zeitbonus",
        name: "Anschluss weg",
        text: "Du kannst diese Karte nicht ausspielen. Liegt sie am Rundenende noch auf deiner Hand, zählt die Zeit zu deiner Versteckzeit. Wirfst du sie ab, ist sie weg.\n\nZwei Minuten zu spät am Gleis, und der Rest des Tages verschiebt sich.",
        bonusMin: { S: 4, M: 6, L: 10 },
        anzahl: 13,
    },
    {
        id: "zeitbonus-signalstoerung",
        art: "zeitbonus",
        name: "Signalstörung",
        text: "Du kannst diese Karte nicht ausspielen. Liegt sie am Rundenende noch auf deiner Hand, zählt die Zeit zu deiner Versteckzeit. Wirfst du sie ab, ist sie weg.\n\nNiemand weiß, wie lange es dauert. Die Durchsage sagt auch nichts.",
        bonusMin: { S: 6, M: 9, L: 15 },
        anzahl: 9,
    },
    {
        id: "zeitbonus-schienenersatzverkehr",
        art: "zeitbonus",
        name: "Schienenersatzverkehr",
        text: "Du kannst diese Karte nicht ausspielen. Liegt sie am Rundenende noch auf deiner Hand, zählt die Zeit zu deiner Versteckzeit. Wirfst du sie ab, ist sie weg.\n\nDer Bus steht irgendwo hinter dem Bahnhof. Wo genau, findet jeder selbst heraus.",
        bonusMin: { S: 8, M: 12, L: 20 },
        anzahl: 3,
    },
    {
        id: "zeitbonus-stellwerk-ausgefallen",
        art: "zeitbonus",
        name: "Stellwerk ausgefallen",
        text: "Du kannst diese Karte nicht ausspielen. Liegt sie am Rundenende noch auf deiner Hand, zählt die Zeit zu deiner Versteckzeit. Wirfst du sie ab, ist sie weg.\n\nZwei Stück, und beide bringen nichts, sobald du sie abwerfen musst.",
        bonusMin: { S: 12, M: 18, L: 30 },
        anzahl: 2,
    },

    // Flüche – Aufgabenflüche
    {
        id: "fluch-brueckenzoll",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Brückenzoll",
        text: "Die Suchenden fragen erst weiter, wenn sie unter einer Brücke stehen. Von dort muss die nächste Frage kommen, und sie schicken dir ein Foto nach oben als Beleg.",
        kosten: "Die Suchenden müssen mindestens 1,5 / 8 / 50 Kilometer von dir entfernt sein.",
        ausweichregel: "Unterführungen, Bahnbrücken, Fußgängerbrücken und Tunneleinfahrten zählen. Ein Vordach oder ein Bahnsteigdach nicht. Im Zweifel entscheidet die Karten-App: Über ihnen muss ein Weg verlaufen, der dort eingezeichnet ist.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-steinmaennchen",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Steinmännchen",
        text: "Du baust einen Turm aus gefundenen Steinen. Die Suchenden müssen einen mit genau so vielen Steinen bauen.\n\nJeder Stein darf nur einen anderen berühren. Was gesetzt ist, bleibt liegen. Der Turm muss fünf Sekunden stehen, bevor der nächste Stein draufkommt. Berührt ein Stein außer dem untersten den Boden, ist der Turm gefallen und die Suchenden fangen von vorn an. Steine werden gefunden, nicht gekauft. Danach räumen beide Seiten ihre Türme wieder ab.",
        kosten: "Du baust zuerst selbst. Nicht auf Vorrat vorbereiten, siehe die Regel oben.",
        nachweis: "Foto beider Türme.",
        ausweichregel: "Schotter, Kies, Ziegelbruch und lose Pflastersteine zählen mit. Findet eine Seite im Umkreis von 200 Metern nach 15 Minuten Suche nichts Stapelbares, gilt der Fluch als erledigt.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-warteschlange",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Warteschlange",
        text: "Die Suchenden stellen sich irgendwo an und warten dort 5 / 5 / 10 Minuten. Kaufen müssen sie nichts. Warten schon.\n\nBeim Einreihen müssen mindestens zwei Leute vor ihnen stehen. Niemanden vorlassen, auch nicht den netten alten Herrn mit den zwei Brötchen. Sobald niemand mehr vor ihnen steht, läuft die Uhr nicht weiter. Sie stellen sich dann hinten in einer anderen Schlange an. Die abgesessene Zeit nehmen sie mit.",
        kosten: "Du stehst selbst gerade in einer Schlange, wenn du die Karte spielst.",
        nachweis: "Foto oder Video, auf dem Leute vor ihnen stehen. Von dir dasselbe.",
        ausweichregel: "Bäckerei, Kiosk, Apotheke, Supermarktkasse, Reisezentrum, Imbiss. Ist in 15 Minuten Fußweg keine Schlange mit zwei Leuten darin aufzutreiben, gilt der Fluch als erledigt.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-pi-mal-daumen",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Pi mal Daumen",
        text: "Du suchst dir eine von vier Zahlen aus. Die Suchenden gehen zur nächsten Stelle, an der sie diese Zahl ablesen oder abzählen können, und nennen dir ihre Schätzung, bevor sie hinsehen.\n\nZur Wahl stehen die Bahnsteigkanten am nächsten Bahnhof, die Abfahrten der nächsten Stunde auf dem Aushangfahrplan der nächsten Haltestelle, die Stufen der nächsten Treppe mit mehr als zehn Stufen, oder die Einwohnerzahl auf dem nächsten Ortsschild, falls in Gehweite eins steht.\n\nNachschlagen ist verboten. Die Wahrheit hängt an einem Mast oder liegt unter ihren Füßen, dafür braucht niemand ein Telefon.\n\nLiegt die Schätzung innerhalb von 25 Prozent, ist die Sache erledigt. Gerechnet wird von der richtigen Zahl aus, nicht von der geschätzten. Daneben geschätzt bringt dir 15 / 20 / 30 Minuten.\n\nSo oder so endet der Fluch mit dem Versuch. Bis dahin fragen sie nicht, danach schon, und die erste Frage danach ist für sie umsonst.",
        kosten: "Die nächste Frage der Suchenden ist kostenlos. Du ziehst dafür keine Karten.",
        nachweis: "Foto der Stelle mit der Zahl, oder ein Video vom Zählen.",
        ausweichregel: "Ist die gewählte Zahl nach 15 Minuten Fußweg nirgends zu finden, nehmen sie die nächste aus der Liste. Geht auch die nicht, ist der Fluch erledigt.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-wildwechsel",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Wildwechsel",
        text: "Ein wildlebendes Tier vor deine Kamera, dann sind sie dran: Die Suchenden brauchen eins aus derselben Klasse. Vogel bleibt Vogel, Säugetier bleibt Säugetier, Insekt bleibt Insekt.\n\nWildlebend heißt: kein Haustier, kein Zootier, nichts hinter einem Zaun. Stadttauben, Eichhörnchen, Wespen und Ratten gehen alle klar.\n\nPasst dein Tier in keine der drei Gruppen, weil du eine Spinne, eine Schnecke oder einen Fisch erwischt hast, entscheidet der deutsche Wikipedia-Artikel: Die Suchenden brauchen ein Tier aus derselben Klasse, die dort im Kasten steht.",
        kosten: "Du fotografierst zuerst.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-vogelkino",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Vogelkino",
        text: "Du filmst einen Vogel am Stück, höchstens 5 / 10 / 15 Minuten lang. Sobald er aus dem Bild ist, stoppt deine Zeit. Was du geschafft hast, ist die Vorgabe.\n\nDie Suchenden müssen diese Zeit erreichen. Du hast einen Versuch, sie haben beliebig viele.\n\nAm Stück heißt: Der Vogel ist durchgehend im Bild. Zoomen und Mitgehen sind erlaubt, Schneiden nicht.",
        kosten: "dein eigener Film.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-irrgarten",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Irrgarten",
        text: "Du zeichnest ein Labyrinth und schickst es rüber. Die Suchenden müssen es lösen.\n\nDeine Zeichenzeit: höchstens 10 / 20 / 30 Minuten ab dem ersten Strich. Papier und Stift besorgen zählt nicht mit. Du darfst verwerfen und neu anfangen, aber die Uhr läuft weiter. Lösbar muss es am Ende sein.",
        kosten: "die Zeichnung.",
        nachweis: "Foto mit eingezeichnetem Weg.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-werbepause",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Werbepause",
        text: "Die Suchenden müssen tun, wofür sie gerade Werbung gesehen haben. Den beworbenen Ort betreten oder das beworbene Produkt kaufen, je nachdem.\n\nDie Werbung muss draußen gehangen haben und mindestens 30 Meter vom Ort oder Produkt entfernt gewesen sein. Werbung auf dem eigenen Handy zählt nicht.",
        kosten: "Die nächste Frage der Suchenden ist kostenlos. Du ziehst dafür keine Karten.",
        ausweichregel: "Plakate, Litfaßsäulen, Schaufensteraufsteller und Fahrzeugwerbung zählen. Findet sich in 20 Minuten Fußweg nichts, was sich erfüllen lässt, ist der Fluch erledigt.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-suchbild",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Suchbild",
        text: "Die Suchenden nennen dir ihren Standort. Du suchst im Straßenbild einen Punkt im Umkreis von 150 Metern und schickst ein Bild davon. Sie müssen hingehen und ein eigenes Foto von derselben Stelle schicken.\n\nDabei sind Karten, Bildersuche und Nachfragen bei Passanten verboten. Die Suchenden gehen los und erkennen die Stelle wieder, oder sie gehen im Kreis.\n\nDieser Fluch sperrt Fragen und Nahverkehr gleichzeitig.\n\nAbbruch: Die Suchenden dürfen jederzeit aufgeben. Dann bekommst du 20 / 30 / 45 Minuten, und der Fluch ist erledigt. Damit ist die Karte für beide Seiten kalkulierbar: Entweder sie laufen, oder sie zahlen.\n\nNur für diesen Fluch darfst du das Straßenbild benutzen. Im restlichen Spiel ist es gesperrt.",
        kosten: "Die Suchenden müssen draußen sein.",
        ausweichregel: "Ist im Straßenbild nichts Wiedererkennbares zu finden, weil da Wald, Baustelle oder gar kein Bildmaterial ist, such dir einen anderen Punkt oder lass die Karte verfallen.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-abstecher",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Abstecher",
        text: "Du bestimmst einen Ort im Umkreis von 400 / 400 / 800 Metern um die Suchenden. Sie müssen hin, dort 5 / 5 / 10 Minuten bleiben, dir drei Fotos von der Stelle schicken und ein Souvenir mitnehmen. Das Souvenir übergeben sie dir am Ende der Runde.\n\nAls Souvenir geht alles, was man mitnehmen darf. Ein Flyer, ein Bierdeckel, ein Kassenbon, ein Blatt, ein Kieselstein. Nichts, was jemandem gehört.\n\nGeht das Souvenir vor der Übergabe verloren, bekommst du 30 / 45 / 60 Minuten.\n\nNicht spielbar, solange die Suchenden in einem Verkehrsmittel sitzen.",
        kosten: "Der Ort muss weiter von dir entfernt liegen als der aktuelle Standort der Suchenden.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-erpresserbrief",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Erpresserbrief",
        text: "Ihre nächste Frage müssen die Suchenden als Buchstabencollage stellen. Ausgeschnittene oder abgerissene Buchstaben aus gedrucktem Material, mindestens fünf Wörter. Ein Foto davon reicht.\n\nMaterial: Gratiszeitungen, Werbeprospekte, Verpackungen, Fahrpläne. Kein Handy, kein selbst ausgedrucktes Blatt.",
        kosten: "Du legst zuerst selbst eine Collage. Nicht auf Vorrat vorbereiten, siehe die Regel oben.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-galgenfrist",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Galgenfrist",
        text: "Die Suchenden müssen dich im Galgenmännchen schlagen. Bis dahin fragen sie nicht und steigen in kein Verkehrsmittel.\n\nDu denkst dir ein Wort mit fünf Buchstaben aus. Nach sieben falschen Buchstaben haben sie die Partie verloren und warten zehn Minuten bis zur nächsten.\n\nDer Fluch endet, wenn sie eine Partie gewinnen, oder nach 1 / 2 / 3 Niederlagen. Und er endet sofort, wenn du auf einen geratenen Buchstaben länger als 30 Sekunden nicht antwortest. Wer bluffen will, muss schnell bluffen.\n\nBuch führen die Suchenden. Sie halten fest, was geraten wurde und wie viele Fehler schon drauf sind, du sagst nur richtig oder falsch.",
        kosten: "2 Karten.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-kegelbahn",
        art: "fluch",
        gruppe: "aufgabe",
        name: "Kegelbahn",
        text: "Die Suchenden müssen einen Würfel mindestens 30 Meter weit rollen lassen und dabei eine 5 oder 6 treffen. Vorher fragen sie nicht weiter.\n\nRollen heißt rollen. Rutschen und Springen zählen nicht, und gemessen wird von der Stelle, an der der Würfel die Hand verlässt, bis dorthin, wo er liegen bleibt.\n\nRollt der Würfel gegen einen Menschen, ist der Wurf ungültig und du bekommst 10 / 20 / 30 Minuten. Sie haben also einen guten Grund, sich eine freie Fläche zu suchen.",
        kosten: "Du würfelst einmal, bevor du die Karte spielst. Kommt eine 5 oder 6, verpufft sie.",
        nachweis: "Video vom Wurf, ungeschnitten.",
        ausweichregel: "Gerollt wird auf befestigtem Boden ohne Autoverkehr. Gehwege, Plätze, Bahnhofshallen, Parkwege. Treppen und Gleise nicht. Ist im Umkreis von 200 Metern keine solche Fläche, gilt der Fluch als erledigt.",
        dauerMin: null,
        anzahl: 1,
    },

    // Flüche – Gegenstandsflüche
    {
        id: "fluch-eiertanz",
        art: "fluch",
        gruppe: "gegenstand",
        name: "Eiertanz",
        text: "Die Suchenden kaufen ein rohes Ei. Es gilt bis zum Rundenende als vollwertiges Teammitglied: Wo alle Suchenden hinmüssen, muss auch das Ei hin. Bis sie es haben, dürfen sie nicht fragen.\n\nJeder sichtbare Riss ist ein Verlust und bringt dir 30 / 45 / 60 Minuten. Die Suchenden müssen dir das sofort melden.\n\nWeil das Ei als Teammitglied zählt, betrifft es auch jeden anderen Fluch, der alle Suchenden zu etwas verpflichtet. Zitronenpflicht zum Beispiel.\n\nNicht im Endgame spielbar.",
        kosten: "2 Karten.",
        nachweis: "Foto beim Kauf, Foto auf Verlangen.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-zitronenpflicht",
        art: "fluch",
        gruppe: "gegenstand",
        name: "Zitronenpflicht",
        text: "Jede suchende Person besorgt sich eine Zitrone und trägt sie ab sofort direkt auf der Haut oder auf der äußersten Kleidungsschicht. In der Jackentasche gilt nicht. Bis alle versorgt sind, wird nicht gefragt.\n\nDas gilt bis zum Rundenende. Vorher wird keine Zitrone abgelegt.\n\nWer seine verliert, bringt dir 30 / 45 / 60 Minuten.\n\nNicht im Endgame spielbar.",
        kosten: "ein Powerup von deiner Hand.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-wassertraeger",
        art: "fluch",
        gruppe: "gegenstand",
        name: "Wasserträger",
        text: "Die Suchenden besorgen zwei Liter Flüssigkeit pro Person und tragen sie bis zum Rundenende mit. Wie sie die Last untereinander aufteilen, ist ihre Sache. Vorher fragen sie nicht.\n\nWas sie ohnehin dabeihatten, zählt nicht mit.\n\nAbstellen ist erlaubt, solange jemand in drei Metern Nähe bleibt, im Stehen wie im Verkehrsmittel. Wird der Abstand größer, gilt die Flüssigkeit als aufgegeben, und du musst es sofort erfahren. Das bringt dir 30 / 30 / 60 Minuten.\n\nAls Gewässer zählt, was in der Karten-App des Spiels als Wasserfläche oder Wasserlauf eingezeichnet ist, also in den OpenStreetMap-Daten. Alster, Elbe, Kanäle, Fleete, Parkteiche. Springbrunnen und Pfützen nicht.",
        kosten: "Die Suchenden müssen sich innerhalb von 300 Metern eines Gewässers befinden.",
        dauerMin: null,
        anzahl: 1,
    },

    // Flüche – Bewegungsflüche
    {
        id: "fluch-rechtsdrall",
        art: "fluch",
        gruppe: "bewegung",
        name: "Rechtsdrall",
        text: "An jeder Kreuzung dürfen die Suchenden nur rechts abbiegen oder geradeaus weitergehen. Links ist gesperrt.\n\nAls rechts zählt jede Straße, die in irgendeinem Winkel nach rechts abgeht. Geht in einer Sackgasse 300 Meter lang weder geradeaus noch rechts, dürfen sie umdrehen.\n\nEine Kreuzung ist jede Stelle, an der sie von ihrer Straße auf eine andere Straße mit Namen abbiegen könnten. Eine Hofeinfahrt, ein Parkplatzausgang und ein Trampelpfad sind keine.\n\nDer Fluch greift nur an Straßenkreuzungen. In Gebäuden, auf Bahnsteigen und in Grünanlagen ohne festes Wegenetz gilt er nicht.",
        kosten: "1 Karte.",
        dauerMin: { S: 20, M: 40, L: 60 },
        anzahl: 1,
    },
    {
        id: "fluch-wuerfelgang",
        art: "fluch",
        gruppe: "bewegung",
        name: "Würfelgang",
        text: "Bevor die Suchenden loslaufen, würfeln sie. Dann gehen sie genau so viele Schritte. Dann würfeln sie wieder.\n\nMehrere Suchende dürfen einzeln würfeln oder sich auf einen gemeinsamen Wurf einigen. Schritte, die aus Versehen zu viel waren, werden nachträglich erwürfelt. Absichtlich weiterzugehen ist nicht erlaubt, außer das Stehenbleiben wäre gefährlich, etwa mitten auf einer Fahrbahn.",
        kosten: "Du würfelst einmal. Bei einer geraden Zahl verpufft die Karte.",
        dauerMin: { S: 20, M: 40, L: 60 },
        anzahl: 1,
    },
    {
        id: "fluch-tuersteher",
        art: "fluch",
        gruppe: "bewegung",
        name: "Türsteher",
        text: "Vor jeder Tür werfen die Suchenden zwei Würfel. Erst ab Summe 7 dürfen sie hindurch.\n\nGewürfelt wird, sobald die Tür in Sicht ist. Bei einem Fehlwurf ist das ganze Gebäude oder Fahrzeug gesperrt, nicht nur diese eine Tür, und zwar für 5 / 10 / 15 Minuten. Türen im Inneren eines Gebäudes brauchen keinen Wurf. Läuft der Fluch ab, während eine Sperre noch steht, endet die Sperre mit ihm.\n\nDie Sperrzeiten führen die Suchenden. Du musst nicht mitzählen, welches Kaufhaus wann wieder auf ist.",
        kosten: "2 Karten.",
        dauerMin: { S: 30, M: 60, L: 180 },
        anzahl: 1,
    },
    {
        id: "fluch-zwangsausstieg",
        art: "fluch",
        gruppe: "bewegung",
        name: "Zwangsausstieg",
        text: "Die Suchenden verlassen ihr Verkehrsmittel an der nächsten Station.\n\nDer Fluch greift nur, wenn die Station in den nächsten 0,5 / 0,5 / 1 Stunden noch von einem anderen Verkehrsmittel bedient wird. Sonst verfällt die Karte wirkungslos, etwa auf einer Nachtstrecke um kurz vor eins.",
        kosten: "Sie müssen gerade in die falsche Richtung fahren. Maßgeblich ist, ob ihre nächste planmäßige Station weiter von dir entfernt liegt als ihr jetziger Standort. Dass die Linie später wieder auf dich zuführt, ändert nichts.",
        dauerMin: null,
        anzahl: 1,
    },

    // Flüche – Absprachenflüche
    {
        id: "fluch-stummfilm",
        art: "fluch",
        gruppe: "absprache",
        name: "Stummfilm",
        text: "Untereinander verständigen sich die Suchenden nur noch mit Gesten, Zeigen und Lauten bei geschlossenem Mund.\n\nSchreiben ist genauso gesperrt wie Reden: keine Nachricht, kein Zettel, kein Tippen in eine App, die der andere mitliest. Gemeinsam auf die Karte schauen dürfen sie, sich darüber unterhalten nicht.\n\nMit Fremden dürfen sie reden, mit dir auch. Fragen stellen geht also weiter. Sie müssen sich nur wortlos einig werden, welche.\n\nUnd wenn es gefährlich wird, wird geredet. Eine Straße, ein Gleis, ein Radfahrer von links: Da hört der Fluch auf, und hinterher rechnet niemand nach.\n\nBei einem einzelnen Suchenden nicht spielbar. Im vollen Zug wirkt die Karte übrigens härter als draußen, weil Gesten dort auffallen.",
        kosten: "ein Powerup von deiner Hand.",
        dauerMin: { S: 30, M: 30, L: 30 },
        anzahl: 1,
    },
    {
        id: "fluch-blinder-passagier",
        art: "fluch",
        gruppe: "absprache",
        name: "Blinder Passagier",
        text: "Du benennst eine suchende Person. Die trägt jetzt nichts, schlägt nichts nach, hält keine Karte in der Hand und sagt kein Wort über das Spiel.\n\nGepäck gibt sie ab, das Handy bleibt in der Tasche, Fahrkarte und Notruf ausgenommen. Wenn die anderen überlegen, wohin als Nächstes, schweigt sie. Über alles andere darf sie reden, so viel sie will.\n\nWer darüber streiten will, ob ein Satz hilfreich war, hat die Karte nicht verstanden. Geht es ums Spiel, schweigt sie.\n\nBrauchen die anderen sie beim Abarbeiten eines Fluchs, hilft sie mit. Sie fängt nur nicht von selbst an.\n\nBei einem einzelnen Suchenden nicht spielbar. Sind sie zu dritt oder zu viert, trifft es trotzdem nur eine Person, und du suchst sie aus.",
        kosten: "2 Karten.",
        dauerMin: { S: 60, M: 60, L: 60 },
        anzahl: 1,
    },

    // Flüche – Informationsflüche
    {
        id: "fluch-ohne-gewaehr",
        art: "fluch",
        gruppe: "information",
        name: "Ohne Gewähr",
        text: "Bei deinen nächsten drei Antworten darfst du lügen. Musst du nicht.\n\nDie Suchenden erfahren, dass die Karte im Spiel ist. Welche Antwort erfunden war, erfahren sie nicht, und herausbekommen können sie es auch nicht. Die Frage gilt als gestellt, du ziehst normal dafür, und eine Lüge sieht aus wie jede andere Antwort.\n\nWas du tust, schreibst du beim Antworten auf einen Zettel, eine Zeile pro Frage, wahr oder erfunden. Am Rundenende zeigst du den Zettel vor. Was dort nicht steht, war die Wahrheit, auch wenn du hinterher großspurig etwas anderes behauptest.\n\nFotofragen sind ausgenommen. Ein erfundenes Foto hieße, irgendwo anders eins zu machen, und so viel kann diese Karte nicht verlangen.\n\nIm Endgame ist sie zu Ende, auch wenn noch Antworten offen wären. Wer gefunden werden kann, lügt nicht mehr über seinen Standort.\n\nSie wirkt auch dann, wenn du sie nie ziehst. Sobald alle wissen, dass sie im Deck liegt, hat jede Antwort im Spiel einen Rand von Zweifel. Der Zettel ist deshalb Pflicht: Am Ende weiß der Tisch, was passiert ist, und niemand fährt mit einem ungeklärten Verdacht nach Hause.",
        kosten: "2 Karten.",
        dauerMin: null,
        dauerText: "drei beantwortete Fragen",
        anzahl: 1,
    },
    {
        id: "fluch-fahrplanauskunft",
        art: "fluch",
        gruppe: "information",
        name: "Fahrplanauskunft",
        text: "Die Suchenden legen ihre nächste Fahrt offen: von welcher Station, zu welcher, mit welcher Linie.\n\nSitzen sie gerade in keinem Fahrzeug, gilt die Auskunft für die nächste Fahrt, die sie antreten, und sie melden sie, bevor sie einsteigen.\n\nSteigen sie früher aus, steigen sie um oder ändern sie das Ziel, sagen sie dir das sofort. Umplanen dürfen sie jederzeit, sie dürfen es nur nicht für sich behalten.\n\nDie Karte ist erledigt, wenn sie an der angesagten Zielstation aussteigen.\n\nDie einzige Karte im Satz, die den Suchenden nichts verbietet. Sie kauft dir eine Auskunft, und bezahlt wird mit Minuten, die du sonst am Rundenende bekommen hättest.",
        kosten: "Zeitboni im Wert von mindestens 10 / 15 / 20 Minuten, in ganzen Karten.",
        dauerMin: null,
        anzahl: 1,
    },

    // Flüche – Fragensperren
    {
        id: "fluch-tabu",
        art: "fluch",
        gruppe: "fragensperre",
        name: "Tabu",
        text: "Du nennst drei Fragen aus drei verschiedenen Kategorien. Diese drei sind für den Rest der Runde gesperrt, auch gegen Aufpreis.\n\nSpielbar auch zwischen Frage und Antwort. Dann darfst du deine Hand abwerfen, bevor du die Belohnung für die laufende Frage bekommst. Nur die gerade gestellte Frage darfst du nicht sperren.",
        kosten: "deine ganze Hand.",
        dauerMin: null,
        anzahl: 1,
    },
    {
        id: "fluch-gluecksrad",
        art: "fluch",
        gruppe: "fragensperre",
        name: "Glücksrad",
        text: "Ab sofort ist immer genau eine Fragekategorie gesperrt. Nach jeder gestellten Frage wird neu gewürfelt, welche.\n\nVor dem ersten Wurf ordnen die Suchenden jeder Kategorie eine Würfelzahl zu und sagen dir die Zuordnung. In kleinen Spielen gibt es nur fünf Kategorien, weil Tentacle-Fragen dort wegfallen. Eine gewürfelte Sechs bedeutet dann Neuwurf. Dieselbe Kategorie kann mehrmals hintereinander dran sein.",
        kosten: "ein Zeitbonus von deiner Hand.",
        dauerMin: null,
        dauerText: "bis Rundenende",
        anzahl: 1,
    },
    {
        id: "fluch-nicht-waehrend-der-fahrt",
        art: "fluch",
        gruppe: "fragensperre",
        name: "Nicht während der Fahrt",
        text: "Die Suchenden dürfen nicht fragen, solange sie in einem Verkehrsmittel sitzen oder sich in einer Station aufhalten.\n\nWas zur Station gehört, steht oben bei den Begriffen. Fahren dürfen sie weiter wie bisher, und eine Frage, die schon gestellt war, beantwortest du trotzdem.",
        kosten: "2 Karten.",
        dauerMin: null,
        dauerText: "bis Rundenende",
        anzahl: 1,
    },

    // Flüche – Eigenvorteil
    {
        id: "fluch-nachschlag",
        art: "fluch",
        gruppe: "eigenvorteil",
        name: "Nachschlag",
        text: "Bei deinen nächsten drei beantworteten Fragen ziehst du jeweils eine Karte mehr. Behalten darfst du gleich viele wie sonst. Du siehst also mehr und suchst besser aus.\n\n| Kategorie | normal | mit Nachschlag |\n|---|---|---|\n| Matching | 3 ziehen, 1 behalten | 4 ziehen, 1 behalten |\n| Measuring | 3 ziehen, 1 behalten | 4 ziehen, 1 behalten |\n| Thermometer | 2 ziehen, 1 behalten | 3 ziehen, 1 behalten |\n| Radar | 2 ziehen, 1 behalten | 3 ziehen, 1 behalten |\n| Foto | 1 ziehen, 1 behalten | 2 ziehen, 1 behalten |\n| Tentacle | 4 ziehen, 2 behalten | 5 ziehen, 2 behalten |\n\nDie Suchenden musst du nicht informieren.",
        kosten: "1 Karte.",
        dauerMin: null,
        geheim: true,
        anzahl: 1,
    },
];

const KARTEN_INDEX = new Map(KARTEN.map((k) => [k.id, k]));

export function findeKarte(id: string): Karte | undefined {
    return KARTEN_INDEX.get(id);
}
