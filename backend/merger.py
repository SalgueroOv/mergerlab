"""Lógica de combinación de hojas de cálculo (sin dependencias de red/HTTP)."""

import codecs
import csv
import io
import numbers
import os
from collections import Counter
from datetime import datetime

import numpy as np
import pandas as pd

SUPPORTED_INPUT_EXTENSIONS = {".xlsx", ".xls", ".csv", ".ods"}
SUPPORTED_OUTPUT_FORMATS = {"xlsx", "xls", "csv", "ods"}
JOIN_TYPES = {"inner", "left", "right", "outer", "left_anti", "right_anti"}
# Tipos "anti": devuelven las filas de un archivo cuya clave NO aparece en los demás (ver
# `_anti_join`), en vez de cruzar columnas como los joins de pandas.
ANTI_JOIN_TYPES = {"left_anti", "right_anti"}
# Nombre por defecto de la columna que indica de qué archivo viene cada fila al apilar.
DEFAULT_SOURCE_COLUMN = "archivo_origen"
# Firma de los archivos OLE2 (Excel .xls auténtico); si un `.xls` no empieza así, en realidad es
# HTML o texto (p. ej. un "informe" exportado por un programa) y se lee con `_read_fake_xls`.
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# Motor de lectura de pandas para cada extensión de hoja de cálculo.
_EXCEL_ENGINES = {".xlsx": "openpyxl", ".xls": "xlrd", ".ods": "odf"}

# Límite de filas del formato .xlsx (1.048.576, incluye la fila de encabezado).
XLSX_MAX_ROWS = 1048576 - 1

# Límite de filas del formato .xls clásico (65536 filas, incluye la fila de encabezado).
XLS_MAX_ROWS = 65536 - 1

# Separadores que se prueban al detectar automáticamente el de un CSV, en orden de preferencia
# para desempatar (ver `detect_csv_separator`).
CSV_SEPARATOR_CANDIDATES = (",", ";", "\t", "|")
# Codificaciones que se prueban al leer un CSV, en orden: UTF-8 (con o sin BOM, lo habitual en
# Google Sheets, LibreOffice y Excel "CSV UTF-8") y Windows-1252 (lo que guarda Excel en Windows
# con "CSV (delimitado por comas)" en configuraciones regionales de Europa occidental/Latinoamérica).
CSV_ENCODINGS = ("utf-8-sig", "cp1252")
# Separadores que se permiten para el CSV de salida.
OUTPUT_CSV_SEPARATORS = {",", ";"}
# Cuánto del principio del archivo se analiza para detectar codificación y separador.
_CSV_SAMPLE_BYTES = 64 * 1024
_CSV_SAMPLE_MAX_ROWS = 100
# Proporción mínima de filas de la muestra que deben tener la misma cantidad de columnas que el
# encabezado para considerar la detección del separador "segura".
_CSV_CONFIDENT_CONSISTENCY = 0.9
# Filas de datos que devuelve `inspect_csv` como vista previa.
CSV_PREVIEW_ROWS = 3

# Textos del informe de la combinación (ver `build_report`), en español. Son el respaldo de los
# que manda el frontend en `report_labels` (ya traducidos al idioma de la app): cualquier clave
# que no llegue, o que llegue con un valor no válido, usa el texto de aquí. Sus claves son además
# la lista cerrada de claves que acepta `server.py` en `report_labels`.
DEFAULT_REPORT_LABELS = {
    # Nombre de la hoja del informe (xlsx/ods/xls) y sufijo del archivo aparte (csv).
    "sheetName": "Informe",
    "fileSuffix": "informe",
    # Bloque resumen (etiqueta / valor).
    "generatedAt": "Fecha y hora",
    "mode": "Modo de combinación",
    "modeConcat": "Apilar filas",
    "modeJoin": "Combinar por clave (join)",
    "joinType": "Tipo de join",
    "joinInner": "Inner join (intersección)",
    "joinLeft": "Left join (izquierda)",
    "joinRight": "Right join (derecha)",
    "joinOuter": "Outer join (completo)",
    "joinLeftAnti": "Left anti join (sin coincidencia en los demás)",
    "joinRightAnti": "Right anti join (sin coincidencia en el primero)",
    "resultRows": "Filas del resultado",
    "resultColumns": "Columnas del resultado",
    "duplicatesRemoved": "Filas duplicadas quitadas",
    "addSourceColumn": "Añadir columna con nombre de archivo origen",
    "allAsText": "Leer todas las columnas como texto (conserva ceros a la izquierda)",
    "removeDuplicates": "Quitar filas duplicadas",
    "yes": "Sí",
    "no": "No",
    # Tabla por archivo.
    "file": "Archivo",
    "sheet": "Hoja",
    "allSheets": "Todas",
    "rowsRead": "Filas leídas",
    "keyColumn": "Columna clave",
    "unmatchedRows": "Filas sin coincidencia",
    "emptyKeyRows": "Filas con clave vacía",
}
# Clave de `DEFAULT_REPORT_LABELS` con el nombre de cada tipo de join.
_JOIN_TYPE_LABEL_KEYS = {
    "inner": "joinInner",
    "left": "joinLeft",
    "right": "joinRight",
    "outer": "joinOuter",
    "left_anti": "joinLeftAnti",
    "right_anti": "joinRightAnti",
}
# Reglas de Excel para los nombres de hoja: como mucho 31 caracteres y sin estos caracteres.
_EXCEL_SHEET_NAME_MAX = 31
_EXCEL_SHEET_NAME_INVALID = set("[]:*?/\\")
# Caracteres no válidos en nombres de archivo de Windows (el SO más restrictivo de los
# soportados). Es el mismo conjunto que quita `sanitizeFileName` en `src/utils.js`: el frontend
# calcula la misma ruta del informe CSV para preguntar antes de sobrescribirlo.
_INVALID_FILENAME_CHARS = set('\\/:*?"<>|')
# Nombre de la hoja de datos al escribir con `DataFrame.to_excel` (xlsx/ods): el de pandas por
# defecto, que es el que se usa desde siempre.
_DATA_SHEET_NAME = "Sheet1"
# Nombre de la hoja de datos en `.xls` (ver `_write_xls`).
_XLS_DATA_SHEET_NAME = "Combinado"


class MergeError(Exception):
    """Error esperado durante la combinación, con un mensaje apto para mostrar al usuario.

    Además del mensaje en español (`str(exc)`, usado como respaldo si el frontend no reconoce
    `code`, o si `code` es `None` porque el mensaje incluye texto de terceros no traducible —
    ver `detail` en `_read_spreadsheet`), lleva un `code` opcional que el frontend traduce vía
    i18next (namespace `backend.*`, ver `src/i18n/backendMessages.js`) usando `params`.
    """

    def __init__(self, message, code=None, params=None):
        super().__init__(message)
        self.code = code
        self.params = params or {}


