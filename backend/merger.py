"""Lógica de combinación de hojas de cálculo (sin dependencias de red/HTTP)."""

import codecs
import csv
import os

import pandas as pd

SUPPORTED_INPUT_EXTENSIONS = {".xlsx", ".xls", ".csv", ".ods"}
SUPPORTED_OUTPUT_FORMATS = {"xlsx", "xls", "csv", "ods"}
JOIN_TYPES = {"inner", "left", "right", "outer"}

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


def _read_csv(path, separator=None):
    """Lee un CSV detectando la codificación y, si `separator` es `None`, también el separador.

    La codificación se decide sobre una muestra del principio del archivo (ver
    `_read_csv_sample`); si más adelante aparece un byte que no encaja con ella, se reintenta con
    la siguiente de `CSV_ENCODINGS`.
    """
    separator, encoding, _ = _csv_format(path, separator)

    for candidate in CSV_ENCODINGS[CSV_ENCODINGS.index(encoding) :]:
        try:
            return pd.read_csv(path, sep=separator, encoding=candidate)
        except UnicodeDecodeError:
            continue
    raise _csv_encoding_error(path)


def _read_spreadsheet(path, csv_separator=None):
    """Lee `path` y devuelve una lista de DataFrames, una por cada hoja del archivo.

    Para `.csv` (que no tiene hojas) la lista siempre tiene un único elemento; se lee con
    `csv_separator` si se indica, o detectando el separador automáticamente si es `None` (ver
    `_read_csv`). El motor de lectura de pandas se elige según la extensión: `openpyxl` para
    `.xlsx`, `xlrd` para `.xls` y `odf` para `.ods`. Lanza `MergeError` si el archivo no existe,
    tiene un formato no soportado o pandas no consigue leerlo (corrupto, protegido con
    contraseña, etc.).
    """
    if not os.path.exists(path):
        raise MergeError(f"El archivo no existe: {path}", code="file_not_found", params={"path": path})

    ext = _extension_of(path)

    try:
        if ext == ".csv":
            return [_read_csv(path, csv_separator)]
        if ext == ".xlsx":
            sheets = pd.read_excel(path, sheet_name=None, engine="openpyxl")
            return list(sheets.values())
        if ext == ".xls":
            sheets = pd.read_excel(path, sheet_name=None, engine="xlrd")
            return list(sheets.values())
        if ext == ".ods":
            sheets = pd.read_excel(path, sheet_name=None, engine="odf")
            return list(sheets.values())
    except MergeError:
        raise
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


