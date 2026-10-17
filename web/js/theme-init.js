// Gewählte Darstellung vor dem ersten Zeichnen setzen, damit nichts aufblitzt (Details: js/theme.js).
// Eigene Datei statt Inline-Skript: Die Content-Security-Policy in index.html erlaubt nur Skripte aus der App selbst.
try { var t = localStorage.getItem('fy-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
