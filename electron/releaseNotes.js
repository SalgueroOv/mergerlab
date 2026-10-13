/**
 * Convierte las notas de un Release de GitHub (que `electron-updater` entrega como HTML) en texto
 * plano para el diálogo nativo de actualización, que no sabe mostrar HTML.
 *
 * Convención para las notas bilingües: el cuerpo del Release lleva dos secciones, cada una
 * precedida por una línea con solo "Español" o "English" (con o sin `#`, negrita o emoji). La
 * app muestra la sección en español si el idioma es `es` y la inglesa en cualquier otro idioma.
 * Si no hay marcadores, se muestra el texto completo tal cual.
 */

// Máximo de caracteres de notas que se muestran en el diálogo; el resto se recorta con "…".
const MAX_NOTES_LENGTH = 1200;

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * HTML -> texto plano: los `<li>` pasan a viñetas, los bloques a líneas separadas y el resto de
 * etiquetas se descarta. `<script>`/`<style>` se eliminan con su contenido.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  const text = String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|ul|ol|tr|blockquote|pre)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Si `line` es un marcador de idioma ("Español", "## English", "**EN**", "🇪🇸 Español"...),
 * devuelve `"es"` o `"en"`; si no, `null`.
 */
function languageMarker(line) {
  if (line.length > 30) return null;
  const word = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase();
  if (word === "espanol" || word === "spanish" || word === "es") return "es";
  if (word === "english" || word === "ingles" || word === "en") return "en";
  return null;
}

/**
 * Elige de `text` la parte que corresponde a `language` según la convención bilingüe del
 * encabezado del archivo. Sin marcadores devuelve `text` entero; con marcadores, la sección del
 * idioma (`es` -> español, cualquier otro -> inglés) o, si falta, la otra.
 * @param {string} text notas ya en texto plano
 * @param {string} language código de idioma de la app
 * @returns {string}
 */
function pickLanguageSection(text, language) {
  const sections = {};
  let current = null;
  let found = false;
  for (const line of text.split("\n")) {
    const marker = languageMarker(line);
    if (marker) {
      current = marker;
      found = true;
      sections[current] = sections[current] ?? [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  if (!found) return text;

  const wanted = language === "es" ? "es" : "en";
  const other = wanted === "es" ? "en" : "es";
  const body = (key) => (sections[key] ?? []).join("\n").trim();
  return body(wanted) || body(other);
}

/**
 * Prepara las notas de `info.releaseNotes` (de `electron-updater`) para mostrarlas en el
 * diálogo. Con `fullChangelog` activo llegan como lista `{version, note}` (una por versión
 * intermedia); si no, como un único texto HTML. Devuelve `""` si no hay notas.
 * @param {string | Array<{version: string, note: string | null}> | null | undefined} releaseNotes
 * @param {string} language código de idioma de la app
 * @returns {string}
 */
function formatReleaseNotes(releaseNotes, language) {
  let text = "";
  if (Array.isArray(releaseNotes)) {
    text = releaseNotes
      .map(({ version, note }) => {
        const body = pickLanguageSection(htmlToText(note), language);
        return body ? `v${version}\n${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  } else if (typeof releaseNotes === "string") {
    text = pickLanguageSection(htmlToText(releaseNotes), language);
  }
  if (text.length > MAX_NOTES_LENGTH) text = `${text.slice(0, MAX_NOTES_LENGTH).trimEnd()}…`;
  return text;
}

module.exports = { htmlToText, pickLanguageSection, formatReleaseNotes };
