"""Servidor HTTP local que expone la API de combinación de hojas de cálculo.

Se lanza como proceso independiente desde Electron (en dev vía `python server.py`,
en producción como ejecutable de PyInstaller). Al arrancar, elige un puerto libre
en 127.0.0.1 y lo imprime en stdout como `PORT:<numero>` para que el proceso
principal de Electron lo capture.

Seguridad: Electron genera un token aleatorio por ejecución, se lo pasa al backend en la
variable de entorno `MERGERLAB_TOKEN` y a su ventana por IPC. Toda petición debe traerlo en la
cabecera `X-Auth-Token` (si no, 401) y solo se habilita CORS para los orígenes de la propia app,
para que ninguna web abierta en el navegador pueda usar la API local. Sin la variable el
backend no arranca.

Todas las respuestas que incluyen un mensaje para el usuario (errores 4xx/5xx y el estado de
los trabajos de combinación) llevan tanto `message` en español como, cuando el mensaje es
traducible, `code`/`params`: el frontend traduce con `code`/`params` vía i18next si los
reconoce (ver `src/i18n/backendMessages.js`) y usa `message` como respaldo si no. Este
contrato deliberadamente nunca rompe hacia atrás: `message` siempre está presente.
"""

import hmac
import os
import socket
import sys
import threading
import traceback
import uuid

from flask import Flask, jsonify, request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from merger import (  # noqa: E402
    DEFAULT_SOURCE_COLUMN,
    JOIN_TYPES,
    OUTPUT_CSV_SEPARATORS,
    SUPPORTED_OUTPUT_FORMATS,
    MergeError,
    inspect_csv,
    join_files,
    list_sheets,
    merge_files,
    read_file_columns,
    right_anti_two_files_error,
    validate_output_extension,
    write_output,
)

app = Flask(__name__)

# Orígenes desde los que la ventana de la app llama a la API: `file://` (producción) llega como
# "null"; el servidor de Vite (desarrollo) como http://localhost:5173.
ALLOWED_ORIGINS = {"null", "http://localhost:5173", "http://127.0.0.1:5173"}
AUTH_HEADER = "X-Auth-Token"
# Variable de entorno con el token secreto de esta ejecución; la define Electron al lanzar el
# backend y la lee `main()`. Sin token configurado, `require_token` rechaza todas las peticiones.
TOKEN_ENV_VAR = "MERGERLAB_TOKEN"

jobs = {}
jobs_lock = threading.Lock()


def _error_response(message, status_code, code=None, params=None):
    """Arma un cuerpo de error consistente: `message` en español siempre presente, más
    `code`/`params` opcionales para que el frontend lo traduzca (ver docstring del módulo)."""
    body = {"message": message}
    if code:
        body["code"] = code
        body["params"] = params or {}
    return jsonify(body), status_code


def _csv_separators_from(payload):
    """Extrae de un cuerpo JSON el campo opcional `csv_separators` (`{ruta: separador}`, los
    separadores elegidos a mano por el usuario), descartando las entradas vacías: un archivo sin
    separador indicado se detecta automáticamente en `merger.py`."""
    raw = payload.get("csv_separators") or {}
    return {path: sep for path, sep in raw.items() if isinstance(sep, str) and sep}


def _sheets_from(payload):
    """Extrae de un cuerpo JSON el campo opcional `sheets` (`{ruta: nombre de hoja}`), la hoja de
    Excel/ODS elegida por el usuario para cada archivo; sin entrada se usan todas las hojas."""
    raw = payload.get("sheets") or {}
    return {path: name for path, name in raw.items() if isinstance(name, str) and name}


def _set_job(job_id, **fields):
    """Actualiza (parcialmente) el estado del trabajo `job_id` en `jobs`, bajo `jobs_lock`.

    `fields` son los campos del diccionario de estado a sobrescribir (`status`, `progress`,
    `message`, `code`, `params`, `result_path`); los que no se indiquen quedan como estaban.
    """
    with jobs_lock:
        jobs[job_id].update(fields)


@app.before_request
def handle_preflight():
    """Responde 204 sin cuerpo a las peticiones OPTIONS (preflight de CORS del navegador)."""
    if request.method == "OPTIONS":
        return "", 204


