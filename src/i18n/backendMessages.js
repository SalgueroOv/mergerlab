import i18n from "./index.js";

/**
 * Traduce un mensaje proveniente del backend Python (error o estado de progreso: ambos usan la
 * misma forma `{ message, code, params }`, ver backend/server.py).
 *
 * El backend siempre manda `message` en español como respaldo, más `code`/`params` cuando el
 * mensaje es traducible (no todos lo son: los mensajes que citan el texto crudo de una excepción
 * de terceros, por ejemplo, no tienen traducción posible). Si el frontend no reconoce el código
 * — versión desincronizada entre frontend/backend, o mensaje sin código — se muestra `message`
 * tal cual en vez de rompear o mostrar una clave sin traducir.
 *
 * @param {{ message?: string, code?: string, params?: object }} source
 * @param {import("i18next").TFunction} t
 * @param {string} [fallback] texto a usar si `source` no trae ni `code` reconocido ni `message`
 * @returns {string}
 */
export function backendText(source, t, fallback = "") {
  if (!source) return fallback;

  const code = source.code;
  const params = source.params || {};

  // `exists` recibe `params` para reconocer también los códigos que solo tienen claves de plural
  // (`_one`/`_other`...): sin `count`, i18next no las encuentra y se caería a `message` en español.
  if (code && i18n.exists(`backend.${code}`, params)) {
    return t(`backend.${code}`, params);
  }

  return source.message || fallback;
}