def _extension_of(path):
    """Devuelve la extensión de `path` en minúsculas, incluyendo el punto (p. ej. `.xlsx`)."""
    return os.path.splitext(path)[1].lower()


def _unsupported_format_error(ext, path):
    """Construye (sin lanzarlo) el `MergeError` de formato de entrada no soportado.

    Es una función aparte porque el mismo caso se comprueba en tres sitios distintos
    (`merge_files`, `join_files` y `_read_spreadsheet`) y así se evita repetir el mensaje y los
    `code`/`params` en cada uno.
    """
    return MergeError(
        f"Formato no soportado '{ext}' en '{os.path.basename(path)}'. "
        f"Formatos permitidos: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}.",
        code="unsupported_input_format",
        params={
            "ext": ext,
            "filename": os.path.basename(path),
            "allowed": ", ".join(sorted(SUPPORTED_INPUT_EXTENSIONS)),
        },
    )


def _validate_csv_separator(separator, path):
    """Comprueba que un separador de CSV elegido a mano sea un único carácter utilizable.

    Se excluyen las comillas dobles (son el carácter de entrecomillado del CSV) y los saltos de
    línea (separan filas, no columnas). Lanza `MergeError` si no es válido.
    """
    if len(separator) != 1 or separator in ('"', "\r", "\n"):
        raise MergeError(
            f"Separador no válido para '{os.path.basename(path)}': '{separator}'. "
            f"Debe ser un único carácter distinto de comillas.",
            code="invalid_csv_separator",
            params={"filename": os.path.basename(path), "separator": separator},
        )


def _read_csv_sample(path):
    """Lee el principio de un CSV y devuelve `(texto, codificación)`.

    Prueba las codificaciones de `CSV_ENCODINGS` en orden sobre los primeros `_CSV_SAMPLE_BYTES`
    bytes (con un decodificador incremental, para que un carácter de varios bytes cortado justo
    en el límite de la muestra no cuente como error). Si ninguna sirve, lanza `MergeError` con
    `code="csv_encoding_error"`.
    """
    with open(path, "rb") as fh:
        raw = fh.read(_CSV_SAMPLE_BYTES)

    for encoding in CSV_ENCODINGS:
        try:
            text = codecs.getincrementaldecoder(encoding)().decode(raw, final=False)
        except UnicodeDecodeError:
            continue
        return text, encoding

    raise _csv_encoding_error(path)


def _csv_encoding_error(path):
    """Construye (sin lanzarlo) el `MergeError` de CSV con una codificación que no se reconoce."""
    return MergeError(
        f"No se pudo leer '{os.path.basename(path)}': el texto usa una codificación no reconocida. "
        f"Guárdalo de nuevo como 'CSV UTF-8' e inténtalo otra vez.",
        code="csv_encoding_error",
        params={"filename": os.path.basename(path)},
    )


def _sample_rows(text, truncated):
    """Parte la muestra de texto de un CSV en líneas, descartando la última si la muestra se cortó
    a mitad de archivo (puede ser una línea incompleta) y las líneas vacías."""
    lines = text.splitlines()
    if truncated and len(lines) > 1:
        lines = lines[:-1]
    return [line for line in lines if line.strip()][:_CSV_SAMPLE_MAX_ROWS]


def detect_csv_separator(lines):
    """Detecta el separador de un CSV a partir de sus primeras líneas.

    Para cada candidato de `CSV_SEPARATOR_CANDIDATES` se parsean las líneas con `csv.reader`
    (que respeta los campos entre comillas, p. ej. `"Paz, Juan"`) y se cuenta cuántas columnas
    da cada fila. Un candidato solo es válido si el encabezado queda con más de una columna; entre
    los válidos gana el que tiene más filas con el mismo número de columnas que el encabezado, y
    si empatan, el que da más columnas y luego el que aparece antes en la lista de candidatos.

    Devuelve `(separador, seguro)`. `seguro` es `False` cuando conviene que el usuario lo revise:
    la consistencia del ganador está por debajo de `_CSV_CONFIDENT_CONSISTENCY`, otro candidato
    empata con él, o ningún candidato separa el encabezado pero este contiene alguno de los
    caracteres candidatos. Si ningún candidato sirve se devuelve la coma (archivo de una sola
    columna).
    """
    if not lines:
        return ",", True

    scored = []
    for order, candidate in enumerate(CSV_SEPARATOR_CANDIDATES):
        counts = [len(row) for row in csv.reader(lines, delimiter=candidate)]
        header_count = counts[0]
        if header_count <= 1:
            continue
        consistency = sum(1 for c in counts if c == header_count) / len(counts)
        scored.append((consistency, header_count, -order, candidate))

    if not scored:
        header_has_candidate = any(c in lines[0] for c in CSV_SEPARATOR_CANDIDATES)
        return ",", not header_has_candidate

    scored.sort(reverse=True)
    best = scored[0]
    tied = len(scored) > 1 and scored[1][:2] == best[:2]
    confident = best[0] >= _CSV_CONFIDENT_CONSISTENCY and not tied
    return best[3], confident


def _csv_format(path, separator=None):
    """Decide cómo leer un CSV: devuelve `(separador, codificación, seguro)`.

    Si `separator` viene indicado (elección manual del usuario) se valida y se usa tal cual, con
    `seguro=True`; si es `None` se detecta con `detect_csv_separator`.
    """
    text, encoding = _read_csv_sample(path)
    if separator is not None:
        _validate_csv_separator(separator, path)
        return separator, encoding, True

    truncated = os.path.getsize(path) > _CSV_SAMPLE_BYTES
    detected, confident = detect_csv_separator(_sample_rows(text, truncated))
    return detected, encoding, confident


def _read_csv(path, separator=None, dtype=None, nrows=None):
    """Lee un CSV detectando la codificación y, si `separator` es `None`, también el separador.

    `dtype` se pasa tal cual a `pd.read_csv` (ver `_dtype_for`).

    La codificación se decide sobre una muestra del principio del archivo (ver
    `_read_csv_sample`); si más adelante aparece un byte que no encaja con ella, se reintenta con
    la siguiente de `CSV_ENCODINGS`.
    """
    separator, encoding, _ = _csv_format(path, separator)

    for candidate in CSV_ENCODINGS[CSV_ENCODINGS.index(encoding) :]:
        try:
            return pd.read_csv(path, sep=separator, encoding=candidate, dtype=dtype, nrows=nrows)
        except UnicodeDecodeError:
            continue
    raise _csv_encoding_error(path)


def _dtype_for(key=None, all_as_text=False):
    """Devuelve el `dtype` de pandas para leer un archivo sin perder información.

    Con `all_as_text` todas las columnas se leen como texto. Si no, solo la columna clave `key`
    (si hay): leída como número, una clave con celdas vacías pasa a decimales (`1` -> `1.0`, y no
    cruza con `1` de otro archivo) y pierde los ceros a la izquierda (`00123` -> `123`).
    """
    if all_as_text:
        return str
    if key:
        return {key: str}
    return None


