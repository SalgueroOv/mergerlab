"""Servidor HTTP local que expone la API de combinación de hojas de cálculo.

Se lanza como proceso independiente desde Electron (en dev vía `python server.py`,
en producción como ejecutable de PyInstaller). Al arrancar, elige un puerto libre
en 127.0.0.1 y lo imprime en stdout como `PORT:<numero>` para que el proceso
principal de Electron lo capture.

Todas las respuestas que incluyen un mensaje para el usuario (errores 4xx/5xx y el estado de
los trabajos de combinación) llevan tanto `message` en español como, cuando el mensaje es
traducible, `code`/`params`: el frontend traduce con `code`/`params` vía i18next si los
reconoce (ver `src/i18n/backendMessages.js`) y usa `message` como respaldo si no. Este
contrato deliberadamente nunca rompe hacia atrás: `message` siempre está presente.
"""

import os
import socket
import sys
import threading
import traceback
import uuid

from flask import Flask, jsonify, request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from merger import (  # noqa: E402
    JOIN_TYPES,
    SUPPORTED_OUTPUT_FORMATS,
    MergeError,
    join_files,
    merge_files,
    read_file_columns,
    write_output,
)

app = Flask(__name__)

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


def _set_job(job_id, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return "", 204


@app.after_request
def add_cors_headers(response):
    # La ventana de Electron (file:// o http://localhost:5173) hace peticiones
    # cross-origin al backend en 127.0.0.1:<puerto>; se habilita CORS localmente.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/merge", methods=["POST"])
def merge():
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    output_format = (payload.get("output_format") or "").lower()
    output_path = payload.get("output_path")
    mode = (payload.get("mode") or "concat").lower()
    join_keys_by_path = payload.get("join_keys") or {}
    join_type = (payload.get("join_type") or "inner").lower()

    if not files:
        return _error_response("No se seleccionaron archivos.", 400, code="no_files_selected")
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        return _error_response(
            f"Formato de salida no soportado: '{output_format}'.",
            400,
            code="unsupported_output_format",
            params={"format": output_format},
        )
    if not output_path:
        return _error_response("No se indicó la ruta de guardado.", 400, code="no_output_path")
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
        args=(job_id, files, output_format, output_path, mode, join_keys, join_type),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id}), 202


@app.route("/api/columns", methods=["POST"])
def columns():
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []

    if not files:
        return _error_response("No se seleccionaron archivos.", 400, code="no_files_selected")

    try:
        result = {path: read_file_columns(path) for path in files}
    except MergeError as exc:
        return _error_response(str(exc), 400, code=exc.code, params=exc.params)
    except Exception:
        traceback.print_exc()
        return _error_response(
            "No se pudieron leer las columnas de los archivos.", 500, code="columns_read_error"
        )

    return jsonify({"columns": result})


def _run_merge_job(job_id, files, output_format, output_path, mode, join_keys, join_type):
    # La lectura ocupa el 80% del progreso reportado; la escritura, el 20% restante.
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
            combined = join_files(files, join_keys, join_type, progress_callback=progress_callback)
        else:
            combined = merge_files(files, progress_callback=progress_callback)

        _set_job(
            job_id,
            status="running",
            progress=85,
            message="Guardando archivo combinado...",
            code="saving_output",
            params={},
        )
        result_path = write_output(combined, output_path, output_format)

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
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return _error_response("Trabajo no encontrado.", 404, code="job_not_found")
    return jsonify({"job_id": job_id, **job})


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = _find_free_port()
    # Electron lee esta línea de stdout para saber a qué puerto conectarse.
    print(f"PORT:{port}", flush=True)

    from waitress import serve

    serve(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
