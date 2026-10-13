import { describe, expect, it } from "vitest";
import es from "./locales/es.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import it_ from "./locales/it.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";

const LOCALES = { en, de, fr, it: it_, pt, ru, zh };

/** Aplana un objeto anidado a `{ "a.b.c": valor }`. */
function flatten(object, prefix = "") {
  return Object.entries(object).reduce((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(acc, flatten(value, path));
    else acc[path] = value;
    return acc;
  }, {});
}

const placeholders = (text) => [...String(text).matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
// i18next usa sufijos de plural distintos según el idioma (ru tiene _few/_many, zh solo _other...),
// así que para comparar claves se quita el sufijo.
const baseKey = (key) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const baseKeys = (flat) => new Set(Object.keys(flat).map(baseKey));

const reference = flatten(es);

describe.each(Object.entries(LOCALES))("locale %s", (code, locale) => {
  const flat = flatten(locale);

  it("tiene las mismas claves que es.json", () => {
    const expected = baseKeys(reference);
    const actual = baseKeys(flat);
    expect([...expected].filter((k) => !actual.has(k))).toEqual([]);
    expect([...actual].filter((k) => !expected.has(k))).toEqual([]);
  });

  it("usa los mismos {{parámetros}} que es.json en cada clave", () => {
    const mismatches = [];
    for (const [key, value] of Object.entries(flat)) {
      const ref = reference[key] ?? reference[`${baseKey(key)}_other`] ?? reference[`${baseKey(key)}_one`];
      if (ref === undefined) continue;
      const refParams = new Set(placeholders(ref));
      // Un idioma puede omitir {{count}} en una forma de plural concreta, pero no inventar parámetros.
      const extra = placeholders(value).filter((p) => !refParams.has(p));
      if (extra.length) mismatches.push(`${code}:${key} -> ${extra.join(",")}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("no tiene textos vacíos", () => {
    expect(Object.entries(flat).filter(([, v]) => typeof v === "string" && v.trim() === "")).toEqual([]);
  });
});