def _read_fake_xls(path, csv_separator, dtype, nrows):
    """Lee un `.xls` que no es un Excel auténtico: HTML (primera tabla) o texto delimitado (CSV).

    Muchos programas exportan HTML o texto con extensión `.xls`; `xlrd` los rechaza como
    corruptos. Si el contenido parece HTML se lee la primera tabla con `pandas.read_html`; si no,
    se trata como CSV (con la detección habitual de separador y codificación).
    """
    with open(path, "rb") as fh:
        raw = fh.read()

    head = raw[:2048].lstrip().lower()
    if head.startswith((b"<!doctype", b"<html", b"<table", b"<?xml", b"\xef\xbb\xbf<")) or b"<table" in head:
        for encoding in CSV_ENCODINGS:
            try:
                text = raw.decode(encoding)
            except UnicodeDecodeError:
                continue
            break
        else:
            raise _csv_encoding_error(path)
        try:
            tables = pd.read_html(io.StringIO(text))
        except ValueError as exc:
            raise _file_read_error(path, exc) from exc
        frame = tables[0]
        if dtype is str:
            frame = frame.astype(str)
        elif isinstance(dtype, dict):
            frame = frame.astype({col: str for col in dtype if col in frame.columns})
        return [frame.head(0) if nrows == 0 else frame]

    return [_read_csv(path, csv_separator, dtype, nrows)]


def list_sheets(path):
    """Devuelve los nombres de las hojas de un archivo de Excel/ODS (lista vacía para el resto).

    Un `.csv` no tiene hojas, y un `.xls` falso (HTML o texto, ver `_read_fake_xls`) tampoco.
    """
    ext = _extension_of(path)
    if ext not in _EXCEL_ENGINES:
        return []
    if not os.path.exists(path):
        raise MergeError(f"El archivo no existe: {path}", code="file_not_found", params={"path": path})
    if ext == ".xls" and not _is_real_xls(path):
        return []
    try:
        with pd.ExcelFile(path, engine=_EXCEL_ENGINES[ext]) as workbook:
            return [str(name) for name in workbook.sheet_names]
    except Exception as exc:
        raise _file_read_error(path, exc) from exc


def _is_real_xls(path):
    """`True` si `path` empieza con la firma OLE2 de un Excel `.xls` auténtico."""
    with open(path, "rb") as fh:
        return fh.read(len(_OLE2_MAGIC)) == _OLE2_MAGIC


def _read_spreadsheet(path, csv_separator=None, key=None, all_as_text=False, sheet=None, nrows=None):
    """Lee `path` y devuelve una lista de DataFrames, una por cada hoja del archivo.

    Para `.csv` (que no tiene hojas) la lista siempre tiene un único elemento; se lee con
    `csv_separator` si se indica, o detectando el separador automáticamente si es `None` (ver
    `_read_csv`). El motor de lectura de pandas se elige según la extensión: `openpyxl` para
    `.xlsx`, `xlrd` para `.xls` y `odf` para `.ods`. Lanza `MergeError` si el archivo no existe,
    tiene un formato no soportado o pandas no consigue leerlo (corrupto, protegido con
    contraseña, etc.).

    `key` y `all_as_text` controlan qué columnas se leen como texto (ver `_dtype_for`). `sheet`
    (nombre de hoja) limita la lectura a esa hoja de un Excel/ODS; `None` lee todas. `nrows=0` lee
    solo los encabezados (más rápido, para listar columnas).
    """
    if not os.path.exists(path):
        raise MergeError(f"El archivo no existe: {path}", code="file_not_found", params={"path": path})

    ext = _extension_of(path)
    dtype = _dtype_for(key, all_as_text)

    try:
        if ext == ".csv":
            return [_read_csv(path, csv_separator, dtype, nrows)]
        if ext == ".xls" and not _is_real_xls(path):
            return _read_fake_xls(path, csv_separator, dtype, nrows)
        if ext in _EXCEL_ENGINES:
            sheets = pd.read_excel(
                path,
                sheet_name=sheet if sheet else None,
                engine=_EXCEL_ENGINES[ext],
                dtype=dtype,
                nrows=nrows,
            )
            return [sheets] if sheet else list(sheets.values())
    except MergeError:
        raise
    except ValueError as exc:
        if sheet and f"'{sheet}'" in str(exc):
            raise MergeError(
                f"La hoja '{sheet}' no existe en '{os.path.basename(path)}'.",
                code="sheet_not_found",
                params={"sheet": sheet, "filename": os.path.basename(path)},
            ) from exc
        raise _file_read_error(path, exc) from exc
    except Exception as exc:
        raise _file_read_error(path, exc) from exc

    raise _unsupported_format_error(ext, path)


def _file_read_error(path, exc):
    """Construye (sin lanzarlo) el `MergeError` de archivo que pandas no consiguió leer.

    `detail` es el texto crudo de una excepción de pandas/openpyxl/xlrd/odfpy — casi siempre en
    inglés y no traducible, pero útil para diagnosticar el problema real.
    """
    return MergeError(
        f"No se pudo leer '{os.path.basename(path)}'. El archivo puede estar corrupto, "
        f"protegido con contraseña o dañado. Detalle: {exc}",
        code="file_read_error",
        params={"filename": os.path.basename(path), "detail": str(exc)},
    )


def inspect_csv(path, separator=None):
    """Analiza un CSV para mostrarle al usuario cómo se va a leer, antes de combinar.

    Usa la misma detección que la combinación (`_csv_format`), así que el resultado coincide con
    lo que después hace `merge_files`/`join_files` con ese archivo. Devuelve un diccionario con:
    `separator` (el que se usará), `encoding`, `confident` (`False` si la detección automática
    no está segura, ver `detect_csv_separator`), `columns` (nombres de columna) y `rows` (hasta
    `CSV_PREVIEW_ROWS` filas de datos como texto, para la vista previa).
    """
    if not os.path.exists(path):
        raise MergeError(f"El archivo no existe: {path}", code="file_not_found", params={"path": path})

    try:
        separator, encoding, confident = _csv_format(path, separator)
        preview = pd.read_csv(
            path,
            sep=separator,
            encoding=encoding,
            nrows=CSV_PREVIEW_ROWS,
            dtype=str,
            keep_default_na=False,
        )
    except MergeError:
        raise
    except Exception as exc:
        raise _file_read_error(path, exc) from exc

    return {
        "separator": separator,
        "encoding": encoding,
        "confident": confident,
        "columns": [str(col) for col in preview.columns],
        "rows": preview.values.tolist(),
    }


def _unique_column_name(name, taken):
    """Devuelve `name`, o `name_2`, `name_3`... si ya está en `taken` (conjunto de nombres usados)."""
    candidate = name
    suffix = 2
    while candidate in taken:
        candidate = f"{name}_{suffix}"
        suffix += 1
    return candidate


