const test = require("node:test");
const assert = require("node:assert/strict");
const { htmlToText, pickLanguageSection, formatReleaseNotes } = require("./releaseNotes.js");

test("htmlToText convierte listas en viñetas y decodifica entidades", () => {
  const html = "<h2>Novedades</h2><ul><li>Uno &amp; dos</li><li>Tres &#233;</li></ul><p>Fin</p>";
  assert.equal(htmlToText(html), "Novedades\n\n• Uno & dos\n\n• Tres é\n\nFin");
});

test("htmlToText elimina script y style y tolera entradas vacías", () => {
  assert.equal(htmlToText("<style>a{}</style>Hola<script>alert(1)</script>"), "Hola");
  assert.equal(htmlToText(null), "");
  assert.equal(htmlToText(""), "");
});

const BILINGUAL = "<h2>Español</h2><ul><li>Cambio uno</li></ul><h2>English</h2><ul><li>Change one</li></ul>";

test("pickLanguageSection elige español para es e inglés para el resto", () => {
  const text = htmlToText(BILINGUAL);
  assert.equal(pickLanguageSection(text, "es"), "• Cambio uno");
  assert.equal(pickLanguageSection(text, "en"), "• Change one");
  assert.equal(pickLanguageSection(text, "de"), "• Change one");
});

test("pickLanguageSection devuelve el texto entero si no hay marcadores", () => {
  assert.equal(pickLanguageSection("• Solo una cosa", "en"), "• Solo una cosa");
});

test("pickLanguageSection cae a la otra sección si falta la del idioma", () => {
  const text = htmlToText("<h2>Español</h2><p>Solo español</p>");
  assert.equal(pickLanguageSection(text, "en"), "Solo español");
});

test("formatReleaseNotes concatena versiones intermedias", () => {
  const notes = [
    { version: "0.8.6", note: BILINGUAL },
    { version: "0.8.5", note: "<p>Sin marcadores</p>" },
  ];
  assert.equal(formatReleaseNotes(notes, "es"), "v0.8.6\n• Cambio uno\n\nv0.8.5\nSin marcadores");
});

test("formatReleaseNotes admite texto único y notas ausentes", () => {
  assert.equal(formatReleaseNotes(BILINGUAL, "en"), "• Change one");
  assert.equal(formatReleaseNotes(null, "es"), "");
  assert.equal(formatReleaseNotes(undefined, "es"), "");
  assert.equal(formatReleaseNotes([{ version: "1.0.0", note: null }], "es"), "");
});

test("formatReleaseNotes recorta notas muy largas", () => {
  const result = formatReleaseNotes(`<p>${"a".repeat(5000)}</p>`, "es");
  assert.ok(result.length <= 1201);
  assert.ok(result.endsWith("…"));
});