@app.before_request
def require_token():
    """Rechaza con 401 toda petición que no traiga el token secreto de esta ejecución.

    Sin esto, cualquier página web abierta en el navegador podría llamar a la API local (leer
    archivos con `/api/inspect-csv`, escribir con `/api/merge`). El token solo lo conocen el
    proceso de Electron y su ventana. Se compara en tiempo constante.
    """
    if request.method == "OPTIONS":
        return None
    expected = app.config.get("AUTH_TOKEN")
    received = request.headers.get(AUTH_HEADER, "")
    if not expected or not hmac.compare_digest(received.encode(), expected.encode()):
        return _error_response("No autorizado.", 401, code="unauthorized")
    return None


@app.after_request
def add_cors_headers(response):
    # La ventana de Electron hace peticiones cross-origin al backend en 127.0.0.1:<puerto>; solo
    # se habilita CORS para los orígenes de la propia app (ver ALLOWED_ORIGINS), no para
    # cualquier web.
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = f"Content-Type, {AUTH_HEADER}"
    response.headers["Vary"] = "Origin"
    return response


@app.route("/api/health", methods=["GET"])
def health():
    """Comprobación básica de que el backend está arriba y respondiendo."""
    return jsonify({"status": "ok"})


@app.route("/api/merge", methods=["POST"])
def merge():
    """Valida la petición de combinación y lanza el trabajo en un hilo aparte.

    Cuerpo esperado (JSON): `files` (lista de rutas), `output_format`, `output_path`, `mode`
    (`"concat"` o `"join"`), y si `mode` es `"join"` también `join_keys` (objeto
    `{ruta: columna}`) y `join_type` (uno de `JOIN_TYPES`; `"right_anti"` exige exactamente dos
    archivos). Opcionales: `csv_separators` (`{ruta: separador}`, ver
    `_csv_separators_from`) y `output_csv_separator` (`","` por defecto, solo aplica si
    `output_format` es `"csv"`), `sheets` (`{ruta: hoja}` para leer solo una hoja de un Excel),
    `add_source_column` y `source_column_name` (solo modo `"concat"`:
    añade una columna con el archivo de origen de cada fila), y `all_as_text` (leer todas las
    celdas como texto). Devuelve `{"job_id": ...}` con 202 si todo es válido; el
    progreso y el resultado se consultan después con `GET /api/status/<job_id>`. El trabajo en
    sí (lectura, combinación y escritura) lo hace `_run_merge_job` en background para no
    bloquear la petición HTTP mientras se procesan archivos grandes.
    """
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    output_format = (payload.get("output_format") or "").lower()
    output_path = payload.get("output_path")
    mode = (payload.get("mode") or "concat").lower()
    join_keys_by_path = payload.get("join_keys") or {}
    join_type = (payload.get("join_type") or "inner").lower()
    csv_separators = _csv_separators_from(payload)
    output_csv_separator = payload.get("output_csv_separator") or ","
    add_source_column = bool(payload.get("add_source_column"))
    source_column_name = payload.get("source_column_name")
    if not isinstance(source_column_name, str) or not source_column_name.strip():
        source_column_name = DEFAULT_SOURCE_COLUMN
    all_as_text = bool(payload.get("all_as_text"))
    sheets = _sheets_from(payload)

    if not files:
        return _error_response("No se seleccionaron archivos.", 400, code="no_files_selected")
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        return _error_response(
            f"Formato de salida no soportado: '{output_format}'.",
            400,
            code="unsupported_output_format",
            params={"format": output_format},
        )
    if output_format == "csv" and output_csv_separator not in OUTPUT_CSV_SEPARATORS:
        return _error_response(
            f"Separador de salida no soportado: '{output_csv_separator}'.",
            400,
            code="unsupported_output_csv_separator",
            params={"separator": output_csv_separator, "allowed": " ".join(sorted(OUTPUT_CSV_SEPARATORS))},
        )
    if not output_path:
        return _error_response("No se indicó la ruta de guardado.", 400, code="no_output_path")
    try:
        validate_output_extension(output_path, output_format)
    except MergeError as exc:
        return _error_response(str(exc), 400, code=exc.code, params=exc.params)
    if mode not in ("concat", "join"):
        return _error_response(
            f"Modo de combinación no soportado: '{mode}'.",
            400,
            code="unsupported_mode",
            params={"mode": mode},
        )

    join_keys = [join_keys_by_path.get(f) for f in files]

    if mode == "join":
        if len(files) < 2:
            return _error_response(
                "Se necesitan al menos dos archivos para hacer un join.", 400, code="join_min_files"
            )
        if any(not k for k in join_keys):
            return _error_response(
                "Debés indicar una columna clave para cada archivo.", 400, code="missing_join_key"
            )
        if join_type not in JOIN_TYPES:
            return _error_response(
                f"Tipo de join no soportado: '{join_type}'.",
                400,
                code="unsupported_join_type",
                params={"joinType": join_type},
            )
        if join_type == "right_anti" and len(files) != 2:
            exc = right_anti_two_files_error()
            return _error_response(str(exc), 400, code=exc.code, params=exc.params)

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status": "pending",
            "progress": 0,
            "message": "En cola...",
            "code": "queued",
            "params": {},
            "result_path": None,
        }

    thread = threading.Thread(
        target=_run_merge_job,
        args=(
            job_id,
            files,
            output_format,
            output_path,
            mode,
            join_keys,
            join_type,
            csv_separators,
            output_csv_separator,
            add_source_column,
            source_column_name.strip(),
            all_as_text,
            sheets,
        ),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id}), 202