def _strip_column_names(df):
    """Devuelve `df` con los espacios de los extremos de los nombres de columna recortados.

    Los nombres que no son texto (p. ej. un encabezado numérico) se dejan como están.
    """
    return df.rename(columns=lambda col: col.strip() if isinstance(col, str) else col)


def merge_files(
    file_paths,
    progress_callback=None,
    csv_separators=None,
    add_source_column=False,
    source_column_name=DEFAULT_SOURCE_COLUMN,
    all_as_text=False,
    sheets=None,
    stats=None,
):
    """Lee todos los archivos indicados (en el orden dado) y los concatena en un único DataFrame.

    Las columnas se alinean por nombre (unión); las celdas sin correspondencia quedan vacías.
    Si un archivo tiene varias hojas, se combinan todas sus hojas también, salvo que `sheets`
    (`{ruta: nombre de hoja}`) indique una hoja concreta para ese archivo.

    Si se indica, `progress_callback` se invoca tras leer cada archivo con la firma
    `(index, total, message, code, params)`, donde `index` va de 1 a `total` (número de
    archivos), `message` es el texto en español ya formado y `code`/`params` son la versión
    traducible del mismo mensaje (ver `MergeError` para el contrato `code`/`params`).

    `csv_separators` es un diccionario opcional `{ruta: separador}` con el separador elegido a
    mano para algunos CSV; los que no aparecen (o tienen `None`) se detectan automáticamente.

    Con `add_source_column` se antepone una columna llamada `source_column_name` con el nombre
    (con extensión) del archivo de donde salió cada fila; si ese nombre ya lo usa una columna de
    los datos, se le añade un sufijo (`_2`, `_3`...) para no pisarla. Con `all_as_text` todas las
    celdas se leen como texto (conserva ceros a la izquierda y evita `1` -> `1.0`).

    Los espacios al principio y al final de los nombres de columna se ignoran, para que
    `Nombre` y `Nombre ` se apilen en una sola columna. Las columnas enteras se mantienen como
    enteros (`Int64`) aunque falten en otros archivos, en vez de pasar a decimales (`1` -> `1.0`).

    Si se añadió la columna de origen, su nombre real (con el sufijo, si lo lleva) queda en
    `resultado.attrs["source_column"]`, para que quien llama pueda localizarla sin adivinar el
    sufijo (p. ej. para ignorarla en `drop_duplicate_rows`). Sin columna de origen, esa clave no
    existe en `attrs`.

    Si se pasa `stats` (un diccionario), se le añade `stats["files"]`: una lista, en el orden de
    `file_paths`, con `{"name", "sheet", "rowsRead"}` de cada archivo (ver `build_result`). Se
    calcula con lo que ya se leyó para combinar, sin volver a abrir ningún archivo.
    """
    if not file_paths:
        raise MergeError("No se proporcionaron archivos para combinar.", code="no_files_selected")

    csv_separators = csv_separators or {}
    sheets = sheets or {}
    frames = []
    frame_sources = []
    file_stats = []
    total = len(file_paths)

    for index, path in enumerate(file_paths, start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise _unsupported_format_error(ext, path)

        rows_read = 0
        for sheet_df in _read_spreadsheet(
            path, csv_separators.get(path), all_as_text=all_as_text, sheet=sheets.get(path)
        ):
            rows_read += len(sheet_df)
            if sheet_df.shape[1] > 0:
                frames.append(_nullable_integers(_strip_column_names(sheet_df)))
                frame_sources.append(os.path.basename(path))
        file_stats.append(_file_stats(path, sheets.get(path), rows_read))

        if progress_callback:
            filename = os.path.basename(path)
            progress_callback(
                index,
                total,
                f"Leído {filename} ({index}/{total})",
                code="read_file_progress",
                params={"filename": filename, "index": index, "total": total},
            )

    if not frames:
        raise MergeError("Los archivos seleccionados no contienen datos para combinar.", code="no_data")

    column_name = None
    if add_source_column:
        taken = {col for frame in frames for col in frame.columns}
        column_name = _unique_column_name(source_column_name or DEFAULT_SOURCE_COLUMN, taken)
        frames = [
            frame.assign(**{column_name: source}).loc[:, [column_name, *frame.columns]]
            for frame, source in zip(frames, frame_sources)
        ]

    result = pd.concat(frames, ignore_index=True, sort=False)
    if column_name is not None:
        result.attrs["source_column"] = column_name
    if stats is not None:
        stats["files"] = file_stats
    return result


def _file_stats(path, sheet, rows_read):
    """Arma la entrada de `stats["files"]` de un archivo (ver `build_result`)."""
    return {"name": os.path.basename(path), "sheet": sheet or None, "rowsRead": int(rows_read)}


def _nullable_integers(df):
    """Devuelve `df` con las columnas enteras convertidas a `Int64` (entero que admite vacíos).

    Al apilar archivos, una columna entera que falta en otro archivo se rellenaría con vacíos y
    pandas la pasaría a decimales (`1` -> `1.0`); con `Int64` se queda como entero.
    """
    integer_columns = [c for c in df.columns if pd.api.types.is_integer_dtype(df[c].dtype)]
    if not integer_columns:
        return df
    return df.astype({c: "Int64" for c in integer_columns})


def _read_single_dataframe(path, csv_separator=None, key=None, all_as_text=False, sheet=None, nrows=None):
    """Lee un archivo y devuelve un único DataFrame (concatenando sus hojas si tiene varias)."""
    frames = _read_spreadsheet(path, csv_separator, key, all_as_text, sheet, nrows)
    if len(frames) == 1:
        return frames[0]
    return pd.concat(frames, ignore_index=True, sort=False)


def read_file_columns(path, csv_separator=None, sheet=None):
    """Devuelve los nombres de columna de un archivo (unión de todas sus hojas, o solo `sheet`).

    `csv_separator` solo aplica a `.csv`: `None` detecta el separador automáticamente. Solo se
    leen los encabezados (`nrows=0`), no el archivo entero.
    """
    df = _read_single_dataframe(path, csv_separator, sheet=sheet, nrows=0)
    return [str(col) for col in df.columns]


def _stringify_key_column(series):
    """Convierte a texto los valores no nulos de una columna clave (recorta espacios), sin tocar
    los nulos. Evita que un join falle en silencio por diferencias de tipo entre archivos
    (ej. la clave llega como int64 en un archivo y como texto en otro)."""
    result = series.astype(object)
    mask = series.notna()
    result[mask] = series[mask].astype(str).str.strip()
    return result


def join_files(
    file_paths,
    join_keys,
    join_type="inner",
    progress_callback=None,
    csv_separators=None,
    all_as_text=False,
    sheets=None,
    stats=None,
):
    """Combina los archivos indicados uniéndolos por una columna clave (equivalente a un JOIN SQL).

    A diferencia de merge_files (que apila filas una debajo de otra), acá cada archivo aporta
    columnas nuevas a las filas que comparten el mismo valor de clave. `join_keys` es una lista
    con un nombre de columna por archivo, en el mismo orden que `file_paths`: cada archivo puede
    usar una columna con un nombre distinto (por ejemplo "ID_Cliente" en uno y "Codigo Cliente"
    en otro) para representar la misma clave lógica.

    Con más de dos archivos, la combinación se aplica en cadena y en el orden dado. La clave del
    primer archivo se usa como columna "canónica" del resultado acumulado; en cada paso siguiente
    se hace un merge por `left_on`/`right_on` (canónica vs. la clave de ese archivo) y luego se
    completa la columna canónica con el valor no vacío de cualquiera de las dos (esto también
    cubre los huecos que deja un left/right/outer join cuando no hay coincidencia), descartando
    la columna de clave duplicada. La columna clave final del resultado conserva el nombre de la
    clave elegida en el primer archivo.

    Las columnas con el mismo nombre en más de un archivo (aparte de su propia columna clave) se
    distinguen agregando el nombre del archivo de origen entre paréntesis.

    `progress_callback`, si se indica, se invoca tras combinar cada archivo con la misma firma
    que en `merge_files`: `(index, total, message, code, params)`. `csv_separators` funciona
    igual que en `merge_files`.

    La columna clave de cada archivo se lee siempre como texto (así no pierde ceros a la izquierda
    ni se convierte en decimal por tener celdas vacías); con `all_as_text` se leen como texto
    todas las columnas.

    Los tipos "anti" no cruzan columnas: devuelven las filas de un único archivo de origen cuya
    clave no aparece en los demás (ver `_anti_join`). Con `"left_anti"` el origen es el primer
    archivo y se descartan sus filas cuya clave esté en CUALQUIERA de los demás archivos (vale
    con dos o más). Con `"right_anti"` el origen es el segundo archivo y se compara solo con el
    primero, así que exige exactamente dos archivos (si no, `MergeError` con
    `code="right_anti_two_files"`). El resultado tiene solo las columnas del archivo de origen,
    en su orden original, y sus filas en el orden del archivo; puede quedar sin filas (no es un
    error: se escribe solo con los encabezados). Una clave vacía no coincide con nada: las filas
    del archivo de origen con la clave vacía se conservan, y las claves vacías de los demás
    archivos no cuentan como coincidencia.

    Si se pasa `stats` (un diccionario), se le añade `stats["files"]` igual que en `merge_files`,
    y cada elemento lleva además `keyColumn`, `unmatchedRows` y `emptyKeyRows` (ver
    `_key_match_stats`), calculados sobre las claves ya normalizadas, sin releer los archivos.
    """
    if not file_paths:
        raise MergeError("No se proporcionaron archivos para combinar.", code="no_files_selected")
    if len(file_paths) < 2:
        raise MergeError("Se necesitan al menos dos archivos para hacer un join.", code="join_min_files")
    if join_type not in JOIN_TYPES:
        raise MergeError(
            f"Tipo de combinación no soportado: '{join_type}'. "
            f"Tipos permitidos: {', '.join(sorted(JOIN_TYPES))}.",
            code="unsupported_join_type_detail",
            params={"joinType": join_type, "allowed": ", ".join(sorted(JOIN_TYPES))},
        )
    if join_type == "right_anti" and len(file_paths) != 2:
        raise right_anti_two_files_error()
    if not join_keys or len(join_keys) != len(file_paths) or any(not k for k in join_keys):
        raise MergeError("Debés indicar una columna clave para cada archivo.", code="missing_join_key")

    csv_separators = csv_separators or {}
    sheets = sheets or {}
    total = len(file_paths)
    result = None
    canonical_key = None
    # Solo para los tipos anti: (DataFrame, clave) de cada archivo leído, en orden.
    anti_frames = []
    # Solo si se piden `stats`: entrada de cada archivo y su columna clave ya normalizada.
    file_stats = []
    key_columns = []

    for index, (path, key) in enumerate(zip(file_paths, join_keys), start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise _unsupported_format_error(ext, path)

        df = _read_single_dataframe(
            path, csv_separators.get(path), key=key, all_as_text=all_as_text, sheet=sheets.get(path)
        )

        if key not in df.columns:
            raise MergeError(
                f"La columna clave '{key}' no existe en '{os.path.basename(path)}'. "
                f"Columnas disponibles: {', '.join(str(c) for c in df.columns)}.",
                code="join_key_not_found",
                params={
                    "key": key,
                    "filename": os.path.basename(path),
                    "columns": ", ".join(str(c) for c in df.columns),
                },
            )

        df = df.copy()
        df[key] = _stringify_key_column(df[key])
        if stats is not None:
            file_stats.append({**_file_stats(path, sheets.get(path), len(df)), "keyColumn": key})
            key_columns.append(df[key])

        if join_type in ANTI_JOIN_TYPES:
            anti_frames.append((df, key))
        elif result is None:
            result = df
            canonical_key = key
        else:
            label = os.path.splitext(os.path.basename(path))[0]
            overlap = [c for c in df.columns if c != key and c in result.columns]
            if overlap:
                df = df.rename(columns={c: f"{c} ({label})" for c in overlap})

            if key == canonical_key:
                result = pd.merge(result, df, on=canonical_key, how=join_type)
            else:
                result = pd.merge(result, df, left_on=canonical_key, right_on=key, how=join_type)
                result[canonical_key] = result[canonical_key].where(
                    result[canonical_key].notna(), result[key]
                )
                result = result.drop(columns=[key])

        if progress_callback:
            filename = os.path.basename(path)
            progress_callback(
                index,
                total,
                f"Combinado {filename} ({index}/{total})",
                code="join_file_progress",
                params={"filename": filename, "index": index, "total": total},
            )

    if join_type in ANTI_JOIN_TYPES:
        source_index = 0 if join_type == "left_anti" else 1
        result = _anti_join(anti_frames, source_index)

    if result is None or result.shape[1] == 0:
        raise MergeError("Los archivos seleccionados no contienen datos para combinar.", code="no_data")

    if stats is not None:
        for entry, counts in zip(file_stats, _key_match_stats(key_columns)):
            entry.update(counts)
        stats["files"] = file_stats
    return result


def _empty_key_mask(keys):
    """Máscara de las claves vacías de una columna clave ya normalizada por
    `_stringify_key_column`: nulas, o texto vacío tras recortar espacios."""
    return keys.isna() | (keys == "")


def _key_match_stats(key_columns):
    """Cuenta, para cada columna clave de `key_columns` (una por archivo, en orden y ya
    normalizada por `_stringify_key_column`), cuántas filas no tienen coincidencia y cuántas
    tienen la clave vacía. Devuelve una lista de `{"unmatchedRows", "emptyKeyRows"}`.

    `unmatchedRows` son las filas con clave NO vacía que no aparece en NINGÚN otro archivo (da
    igual el tipo de join: es una medida de los datos de entrada, no del resultado). Las claves
    vacías no coinciden con nada (mismo criterio que `_anti_join`), así que no cuentan ahí sino en
    `emptyKeyRows`. Para no comparar cada archivo con todos los demás, se cuenta en cuántos
    archivos distintos aparece cada clave: una fila no tiene coincidencia si su clave solo está en
    su propio archivo.
    """
    present = [set(keys[~_empty_key_mask(keys)]) for keys in key_columns]
    files_per_key = Counter(key for keys in present for key in keys)
    shared = {key for key, count in files_per_key.items() if count > 1}

    result = []
    for keys in key_columns:
        empty = _empty_key_mask(keys)
        unmatched = ~empty & ~keys.isin(shared)
        result.append({"unmatchedRows": int(unmatched.sum()), "emptyKeyRows": int(empty.sum())})
    return result


def build_result(
    file_paths,
    mode="concat",
    join_keys=None,
    join_type="inner",
    progress_callback=None,
    csv_separators=None,
    add_source_column=False,
    source_column_name=DEFAULT_SOURCE_COLUMN,
    all_as_text=False,
    sheets=None,
    remove_duplicates=False,
):
    """Combina los archivos (apilar o join) y calcula sus estadísticas, sin escribir nada.

    Es el núcleo común de la combinación: lo usa `_run_merge_job` en `server.py` antes de
    escribir el resultado, y sirve igual para cualquier otro uso que necesite el resultado sin
    guardarlo (p. ej. una vista previa). Devuelve `(df, stats)`:

    - `df`: el resultado final, ya sin filas duplicadas si `remove_duplicates` (ver
      `drop_duplicate_rows`, que ignora la columna de archivo de origen al comparar).
    - `stats`: diccionario serializable a JSON (claves en camelCase, viaja al frontend) con
      `mode` (`"concat"`/`"join"`), `joinType` (`None` al apilar), `files` (lista en el orden de
      entrada de `{name, sheet, rowsRead}`, y en join además `keyColumn`, `unmatchedRows` y
      `emptyKeyRows`; ver `merge_files`/`join_files`), `resultRows`/`resultColumns` (del
      resultado final), `duplicatesRemoved` (0 si la opción está desactivada) y `options`
      (`{addSourceColumn, allAsText, removeDuplicates}`, booleanos; `addSourceColumn` es la
      opción efectiva, así que en join siempre es `False`).

    `mode` es `"join"` o cualquier otro valor para apilar (la validación del modo la hace quien
    llama). `join_keys` es la lista de columnas clave por archivo (solo join). El resto de
    parámetros se pasa tal cual a `merge_files`/`join_files`. Cada archivo se lee una sola vez.
    """
    is_join = mode == "join"
    stats = {"mode": "join" if is_join else "concat", "joinType": join_type if is_join else None}

    if is_join:
        df = join_files(
            file_paths,
            join_keys,
            join_type,
            progress_callback=progress_callback,
            csv_separators=csv_separators,
            all_as_text=all_as_text,
            sheets=sheets,
            stats=stats,
        )
    else:
        df = merge_files(
            file_paths,
            progress_callback=progress_callback,
            csv_separators=csv_separators,
            add_source_column=add_source_column,
            source_column_name=source_column_name,
            all_as_text=all_as_text,
            sheets=sheets,
            stats=stats,
        )

    duplicates_removed = 0
    if remove_duplicates:
        source_column = df.attrs.get("source_column")
        df, duplicates_removed = drop_duplicate_rows(
            df, ignore_columns=[source_column] if source_column else ()
        )

    stats["resultRows"] = int(len(df))
    stats["resultColumns"] = int(df.shape[1])
    stats["duplicatesRemoved"] = int(duplicates_removed)
    stats["options"] = {
        "addSourceColumn": bool(add_source_column) and not is_join,
        "allAsText": bool(all_as_text),
        "removeDuplicates": bool(remove_duplicates),
    }
    return df, stats


def right_anti_two_files_error():
    """Construye (sin lanzarlo) el `MergeError` de `"right_anti"` con un número de archivos
    distinto de dos. Es una función aparte porque lo usan `join_files` y la validación previa de
    `/api/merge` en `server.py`, y así ambos devuelven el mismo mensaje y `code`."""
    return MergeError(
        "El tipo 'Filas del segundo archivo sin coincidencia' (right anti) solo funciona con "
        "exactamente dos archivos.",
        code="right_anti_two_files",
    )


def _anti_join(frames, source_index):
    """Devuelve las filas de `frames[source_index]` cuya clave no aparece en ningún otro archivo.

    `frames` es una lista de `(DataFrame, clave)` con la columna clave ya normalizada a texto por
    `_stringify_key_column`. El resultado conserva solo las columnas del archivo de origen (en su
    orden original) y sus filas en el orden del archivo, con el índice renumerado desde 0.

    Las claves vacías no coinciden con nada: las filas del archivo de origen con la clave vacía
    (nula, o texto vacío tras recortar espacios) se CONSERVAN en el resultado, y las claves vacías
    de los demás archivos no cuentan como coincidencia (a diferencia de `pandas.merge`, que sí
    empareja nulos entre sí).
    """
    source_df, source_key = frames[source_index]
    other_keys = set()
    for position, (df, key) in enumerate(frames):
        if position == source_index:
            continue
        values = df[key].dropna()
        other_keys.update(v for v in values if v != "")

    # `other_keys` no contiene nulos ni "", así que una clave vacía del origen nunca coincide.
    matched = source_df[source_key].isin(other_keys)
    return source_df.loc[~matched].reset_index(drop=True)


def drop_duplicate_rows(df, ignore_columns=()):
    """Quita las filas repetidas de `df` y devuelve `(df_sin_duplicados, filas_eliminadas)`.

    Se aplica al resultado final (después de apilar o del join). Una fila es duplicada si es
    idéntica a una anterior en todas las columnas, salvo las de `ignore_columns`; se conserva la
    primera aparición, en el orden del resultado, y el índice se renumera desde 0. Las columnas
    ignoradas (p. ej. la de archivo de origen, ver `merge_files`) no cuentan al comparar, pero se
    conservan en el resultado con el valor de la fila que se queda. Los nombres de
    `ignore_columns` que no estén en `df` se ignoran.

    Sigue el criterio de `DataFrame.duplicated` de pandas: dos celdas vacías (nulas) se
    consideran iguales. Los valores NO se convierten de tipo para comparar: el número `1` y el
    texto `"1"` son distintos (puede pasar al apilar una columna que en un archivo se leyó como
    número y en otro como texto; con "Leer todas las columnas como texto" ambos serían `"1"`).
    """
    ignored = set(ignore_columns)
    subset = list(dict.fromkeys(c for c in df.columns if c not in ignored))
    if df.empty or not subset:
        return df.reset_index(drop=True), 0

    duplicated = df.duplicated(subset=subset, keep="first")
    removed = int(duplicated.sum())
    if not removed:
        return df.reset_index(drop=True), 0
    return df.loc[~duplicated].reset_index(drop=True), removed


def _report_text(labels, key):
    """Devuelve el texto `key` de `labels`, o el de `DEFAULT_REPORT_LABELS` si falta o no es un
    texto con contenido (así un `report_labels` incompleto o con basura nunca rompe el informe)."""
    value = (labels or {}).get(key)
    if isinstance(value, str) and value.strip():
        return value
    return DEFAULT_REPORT_LABELS[key]


def report_sheet_name(label, data_sheet_name=_DATA_SHEET_NAME):
    """Convierte `label` en un nombre de hoja válido para Excel/ODS.

    Quita los caracteres prohibidos (`[]:*?/\\`), los espacios de los extremos y los apóstrofos
    del principio y del final (Excel tampoco los admite ahí), y lo corta a 31 caracteres. Si queda
    vacío, o coincide (sin distinguir mayúsculas) con el de la hoja de datos `data_sheet_name`, se
    usa el nombre por defecto de `DEFAULT_REPORT_LABELS`.
    """
    cleaned = "".join(ch for ch in str(label) if ch not in _EXCEL_SHEET_NAME_INVALID)
    cleaned = cleaned.strip().strip("'").strip()[:_EXCEL_SHEET_NAME_MAX].strip()
    if not cleaned or cleaned.lower() == data_sheet_name.lower():
        return DEFAULT_REPORT_LABELS["sheetName"]
    return cleaned


def _report_file_suffix(label):
    """Limpia el sufijo del archivo del informe CSV igual que `sanitizeFileName` en el frontend
    (quita los caracteres no válidos en nombres de archivo y los espacios de los extremos); si
    queda vacío se usa el de `DEFAULT_REPORT_LABELS`."""
    cleaned = "".join(ch for ch in str(label) if ch not in _INVALID_FILENAME_CHARS).strip()
    return cleaned or DEFAULT_REPORT_LABELS["fileSuffix"]


def build_report(stats, labels=None, generated_at=None):
    """Arma el informe de la combinación a partir de las `stats` de `build_result`.

    `labels` son los textos ya traducidos (claves de `DEFAULT_REPORT_LABELS`); los que falten o no
    sean texto se toman de `DEFAULT_REPORT_LABELS`. `generated_at` (`datetime`, por defecto la
    hora local actual) es la fecha y hora que se muestra, en formato `AAAA-MM-DD HH:MM`.

    Devuelve un diccionario con `rows` (lista de filas, cada una una lista de celdas, lista para
    escribir sin encabezado: primero el bloque resumen etiqueta/valor, luego una fila en blanco y
    luego la tabla por archivo con su encabezado), `sheet_name` (nombre de hoja ya saneado, ver
    `report_sheet_name`) y `file_suffix` (sufijo del archivo aparte en CSV, ver
    `report_output_path`). Se pasa tal cual a `write_output`.
    """

    def text(key):
        return _report_text(labels, key)

    def yes_no(value):
        return text("yes") if value else text("no")

    generated_at = generated_at or datetime.now()
    is_join = stats.get("mode") == "join"
    options = stats.get("options") or {}

    rows = [
        [text("generatedAt"), generated_at.strftime("%Y-%m-%d %H:%M")],
        [text("mode"), text("modeJoin" if is_join else "modeConcat")],
    ]
    if is_join:
        join_label_key = _JOIN_TYPE_LABEL_KEYS.get(stats.get("joinType"))
        rows.append([text("joinType"), text(join_label_key) if join_label_key else stats.get("joinType")])
    rows += [
        [text("resultRows"), stats.get("resultRows", 0)],
        [text("resultColumns"), stats.get("resultColumns", 0)],
        [text("duplicatesRemoved"), stats.get("duplicatesRemoved", 0)],
        [text("addSourceColumn"), yes_no(options.get("addSourceColumn"))],
        [text("allAsText"), yes_no(options.get("allAsText"))],
        [text("removeDuplicates"), yes_no(options.get("removeDuplicates"))],
        [],
    ]

    header = [text("file"), text("sheet"), text("rowsRead")]
    if is_join:
        header += [text("keyColumn"), text("unmatchedRows"), text("emptyKeyRows")]
    rows.append(header)
    for entry in stats.get("files") or []:
        row = [entry.get("name"), entry.get("sheet") or text("allSheets"), entry.get("rowsRead", 0)]
        if is_join:
            row += [entry.get("keyColumn"), entry.get("unmatchedRows", 0), entry.get("emptyKeyRows", 0)]
        rows.append(row)

    return {
        "rows": rows,
        "sheet_name": report_sheet_name(text("sheetName")),
        "file_suffix": _report_file_suffix(text("fileSuffix")),
    }


def report_output_path(output_path, output_format, report):
    """Ruta del archivo aparte del informe, o `None` si el informe va dentro del mismo libro.

    Solo el CSV (que no tiene hojas) lleva el informe en otro archivo, junto al resultado:
    `<nombre>_<sufijo>.csv` (sufijo de `report["file_suffix"]`). En el resto de formatos, y sin
    informe, devuelve `None`.
    """
    if not report or output_format.lower() != "csv":
        return None
    root = os.path.splitext(output_path)[0]
    return f"{root}_{report['file_suffix']}.csv"


def _write_report_csv(rows, path, csv_separator):
    """Escribe las filas del informe en un CSV con el mismo formato que el principal (UTF-8 con
    BOM y `csv_separator`). Usa `csv.writer` porque las filas no tienen todas el mismo largo."""
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=csv_separator, lineterminator=os.linesep)
        writer.writerows(["" if cell is None else cell for cell in row] for row in rows)


def _write_excel_with_report(df, output_path, engine, report):
    """Escribe `df` (hoja de datos con el nombre de siempre) y el informe en una hoja adicional
    del mismo libro `.xlsx`/`.ods`, sin encabezado (las filas del informe ya traen sus títulos)."""
    with pd.ExcelWriter(output_path, engine=engine) as writer:
        df.to_excel(writer, sheet_name=_DATA_SHEET_NAME, index=False)
        pd.DataFrame(report["rows"]).to_excel(
            writer, sheet_name=report["sheet_name"], index=False, header=False
        )


def validate_output_extension(output_path, output_format):
    """Comprueba que la extensión de `output_path` coincide con `output_format`.

    Evita que la API escriba un archivo con una extensión arbitraria (p. ej. `.bat`) aunque el
    contenido sea una hoja de cálculo. Lanza `MergeError` con `code="output_extension_mismatch"`.
    """
    expected = f".{output_format.lower()}"
    actual = _extension_of(output_path)
    if actual != expected:
        raise MergeError(
            f"La extensión del archivo de salida ('{actual or 'ninguna'}') no coincide con el "
            f"formato elegido ('{expected}').",
            code="output_extension_mismatch",
            params={"ext": actual or "-", "expected": expected},
        )


def write_output(df, output_path, output_format, csv_separator=",", report=None):
    """Guarda `df` en `output_path` con el formato `output_format` (`xlsx`, `xls`, `csv` u `ods`).

    Los `.csv` se escriben en UTF-8 con BOM (sin él, Excel los abre como Windows-1252 y rompe
    las tildes) y con `csv_separator` como separador (uno de `OUTPUT_CSV_SEPARATORS`: `;` es el
    que espera Excel en configuraciones regionales que usan la coma como separador decimal).

    `report` (opcional) es el informe de la combinación tal como lo devuelve `build_report`. En
    `xlsx`/`ods`/`xls` va en una hoja adicional, después de la de datos; en `csv`, en un archivo
    aparte con el mismo separador y codificación (ruta en `report_output_path`). Sin `report` la
    salida es exactamente la de siempre.

    Valida antes de escribir que el formato esté soportado, que la carpeta de destino exista y
    que haya permisos de escritura, y traduce `PermissionError` (p. ej. archivo abierto en otro
    programa) a un `MergeError` con un mensaje apto para el usuario. Devuelve `output_path` tal
    cual, para poder encadenar la llamada.
    """
    output_format = output_format.lower()
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise MergeError(
            f"Formato de salida no soportado: '{output_format}'. "
            f"Formatos permitidos: {', '.join(sorted(SUPPORTED_OUTPUT_FORMATS))}.",
            code="unsupported_output_format",
            params={"format": output_format},
        )

    if output_format == "csv" and csv_separator not in OUTPUT_CSV_SEPARATORS:
        raise MergeError(
            f"Separador de salida no soportado: '{csv_separator}'. "
            f"Separadores permitidos: {' '.join(sorted(OUTPUT_CSV_SEPARATORS))}.",
            code="unsupported_output_csv_separator",
            params={"separator": csv_separator, "allowed": " ".join(sorted(OUTPUT_CSV_SEPARATORS))},
        )

    validate_output_extension(output_path, output_format)

    output_dir = os.path.dirname(output_path) or "."
    if not os.path.isdir(output_dir):
        raise MergeError(
            f"La carpeta de destino no existe: {output_dir}",
            code="output_dir_missing",
            params={"dir": output_dir},
        )

    if not os.access(output_dir, os.W_OK):
        raise MergeError(
            f"Sin permisos de escritura en la carpeta de destino: {output_dir}",
            code="output_dir_no_permission",
            params={"dir": output_dir},
        )

    if output_format == "xlsx" and len(df) > XLSX_MAX_ROWS:
        raise MergeError(
            f"El resultado combinado tiene {len(df)} filas, que supera el límite de "
            f"{XLSX_MAX_ROWS} filas del formato .xlsx. Usa .csv en su lugar.",
            code="xlsx_row_limit",
            params={"rows": len(df), "limit": XLSX_MAX_ROWS},
        )

    # Archivo que se está escribiendo, para que el error de archivo bloqueado nombre el correcto
    # (el principal o, en CSV, el del informe).
    current_path = output_path
    try:
        if output_format == "csv":
            df.to_csv(output_path, index=False, sep=csv_separator, encoding="utf-8-sig")
            if report:
                current_path = report_output_path(output_path, output_format, report)
                _write_report_csv(report["rows"], current_path, csv_separator)
        elif output_format in ("xlsx", "ods"):
            engine = "openpyxl" if output_format == "xlsx" else "odf"
            if report:
                _write_excel_with_report(df, output_path, engine, report)
            else:
                df.to_excel(output_path, index=False, engine=engine)
        elif output_format == "xls":
            _write_xls(df, output_path, report)
    except MergeError:
        raise
    except PermissionError as exc:
        raise MergeError(
            f"Sin permisos de escritura en '{current_path}'. Cierra el archivo si está abierto "
            f"en otro programa o elige otra ubicación.",
            code="output_file_locked",
            params={"path": current_path},
        ) from exc
    except Exception as exc:
        raise MergeError(
            f"No se pudo guardar el archivo de salida: {exc}",
            code="output_write_error",
            params={"detail": str(exc)},
        ) from exc

    return output_path


def _write_xls_cell(sheet, row_index, col_index, value):
    """Escribe una celda en una hoja de `xlwt`: vacía si es nula, número si es numérica y texto
    en cualquier otro caso.

    Los números pueden llegar como tipos de numpy (`numpy.int64` en columnas `Int64`, ver
    `_nullable_integers`), que no son `int` de Python: se reconocen con `numbers.Number` y se
    convierten, porque si no `xlwt` los escribiría como texto."""
    if pd.isna(value):
        sheet.write(row_index, col_index, "")
    elif isinstance(value, (bool, np.bool_)):
        sheet.write(row_index, col_index, bool(value))
    elif isinstance(value, numbers.Integral):
        sheet.write(row_index, col_index, int(value))
    elif isinstance(value, numbers.Number):
        sheet.write(row_index, col_index, float(value))
    else:
        sheet.write(row_index, col_index, str(value))


def _write_xls(df, output_path, report=None):
    """Escribe `df` como `.xls` clásico (formato BIFF) con `xlwt`, hoja "Combinado".

    A diferencia de `.xlsx`/`.ods` (que usa `DataFrame.to_excel`), `.xls` no tiene un motor de
    escritura compatible con pandas moderno, así que se escribe celda a celda. Lanza
    `MergeError` si el resultado supera `XLS_MAX_ROWS` (límite propio del formato) o si `xlwt`
    no está disponible. Con `report` (ver `build_report`) se añade una segunda hoja con el
    informe de la combinación.
    """
    try:
        import xlwt
    except ImportError as exc:
        raise MergeError(
            "La librería 'xlwt' no está disponible para generar archivos .xls.",
            code="xls_library_missing",
        ) from exc

    if len(df) > XLS_MAX_ROWS:
        raise MergeError(
            f"El resultado combinado tiene {len(df)} filas, que supera el límite de "
            f"{XLS_MAX_ROWS} filas del formato .xls clásico. Usa .xlsx, .csv u .ods en su lugar.",
            code="xls_row_limit",
            params={"rows": len(df), "limit": XLS_MAX_ROWS},
        )

    workbook = xlwt.Workbook()
    sheet = workbook.add_sheet(_XLS_DATA_SHEET_NAME)

    for col_index, column_name in enumerate(df.columns):
        sheet.write(0, col_index, str(column_name))

    for row_index, row in enumerate(df.itertuples(index=False), start=1):
        for col_index, value in enumerate(row):
            _write_xls_cell(sheet, row_index, col_index, value)

    if report:
        report_sheet = workbook.add_sheet(report_sheet_name(report["sheet_name"], _XLS_DATA_SHEET_NAME))
        for row_index, row in enumerate(report["rows"]):
            for col_index, value in enumerate(row):
                _write_xls_cell(report_sheet, row_index, col_index, value)

    workbook.save(output_path)
