# Notizraum

Eine schlanke Markdown-Notiz-App mit HTML, CSS, JavaScript und JSON-Sprachdateien. Es werden keine externen Bibliotheken verwendet; Notizen und Projekte liegen als normale Dateien und Ordner vor.

## Starten – ohne Node.js und ohne Server

Öffne `index.html` direkt per Doppelklick in einem aktuellen Chromium-Browser (zum Beispiel Chrome oder Edge). Es gibt keinen Build-Schritt, keine Installation und keinen Server.

Zum direkten Lesen und Schreiben normaler Dateien benötigt der Browser die File System Access API. Beim ersten Start wählst du einen lokalen Speicherordner aus und erlaubst den Zugriff. Browser ohne diese API können die App nicht zum Bearbeiten des Dateisystems verwenden. Das Ordnerhandle wird in der eingebauten IndexedDB des Browsers gespeichert, damit die App es beim nächsten Start erneut anfragen kann; Notizen bleiben normale Dateien.

## Sprache

Alle Texte und die Locale stehen in JavaScript-Sprachkatalogen unter `languages`. `default.js` enthält Deutsch und wird beim Start geladen; `en.js` enthält die englische Übersetzung. Beide Dateien haben dieselben Schlüssel. Für Englisch kann `index.html` so angepasst werden, dass es statt `default.js` `en.js` lädt.

## Verwendung

1. **Speicherordner auswählen** und einen lokalen Ordner freigeben. Dieser Ordner ist dein Notizraum.
2. Über **＋** ein Projekt anlegen. Projekte werden als Unterordner im ausgewählten Notizraum gespeichert.
3. Innerhalb eines Projekts Ordner, Unterordner und Notizen anlegen.
4. Notizen werden als `.md`-Dateien direkt im gewählten Ordner gespeichert. Änderungen werden automatisch gesichert.
5. Beim nächsten Öffnen den Speicherordner erneut auswählen. Die Inhalte bleiben als normale Dateien erhalten.

Notizen werden im Tab **Bearbeiten** als Markdown-Quelltext bearbeitet. Die Formatierungsleiste fügt passende Markdown-Zeichen ein, zum Beispiel `**fetter Text**`. Der Tab **Vorschau** zeigt die schreibgeschützte formatierte Darstellung.

Verschachtelte Aufzählungs- und nummerierte Listen werden durch Einrücken der Listeneinträge mit 2–4 Leerzeichen pro Ebene erstellt. Die Vorschau erkennt neben den Markdown-Aufzählungszeichen `-`, `*` und `+` auch `•` und `◦`, wie sie beim Kopieren aus anderen Quellen vorkommen können.

Projekte lassen sich in der linken Struktur per Drag-and-drop vor oder hinter andere Projekte sortieren. Die Reihenfolge wird in der versteckten `.projects.json` im Speicherort gespeichert. Ordner und Notizen lassen sich auf ein Projekt oder einen Ordner ziehen, um sie dorthin zu verschieben; Ordner können nicht in sich selbst oder in einen ihrer Unterordner verschoben werden.

Gelöschte Notizen und Ordner werden nach Bestätigung in den versteckten Ordner `__bin` am Speicherort verschoben, nicht endgültig entfernt. In den Papierkorb gelangen nur Markdown-Dateien und Ordner; `.data.json`-Metadateien werden nicht mit verschoben. Ganze Projekte lassen sich nicht über die Löschaktion archivieren.

Das ausgewählte Projekt, der Ordner oder die Notiz kann über **Umbenennen** in der Werkzeugleiste umbenannt werden. Bei Notizen bleibt die Endung `.md` erhalten bzw. wird automatisch ergänzt.

Jeder in der App angelegte Projekt- und Notizordner enthält außerdem eine versteckte `.data.json`. Sie hält den Erstellungszeitpunkt des Ordners und für jede Markdown-Datei deren Erstellungs- und letzten Änderungszeitpunkt fest. Beim ersten Öffnen bereits vorhandener Notizen wird der Dateizeitstempel des Betriebssystems als Ausgangswert verwendet.

In der Markdown-Vorschau werden unter anderem Tabellen, `~~durchgestrichener Text~~` und `==hervorgehobener Text==` dargestellt. Zeilenumbrüche aus dem Bearbeiten-Tab bleiben auch in der Vorschau als eigene Zeilen erhalten. Bilder lassen sich in den Editor einfügen: Sie werden unter einem Namen wie `images-1770931200.png` in einem `__data`-Unterordner neben der Notiz abgelegt und als relativer Markdown-Bildlink eingefügt. Nicht mehr verwendete Bilder werden nach dem Speichern entfernt; wenn der Ordner danach leer ist, wird auch er gelöscht. Bestehende Bildlinks in `__images`- und `__images__`-Ordnern bleiben kompatibel; alle drei internen Ordnernamen werden in der Projektnavigation ausgeblendet.

Projekte sind normale Ordner und Notizen normale `.md`-Dateien. Der Browser speichert nur den Verweis auf den Ordnerzugriff in IndexedDB, nicht deine Notizinhalte.

Der Name des zuletzt geöffneten Projekts und seines Speicherordners wird lokal im Browser gemerkt. Beim Reload versucht die App, das gespeicherte Ordnerhandle und die Browserfreigabe wiederzuverwenden und öffnet das letzte Projekt automatisch, sofern der Browser die Berechtigung beibehält. Falls der Browser eine erneute Freigabe verlangt, klicke auf „Speicherordner auswählen“; die App fragt dann zuerst die Freigabe für das gemerkte Handle an.

Die Seitenleiste zeigt keinen Speicherpfad an. Der Browser stellt einer lokalen HTML-Datei den absoluten Systempfad aus Datenschutzgründen nicht bereit.