@app.route("/api/columns", methods=["POST"])
def columns():
    """Devuelve las columnas de cada archivo indicado, para poblar el selector de clave del modo join.

    Cuerpo esperado: `{"files": [ruta, ...], "csv_separators": {ruta: separador}}` (el segundo
    campo es opcional, ver `_csv_separators_from`). Devuelve `{"columns": {ruta: [columna, ...]}}`.
    A diferencia de `/api/merge`, esto se resuelve de forma síncrona (leer solo los encabezados/
    columnas es rápido) y no crea un trabajo en background.
    """
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    csv_separators = _csv_separators_from(payload)
    sheets = _sheets_from(payload)

    if not files:
        return _error_response("No se seleccionaron archivos.", 400, code="no_files_selected")

    try:
        result = {path: read_file_columns(path, csv_separators.get(path), sheets.get(path)) for path in files}
    except MergeError as exc:
        return _error_response(str(exc), 400, code=exc.code, params=exc.params)
    except Exception:
        traceback.print_exc()
        return _error_response(
            "No se pudieron leer las columnas de los archivos.", 500, code="columns_read_error"
        )

    return jsonify({"columns": result})


@app.route("/api/sheets", methods=["POST"])
def sheets_of_files():
    """Devuelve los nombres de las hojas de cada archivo indicado, para el selector de hoja.

    Cuerpo esperado: `{"files": [ruta, ...]}`. Devuelve `{"sheets": {ruta: [hoja, ...]}}`; los
    archivos sin hojas (`.csv`) llevan una lista vacía. Un archivo que no se pudo abrir también
    queda con lista vacía: el error real aparecerá al leerlo para combinar.
    """
    payload = request.get_json(silent=True) or {}
    result = {}
    for path in payload.get("files") or []:
        try:
            result[path] = list_sheets(path)
        except Exception:
            result[path] = []
    return jsonify({"sheets": result})


@app.route("/api/inspect-csv", methods=["POST"])
def inspect_csv_files():
    """Devuelve cómo se va a leer cada CSV indicado (separador, codificación y vista previa).

    Cuerpo esperado: `{"files": [ruta, ...], "csv_separators": {ruta: separador}}` (el segundo
    campo es opcional, ver `_csv_separators_from`). Devuelve `{"csv": {ruta: info}}`, donde
    `info` es el resultado de `merger.inspect_csv` o, si ese archivo concreto no se pudo leer,
    `{"error": {message, code, params}}`: el error se informa por archivo para que uno roto no
    impida mostrar la información de los demás.
    """
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    csv_separators = _csv_separators_from(payload)

    result = {}
    for path in files:
        try:
            result[path] = inspect_csv(path, csv_separators.get(path))
        except MergeError as exc:
            result[path] = {"error": {"message": str(exc), "code": exc.code, "params": exc.params}}
        except Exception:
            traceback.print_exc()
            result[path] = {
                "error": {
                    "message": "No se pudieron leer las columnas de los archivos.",
                    "code": "columns_read_error",
                    "params": {},
                }
            }

    return jsonify({"csv": result})


