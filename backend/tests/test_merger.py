"""Tests unitarios de backend/merger.py.

No dependen de Flask ni de red: `merger.py` no las usa (ver su docstring de módulo), así que
estos tests solo tocan pandas y archivos temporales (`tmp_path` de pytest). Cubren sobre todo
los casos límite del join/apilar (columnas duplicadas, nombres de clave distintos, tipos
mixtos) y que cada `MergeError` lleve el `code` correcto -- eso es lo que traduce el frontend
(ver `src/i18n/backendMessages.js`), así que un `code` equivocado rompe la traducción en
silencio aunque el mensaje en español siga siendo correcto.
"""

import pandas as pd
import pytest

from merger import MergeError, join_files, merge_files, read_file_columns, write_output


def _write_csv(path, data):
    pd.DataFrame(data).to_csv(path, index=False)
    return str(path)


# ---- merge_files (modo "apilar filas") ----


def test_merge_files_concatena_y_alinea_columnas_por_nombre(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2], "nombre": ["Ana", "Beto"]})
    b = _write_csv(tmp_path / "b.csv", {"id": [3], "nombre": ["Cora"], "extra": ["x"]})

    result = merge_files([a, b])

    assert list(result.columns) == ["id", "nombre", "extra"]
    assert len(result) == 3
    # celda sin correspondencia (el archivo "a" no tenía columna "extra") queda vacía, no falla
    assert result.loc[result["id"] == 1, "extra"].isna().all()


def test_merge_files_reporta_progreso_por_archivo_leido(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    calls = []

    merge_files(
        [a, b],
        progress_callback=lambda index, total, message, code, params: calls.append(
            (index, total, code, params)
        ),
    )

    assert calls == [
        (1, 2, "read_file_progress", {"filename": "a.csv", "index": 1, "total": 2}),
        (2, 2, "read_file_progress", {"filename": "b.csv", "index": 2, "total": 2}),
    ]


def test_merge_files_sin_archivos():
    with pytest.raises(MergeError) as exc:
        merge_files([])
    assert exc.value.code == "no_files_selected"


def test_merge_files_formato_no_soportado(tmp_path):
    bad = tmp_path / "datos.txt"
    bad.write_text("no es una hoja de calculo")

    with pytest.raises(MergeError) as exc:
        merge_files([str(bad)])
    assert exc.value.code == "unsupported_input_format"
    assert exc.value.params["ext"] == ".txt"


def test_merge_files_archivo_inexistente():
    with pytest.raises(MergeError) as exc:
        merge_files(["/no/existe/archivo.csv"])
    assert exc.value.code == "file_not_found"


def test_merge_files_archivo_corrupto(tmp_path):
    # Un .csv vacío no es un CSV válido para pandas (EmptyDataError): se traduce a
    # file_read_error, con el texto crudo de la excepción en params["detail"].
    empty = tmp_path / "vacio.csv"
    empty.write_text("")

    with pytest.raises(MergeError) as exc:
        merge_files([str(empty)])
    assert exc.value.code == "file_read_error"
    assert exc.value.params["filename"] == "vacio.csv"


def test_merge_files_sin_datos(tmp_path):
    # Un DataFrame vacío (0 filas, 0 columnas) escrito a .xlsx se lee de vuelta con 0 columnas;
    # _read_spreadsheet descarta esas hojas (shape[1] > 0) y merge_files no tiene nada que unir.
    path = tmp_path / "vacio.xlsx"
    pd.DataFrame().to_excel(path, index=False, engine="openpyxl")

    with pytest.raises(MergeError) as exc:
        merge_files([str(path)])
    assert exc.value.code == "no_data"


# ---- join_files (modo "join") ----


def test_join_files_inner_cruza_por_clave(tmp_path):
    a = _write_csv(tmp_path / "seguro.csv", {"id_cliente": [1, 2, 3], "seguro": ["si", "si", "no"]})
    b = _write_csv(tmp_path / "gimnasio.csv", {"id_cliente": [2, 3, 4], "gimnasio": ["si", "si", "si"]})

    result = join_files([a, b], ["id_cliente", "id_cliente"], join_type="inner")

    # La columna clave sale siempre como texto (_stringify_key_column normaliza el tipo para
    # poder cruzar archivos donde la clave llega como número en uno y como texto en otro).
    assert sorted(result["id_cliente"].tolist()) == ["2", "3"]


def test_join_files_columnas_con_nombres_distintos_se_tratan_como_la_misma_clave(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"ID_Cliente": [1, 2], "seguro": ["si", "no"]})
    b = _write_csv(tmp_path / "b.csv", {"Codigo Cliente": [1, 2], "gimnasio": ["no", "si"]})

    result = join_files([a, b], ["ID_Cliente", "Codigo Cliente"], join_type="inner")

    # La clave final conserva el nombre de la clave elegida en el primer archivo.
    assert "ID_Cliente" in result.columns
    assert "Codigo Cliente" not in result.columns
    assert len(result) == 2


