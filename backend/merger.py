"""Lógica de combinación de hojas de cálculo (sin dependencias de red/HTTP)."""

import os

import pandas as pd

SUPPORTED_INPUT_EXTENSIONS = {".xlsx", ".xls", ".csv", ".ods"}
SUPPORTED_OUTPUT_FORMATS = {"xlsx", "xls", "csv", "ods"}
JOIN_TYPES = {"inner", "left", "right", "outer"}

# Límite de filas del formato .xls clásico (65536 filas, incluye la fila de encabezado).
XLS_MAX_ROWS = 65536 - 1


class MergeError(Exception):
    """Error esperado durante la combinación, con un mensaje apto para mostrar al usuario."""


def _extension_of(path):
    return os.path.splitext(path)[1].lower()


def _read_spreadsheet(path):
    if not os.path.exists(path):
        raise MergeError(f"El archivo no existe: {path}")

    ext = _extension_of(path)

    try:
        if ext == ".csv":
            return [pd.read_csv(path)]
        if ext == ".xlsx":
            sheets = pd.read_excel(path, sheet_name=None, engine="openpyxl")
            return list(sheets.values())
        if ext == ".xls":
            sheets = pd.read_excel(path, sheet_name=None, engine="xlrd")
            return list(sheets.values())
        if ext == ".ods":
            sheets = pd.read_excel(path, sheet_name=None, engine="odf")
            return list(sheets.values())
    except Exception as exc:
        raise MergeError(
            f"No se pudo leer '{os.path.basename(path)}'. El archivo puede estar corrupto, "
            f"protegido con contraseña o dañado. Detalle: {exc}"
        ) from exc

    raise MergeError(
        f"Formato no soportado '{ext}' en '{os.path.basename(path)}'. "
        f"Formatos permitidos: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}."
    )


def merge_files(file_paths, progress_callback=None):
    """Lee todos los archivos indicados (en el orden dado) y los concatena en un único DataFrame.

    Las columnas se alinean por nombre (unión); las celdas sin correspondencia quedan vacías.
    Si un archivo tiene varias hojas, se combinan todas sus hojas también.
    """
    if not file_paths:
        raise MergeError("No se proporcionaron archivos para combinar.")

    frames = []
    total = len(file_paths)

    for index, path in enumerate(file_paths, start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise MergeError(
                f"Formato no soportado '{ext}' en '{os.path.basename(path)}'. "
                f"Formatos permitidos: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}."
            )

        for sheet_df in _read_spreadsheet(path):
            if sheet_df.shape[1] > 0:
                frames.append(sheet_df)

        if progress_callback:
            progress_callback(index, total, f"Leído {os.path.basename(path)} ({index}/{total})")

    if not frames:
        raise MergeError("Los archivos seleccionados no contienen datos para combinar.")

    return pd.concat(frames, ignore_index=True, sort=False)


def _read_single_dataframe(path):
    """Lee un archivo y devuelve un único DataFrame (concatenando sus hojas si tiene varias)."""
    sheets = _read_spreadsheet(path)
    if len(sheets) == 1:
        return sheets[0]
    return pd.concat(sheets, ignore_index=True, sort=False)


def read_file_columns(path):
    """Devuelve los nombres de columna de un archivo (unión de todas sus hojas)."""
    df = _read_single_dataframe(path)
    return [str(col) for col in df.columns]


def _stringify_key_column(series):
    """Convierte a texto los valores no nulos de una columna clave (recorta espacios), sin tocar
    los nulos. Evita que un join falle en silencio por diferencias de tipo entre archivos
    (ej. la clave llega como int64 en un archivo y como texto en otro)."""
    result = series.astype(object)
    mask = series.notna()
    result[mask] = series[mask].astype(str).str.strip()
    return result


def join_files(file_paths, join_keys, join_type="inner", progress_callback=None):
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
    """
    if not file_paths:
        raise MergeError("No se proporcionaron archivos para combinar.")
    if len(file_paths) < 2:
        raise MergeError("Se necesitan al menos dos archivos para hacer un join.")
    if join_type not in JOIN_TYPES:
        raise MergeError(
            f"Tipo de combinación no soportado: '{join_type}'. "
            f"Tipos permitidos: {', '.join(sorted(JOIN_TYPES))}."
        )
    if not join_keys or len(join_keys) != len(file_paths) or any(not k for k in join_keys):
        raise MergeError("Debés indicar una columna clave para cada archivo.")

    total = len(file_paths)
    result = None
    canonical_key = None

    for index, (path, key) in enumerate(zip(file_paths, join_keys), start=1):
        ext = _extension_of(path)
        if ext not in SUPPORTED_INPUT_EXTENSIONS:
            raise MergeError(
                f"Formato no soportado '{ext}' en '{os.path.basename(path)}'. "
                f"Formatos permitidos: {', '.join(sorted(SUPPORTED_INPUT_EXTENSIONS))}."
            )

        df = _read_single_dataframe(path)

        if key not in df.columns:
            raise MergeError(
                f"La columna clave '{key}' no existe en '{os.path.basename(path)}'. "
                f"Columnas disponibles: {', '.join(str(c) for c in df.columns)}."
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
                result[canonical_key] = result[canonical_key].where(result[canonical_key].notna(), result[key])
                result = result.drop(columns=[key])

        if progress_callback:
            progress_callback(index, total, f"Combinado {os.path.basename(path)} ({index}/{total})")

    if result is None or result.shape[1] == 0:
        raise MergeError("Los archivos seleccionados no contienen datos para combinar.")

    return result


def write_output(df, output_path, output_format):
    output_format = output_format.lower()
    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise MergeError(
            f"Formato de salida no soportado: '{output_format}'. "
            f"Formatos permitidos: {', '.join(sorted(SUPPORTED_OUTPUT_FORMATS))}."
        )

    output_dir = os.path.dirname(output_path) or "."
    if not os.path.isdir(output_dir):
        raise MergeError(f"La carpeta de destino no existe: {output_dir}")

    if not os.access(output_dir, os.W_OK):
        raise MergeError(f"Sin permisos de escritura en la carpeta de destino: {output_dir}")

    try:
        if output_format == "csv":
            df.to_csv(output_path, index=False)
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
            f"en otro programa o elige otra ubicación."
        ) from exc
    except Exception as exc:
        raise MergeError(f"No se pudo guardar el archivo de salida: {exc}") from exc

    return output_path


def _write_xls(df, output_path):
    try:
        import xlwt
    except ImportError as exc:
        raise MergeError("La librería 'xlwt' no está disponible para generar archivos .xls.") from exc

    if len(df) > XLS_MAX_ROWS:
        raise MergeError(
            f"El resultado combinado tiene {len(df)} filas, que supera el límite de "
            f"{XLS_MAX_ROWS} filas del formato .xls clásico. Usa .xlsx, .csv u .ods en su lugar."
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