def merge_files(file_paths, progress_callback=None, csv_separators=None):
    """Lee todos los archivos indicados (en el orden dado) y los concatena en un único DataFrame.

    Las columnas se alinean por nombre (unión); las celdas sin correspondencia quedan vacías.
    Si un archivo tiene varias hojas, se combinan todas sus hojas también.

    Si se indica, `progress_callback` se invoca tras leer cada archivo con la firma
    `(index, total, message, code, params)`, donde `index` va de 1 a `total` (número de
    archivos), `message` es el texto en español ya formado y `code`/`params` son la versión
    traducible del mismo mensaje (ver `MergeError` para el contrato `code`/`params`).

    `csv_separators` es un diccionario opcional `{ruta: separador}` con el separador elegido a
    mano para algunos CSV; los que no aparecen (o tienen `None`) se detectan automáticamente.
    """
    if not file_paths:
        raise MergeError("No se proporcionaron archivos para combinar.", code="no_files_selected")

    csv_separators = csv_separators or {}
    frames = []
    total = len(file_paths)

    for index, path in enumerate(file_paths, start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise _unsupported_format_error(ext, path)

        for sheet_df in _read_spreadsheet(path, csv_separators.get(path)):
            if sheet_df.shape[1] > 0:
                frames.append(sheet_df)

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

    return pd.concat(frames, ignore_index=True, sort=False)


def _read_single_dataframe(path, csv_separator=None):
    """Lee un archivo y devuelve un único DataFrame (concatenando sus hojas si tiene varias)."""
    sheets = _read_spreadsheet(path, csv_separator)
    if len(sheets) == 1:
        return sheets[0]
    return pd.concat(sheets, ignore_index=True, sort=False)


def read_file_columns(path, csv_separator=None):
    """Devuelve los nombres de columna de un archivo (unión de todas sus hojas).

    `csv_separator` solo aplica a `.csv`: `None` detecta el separador automáticamente.
    """
    df = _read_single_dataframe(path, csv_separator)
    return [str(col) for col in df.columns]


def _stringify_key_column(series):
    """Convierte a texto los valores no nulos de una columna clave (recorta espacios), sin tocar
    los nulos. Evita que un join falle en silencio por diferencias de tipo entre archivos
    (ej. la clave llega como int64 en un archivo y como texto en otro)."""
    result = series.astype(object)
    mask = series.notna()
    result[mask] = series[mask].astype(str).str.strip()
    return result


def join_files(file_paths, join_keys, join_type="inner", progress_callback=None, csv_separators=None):
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
    if not join_keys or len(join_keys) != len(file_paths) or any(not k for k in join_keys):
        raise MergeError("Debés indicar una columna clave para cada archivo.", code="missing_join_key")

    csv_separators = csv_separators or {}
    total = len(file_paths)
    result = None
    canonical_key = None

    for index, (path, key) in enumerate(zip(file_paths, join_keys), start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise _unsupported_format_error(ext, path)

        df = _read_single_dataframe(path, csv_separators.get(path))

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

        if result is None:
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

    if result is None or result.shape[1] == 0:
        raise MergeError("Los archivos seleccionados no contienen datos para combinar.", code="no_data")

    return result


def write_output(df, output_path, output_format, csv_separator=","):
    """Guarda `df` en `output_path` con el formato `output_format` (`xlsx`, `xls`, `csv` u `ods`).

    Los `.csv` se escriben en UTF-8 con BOM (sin él, Excel los abre como Windows-1252 y rompe
    las tildes) y con `csv_separator` como separador (uno de `OUTPUT_CSV_SEPARATORS`: `;` es el
    que espera Excel en configuraciones regionales que usan la coma como separador decimal).

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

    try:
        if output_format == "csv":
            df.to_csv(output_path, index=False, sep=csv_separator, encoding="utf-8-sig")
        elif output_format == "xlsx":
            df.to_excel(output_path, index=False, engine="openpyxl")
        elif output_format == "ods":
            df.to_excel(output_path, index=False, engine="odf")
        elif output_format == "xls":
            _write_xls(df, output_path)
    except MergeError:
        raise
    except PermissionError as exc:
        raise MergeError(
            f"Sin permisos de escritura en '{output_path}'. Cierra el archivo si está abierto "
            f"en otro programa o elige otra ubicación.",
            code="output_file_locked",
            params={"path": output_path},
        ) from exc
    except Exception as exc:
        raise MergeError(
            f"No se pudo guardar el archivo de salida: {exc}",
            code="output_write_error",
            params={"detail": str(exc)},
        ) from exc

    return output_path


def _write_xls(df, output_path):
    """Escribe `df` como `.xls` clásico (formato BIFF) con `xlwt`, hoja "Combinado".

    A diferencia de `.xlsx`/`.ods` (que usa `DataFrame.to_excel`), `.xls` no tiene un motor de
    escritura compatible con pandas moderno, así que se escribe celda a celda. Lanza
    `MergeError` si el resultado supera `XLS_MAX_ROWS` (límite propio del formato) o si `xlwt`
    no está disponible.
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
    sheet = workbook.add_sheet("Combinado")

    for col_index, column_name in enumerate(df.columns):
        sheet.write(0, col_index, str(column_name))

    for row_index, row in enumerate(df.itertuples(index=False), start=1):
        for col_index, value in enumerate(row):
            if pd.isna(value):
                sheet.write(row_index, col_index, "")
            elif isinstance(value, (int, float, bool)):
                sheet.write(row_index, col_index, value)
            else:
                sheet.write(row_index, col_index, str(value))

    workbook.save(output_path)