def test_join_files_encadena_mas_de_dos_archivos_en_orden(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2, 3]})
    b = _write_csv(tmp_path / "b.csv", {"id": [1, 2, 3], "x": ["a", "b", "c"]})
    c = _write_csv(tmp_path / "c.csv", {"id": [1, 2, 3], "y": ["d", "e", "f"]})

    result = join_files([a, b, c], ["id", "id", "id"], join_type="inner")

    assert list(result.columns) == ["id", "x", "y"]
    assert len(result) == 3


def test_join_files_columnas_duplicadas_se_distinguen_por_archivo_de_origen(tmp_path):
    a = _write_csv(tmp_path / "enero.csv", {"id": [1], "total": [100]})
    b = _write_csv(tmp_path / "febrero.csv", {"id": [1], "total": [200]})

    result = join_files([a, b], ["id", "id"], join_type="inner")

    assert "total" in result.columns  # la del primer archivo conserva el nombre original
    assert "total (febrero)" in result.columns
    assert result.loc[0, "total"] == 100
    assert result.loc[0, "total (febrero)"] == 200


def test_join_files_no_pierde_coincidencias_por_tipos_mixtos_en_la_clave(tmp_path):
    # Un archivo trae el ID como número, el otro como texto: sin _stringify_key_column esto
    # rompería el match en silencio (1 int64 != "1" str para pandas.merge).
    pd.DataFrame({"id": [1, 2], "seguro": ["si", "no"]}).to_csv(tmp_path / "a.csv", index=False)
    pd.DataFrame({"id": ["1", "2"], "gimnasio": ["no", "si"]}).to_csv(tmp_path / "b.csv", index=False)

    result = join_files([str(tmp_path / "a.csv"), str(tmp_path / "b.csv")], ["id", "id"], join_type="inner")

    assert len(result) == 2


def test_join_files_menos_de_dos_archivos(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})

    with pytest.raises(MergeError) as exc:
        join_files([a], ["id"])
    assert exc.value.code == "join_min_files"


def test_join_files_tipo_de_join_no_soportado(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [1]})

    with pytest.raises(MergeError) as exc:
        join_files([a, b], ["id", "id"], join_type="cross")
    assert exc.value.code == "unsupported_join_type_detail"


def test_join_files_falta_columna_clave_en_algun_archivo(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [1]})

    with pytest.raises(MergeError) as exc:
        join_files([a, b], ["id", ""])
    assert exc.value.code == "missing_join_key"


def test_join_files_columna_clave_inexistente_en_el_archivo(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"otra": [1]})

    with pytest.raises(MergeError) as exc:
        join_files([a, b], ["id", "id"])
    assert exc.value.code == "join_key_not_found"
    assert exc.value.params["key"] == "id"
    assert exc.value.params["filename"] == "b.csv"


def test_join_files_left_conserva_todas_las_filas_del_primer_archivo(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2, 3]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})

    result = join_files([a, b], ["id", "id"], join_type="left")

    assert len(result) == 3


def test_join_files_outer_conserva_filas_de_todos_los_archivos(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2, 3]})

    result = join_files([a, b], ["id", "id"], join_type="outer")

    assert sorted(result["id"].tolist()) == ["1", "2", "3"]


# ---- write_output ----


def test_write_output_formato_no_soportado(tmp_path):
    df = pd.DataFrame({"a": [1]})

    with pytest.raises(MergeError) as exc:
        write_output(df, str(tmp_path / "salida.raro"), "raro")
    assert exc.value.code == "unsupported_output_format"


def test_write_output_carpeta_destino_no_existe(tmp_path):
    df = pd.DataFrame({"a": [1]})

    with pytest.raises(MergeError) as exc:
        write_output(df, str(tmp_path / "no-existe" / "salida.csv"), "csv")
    assert exc.value.code == "output_dir_missing"


def test_write_output_csv(tmp_path):
    df = pd.DataFrame({"a": [1, 2]})
    out_path = tmp_path / "salida.csv"

    result = write_output(df, str(out_path), "csv")

    assert result == str(out_path)
    assert out_path.exists()
    assert pd.read_csv(out_path)["a"].tolist() == [1, 2]


def test_write_output_xls_supera_el_limite_de_filas(tmp_path, monkeypatch):
    import merger

    monkeypatch.setattr(merger, "XLS_MAX_ROWS", 2)
    df = pd.DataFrame({"a": [1, 2, 3]})

    with pytest.raises(MergeError) as exc:
        write_output(df, str(tmp_path / "salida.xls"), "xls")
    assert exc.value.code == "xls_row_limit"
    assert exc.value.params == {"rows": 3, "limit": 2}


# ---- read_file_columns ----


def test_read_file_columns(tmp_path):
    path = _write_csv(tmp_path / "a.csv", {"id": [1], "nombre": ["Ana"]})

    assert read_file_columns(path) == ["id", "nombre"]