def _run_merge_job(
    job_id,
    files,
    output_format,
    output_path,
    mode,
    join_keys,
    join_type,
    csv_separators,
    output_csv_separator,
    add_source_column=False,
    source_column_name=DEFAULT_SOURCE_COLUMN,
    all_as_text=False,
    sheets=None,
):
    """Ejecuta la combinación completa (lectura + join/concat + escritura) y actualiza `jobs[job_id]`.

    Pensada para correr en un hilo aparte (ver `merge`, que la lanza con `threading.Thread`), no
    devuelve nada: todo el resultado (progreso, estado final, `result_path` o error) se comunica
    escribiendo en `jobs` a través de `_set_job`, que es lo que lee `GET /api/status/<job_id>`.
    La lectura ocupa el 80% del progreso reportado; la escritura, el 20% restante.
    """
    total_steps = len(files) + 1

    def progress_callback(index, total, message, code=None, params=None):
        pct = (index / total_steps) * 80
        _set_job(job_id, status="running", progress=pct, message=message, code=code, params=params or {})

    try:
        _set_job(
            job_id,
            status="running",
            progress=1,
            message="Leyendo archivos...",
            code="reading_files",
            params={},
        )
        if mode == "join":
            combined = join_files(
                files,
                join_keys,
                join_type,
                progress_callback=progress_callback,
                csv_separators=csv_separators,
                all_as_text=all_as_text,
                sheets=sheets,
            )
        else:
            combined = merge_files(
                files,
                progress_callback=progress_callback,
                csv_separators=csv_separators,
                add_source_column=add_source_column,
                source_column_name=source_column_name,
                all_as_text=all_as_text,
                sheets=sheets,
            )

        _set_job(
            job_id,
            status="running",
            progress=85,
            message="Guardando archivo combinado...",
            code="saving_output",
            params={},
        )
        result_path = write_output(combined, output_path, output_format, output_csv_separator)

        _set_job(
            job_id,
            status="done",
            progress=100,
            message="Combinación completada.",
            code="merge_done",
            params={},
            result_path=result_path,
        )
    except MergeError as exc:
        _set_job(job_id, status="error", progress=0, message=str(exc), code=exc.code, params=exc.params)
    except Exception:
        traceback.print_exc()
        _set_job(
            job_id,
            status="error",
            progress=0,
            message="Ocurrió un error inesperado al combinar los archivos.",
            code="unexpected_merge_error",
            params={},
        )


@app.route("/api/status/<job_id>", methods=["GET"])
def status(job_id):
    """Devuelve el estado actual del trabajo `job_id` (sondeado por el frontend cada 350 ms).

    Forma de la respuesta: `{job_id, status, progress, message, code, params, result_path}`,
    donde `status` es `"pending" | "running" | "done" | "error"`. `result_path` solo tiene valor
    cuando `status` es `"done"`.
    """
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return _error_response("Trabajo no encontrado.", 404, code="job_not_found")
    return jsonify({"job_id": job_id, **job})


def _find_free_port():
    """Pide al sistema operativo un puerto TCP libre en 127.0.0.1 (puerto 0 = "elige uno tú")."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    """Punto de entrada del proceso backend: elige puerto, lo anuncia por stdout y sirve la API.

    `waitress` (servidor WSGI de producción) se importa aquí dentro, no arriba del módulo, para
    que el puerto se imprima y quede disponible para Electron lo antes posible, sin esperar a
    que se resuelva el import.
    """
    token = os.environ.get(TOKEN_ENV_VAR)
    if not token:
        sys.exit(f"Falta la variable de entorno {TOKEN_ENV_VAR}: el backend solo se lanza desde la app.")
    app.config["AUTH_TOKEN"] = token

    port = _find_free_port()
    # Electron lee esta línea de stdout para saber a qué puerto conectarse.
    print(f"PORT:{port}", flush=True)

    from waitress import serve

    serve(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
