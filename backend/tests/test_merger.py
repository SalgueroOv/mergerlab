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

import merger
from merger import (
    MergeError,
    detect_csv_separator,
    drop_duplicate_rows,
    inspect_csv,
    join_files,
    list_sheets,
    merge_files,
    read_file_columns,
    write_output,
)


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


# ---- join_files: tipos "anti" ----


def test_join_files_left_anti_con_dos_archivos(tmp_path):
    a = _write_csv(tmp_path / "seguro.csv", {"id": [1, 2, 3], "seguro": ["si", "si", "no"]})
    b = _write_csv(tmp_path / "gimnasio.csv", {"id": [2, 4], "gimnasio": ["si", "si"]})

    result = join_files([a, b], ["id", "id"], join_type="left_anti")

    assert result["id"].tolist() == ["1", "3"]
    assert result["seguro"].tolist() == ["si", "no"]


def test_join_files_left_anti_con_tres_archivos_descarta_lo_que_aparece_en_cualquiera(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2, 3, 4]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    # La fila 3 solo aparece en el tercer archivo: también cuenta como coincidencia.
    c = _write_csv(tmp_path / "c.csv", {"id": [3, 9]})

    result = join_files([a, b, c], ["id", "id", "id"], join_type="left_anti")

    assert result["id"].tolist() == ["1", "4"]


def test_join_files_right_anti_con_dos_archivos(tmp_path):
    a = _write_csv(tmp_path / "seguro.csv", {"id": [1, 2], "seguro": ["si", "no"]})
    b = _write_csv(tmp_path / "gimnasio.csv", {"id": [5, 2, 4], "gimnasio": ["x", "y", "z"]})

    result = join_files([a, b], ["id", "id"], join_type="right_anti")

    # Filas del segundo archivo, en su orden original y solo con sus columnas.
    assert list(result.columns) == ["id", "gimnasio"]
    assert result["id"].tolist() == ["5", "4"]
    assert result["gimnasio"].tolist() == ["x", "z"]


def test_join_files_right_anti_con_tres_archivos_da_error(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    c = _write_csv(tmp_path / "c.csv", {"id": [3]})

    with pytest.raises(MergeError) as exc:
        join_files([a, b, c], ["id", "id", "id"], join_type="right_anti")
    assert exc.value.code == "right_anti_two_files"


def test_join_files_anti_con_claves_de_distinto_nombre(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"ID_Cliente": [1, 2, 3], "x": ["a", "b", "c"]})
    b = _write_csv(tmp_path / "b.csv", {"Codigo Cliente": [2, 3, 7], "y": ["p", "q", "r"]})

    left = join_files([a, b], ["ID_Cliente", "Codigo Cliente"], join_type="left_anti")
    right = join_files([a, b], ["ID_Cliente", "Codigo Cliente"], join_type="right_anti")

    assert left["ID_Cliente"].tolist() == ["1"]
    assert right["Codigo Cliente"].tolist() == ["7"]


def test_join_files_anti_conserva_las_claves_vacias_del_archivo_de_origen(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id,x\n1,a\n,b\n2,c\n", encoding="utf-8")
    # El otro archivo también tiene una clave vacía: no cuenta como coincidencia.
    b = tmp_path / "b.csv"
    b.write_text("id,y\n1,p\n,q\n", encoding="utf-8")

    result = join_files([str(a), str(b)], ["id", "id"], join_type="left_anti")

    assert result["x"].tolist() == ["b", "c"]
    assert pd.isna(result.loc[0, "id"])
    assert result.loc[1, "id"] == "2"


def test_join_files_anti_sin_filas_devuelve_solo_los_encabezados(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2], "x": ["a", "b"]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2, 1], "y": ["p", "q"]})
    out = tmp_path / "salida.csv"

    result = join_files([a, b], ["id", "id"], join_type="left_anti")
    write_output(result, str(out), "csv")

    assert len(result) == 0
    assert list(result.columns) == ["id", "x"]
    written = pd.read_csv(out, encoding="utf-8-sig")
    assert list(written.columns) == ["id", "x"]
    assert len(written) == 0


def test_join_files_anti_solo_lleva_las_columnas_del_archivo_de_origen(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"nombre": ["Ana", "Beto"], "id": [1, 2], "edad": [30, 40]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2], "nombre": ["Beto"], "ciudad": ["Lima"]})

    result = join_files([a, b], ["id", "id"], join_type="left_anti")

    # Mismo orden de columnas que el original, sin columnas del otro archivo ni sufijos.
    assert list(result.columns) == ["nombre", "id", "edad"]
    assert result.loc[0, "nombre"] == "Ana"
    assert result.loc[0, "edad"] == 30


def test_join_files_anti_conserva_ceros_a_la_izquierda_en_la_clave(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,x\n00123,a\n00456,b\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("dni,y\n00456,p\n123,q\n", encoding="utf-8")

    result = join_files([str(a), str(b)], ["dni", "dni"], join_type="left_anti")

    # "123" no coincide con "00123": la clave se compara como texto.
    assert result["dni"].tolist() == ["00123"]


def test_join_files_anti_reporta_progreso_por_archivo(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    calls = []

    join_files(
        [a, b],
        ["id", "id"],
        join_type="left_anti",
        progress_callback=lambda index, total, message, code, params: calls.append((index, code)),
    )

    assert calls == [(1, "join_file_progress"), (2, "join_file_progress")]


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


def test_write_output_csv_lleva_bom_y_respeta_el_separador_elegido(tmp_path):
    df = pd.DataFrame({"nombre": ["Lucía"], "monto": [10]})
    out_path = tmp_path / "salida.csv"

    write_output(df, str(out_path), "csv", csv_separator=";")

    raw = out_path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")  # BOM UTF-8: Excel lo necesita para leer bien las tildes
    assert raw[3:].decode("utf-8").splitlines() == ["nombre;monto", "Lucía;10"]


def test_write_output_csv_separador_no_soportado(tmp_path):
    df = pd.DataFrame({"a": [1]})

    with pytest.raises(MergeError) as exc:
        write_output(df, str(tmp_path / "salida.csv"), "csv", csv_separator="|")
    assert exc.value.code == "unsupported_output_csv_separator"


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


def test_read_file_columns_con_separador_elegido_a_mano(tmp_path):
    path = tmp_path / "a.csv"
    path.write_text("id;nombre\n1;Ana\n", encoding="utf-8")

    # Forzar la coma (aunque el archivo usa ";") deja una única columna: el usuario manda.
    assert read_file_columns(str(path), csv_separator=",") == ["id;nombre"]
    assert read_file_columns(str(path)) == ["id", "nombre"]


# ---- CSV: detección de separador y codificación ----


@pytest.mark.parametrize("sep", [",", ";", "\t", "|"])
def test_detect_csv_separator_reconoce_cada_candidato(sep):
    lines = [sep.join(["id", "nombre", "ciudad"]), sep.join(["1", "Ana", "Rosario"])]

    assert detect_csv_separator(lines) == (sep, True)


def test_detect_csv_separator_respeta_campos_entre_comillas():
    # La coma dentro de las comillas no debe hacer ganar a "," frente a ";".
    lines = ["nombre;monto", '"Paz, Juan";1.500,50', '"Ríos, Ana";200']

    assert detect_csv_separator(lines) == (";", True)


def test_detect_csv_separator_archivo_de_una_sola_columna_es_seguro():
    assert detect_csv_separator(["nombre", "Ana", "Beto"]) == (",", True)


def test_detect_csv_separator_empate_no_es_seguro():
    # "," y ";" dan 2 columnas consistentes en todas las filas: no hay forma de saber cuál es.
    sep, confident = detect_csv_separator(["a,b;c", "1,2;3"])

    assert sep == ","
    assert confident is False


def test_detect_csv_separator_filas_inconsistentes_no_es_seguro():
    lines = ["id,nombre", "1,Ana", "2,Beto,extra", "3,Cora,extra", "4"]

    sep, confident = detect_csv_separator(lines)

    assert sep == ","
    assert confident is False


def test_merge_files_lee_csv_con_punto_y_coma(tmp_path):
    path = tmp_path / "ventas.csv"
    path.write_text("id;nombre\n1;Ana\n2;Beto\n", encoding="utf-8")

    result = merge_files([str(path)])

    assert list(result.columns) == ["id", "nombre"]
    assert len(result) == 2


def test_merge_files_detecta_separador_por_archivo(tmp_path):
    a = tmp_path / "enero.csv"
    a.write_text("id,nombre\n1,Ana\n", encoding="utf-8")
    b = tmp_path / "febrero.csv"
    b.write_text("id;nombre\n2;Beto\n", encoding="utf-8")

    result = merge_files([str(a), str(b)])

    assert list(result.columns) == ["id", "nombre"]
    assert result["nombre"].tolist() == ["Ana", "Beto"]


def test_merge_files_lee_csv_de_excel_en_windows_1252(tmp_path):
    path = tmp_path / "excel.csv"
    path.write_bytes("id;nombre\r\n1;Lucía\r\n".encode("cp1252"))

    result = merge_files([str(path)])

    assert result["nombre"].tolist() == ["Lucía"]


def test_merge_files_codificacion_cambia_despues_de_la_muestra(tmp_path, monkeypatch):
    # La muestra (primeros bytes) es ASCII puro y pasa como UTF-8, pero más adelante aparece un
    # byte de Windows-1252: la lectura completa tiene que reintentar con cp1252 en vez de fallar.
    import merger

    monkeypatch.setattr(merger, "_CSV_SAMPLE_BYTES", 16)
    path = tmp_path / "mixto.csv"
    path.write_bytes("id;nombre\r\n1;Ana\r\n2;Lucía\r\n".encode("cp1252"))

    result = merge_files([str(path)])

    assert result["nombre"].tolist() == ["Ana", "Lucía"]


def test_merge_files_usa_el_separador_elegido_a_mano(tmp_path):
    path = tmp_path / "raro.csv"
    path.write_text("id#nombre\n1#Ana\n", encoding="utf-8")

    result = merge_files([str(path)], csv_separators={str(path): "#"})

    assert list(result.columns) == ["id", "nombre"]


def test_merge_files_separador_elegido_a_mano_no_valido(tmp_path):
    path = _write_csv(tmp_path / "a.csv", {"id": [1]})

    with pytest.raises(MergeError) as exc:
        merge_files([path], csv_separators={path: '"'})
    assert exc.value.code == "invalid_csv_separator"


def test_join_files_con_csv_de_distintos_separadores(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id;seguro\n1;si\n2;no\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("id|gimnasio\n1|si\n", encoding="utf-8")

    result = join_files([str(a), str(b)], ["id", "id"], join_type="inner")

    assert list(result.columns) == ["id", "seguro", "gimnasio"]
    assert len(result) == 1


def test_inspect_csv_devuelve_formato_y_vista_previa(tmp_path):
    path = tmp_path / "a.csv"
    path.write_bytes("id;nombre\r\n1;Lucía\r\n2;Beto\r\n3;Cora\r\n4;Dani\r\n".encode("cp1252"))

    info = inspect_csv(str(path))

    assert info == {
        "separator": ";",
        "encoding": "cp1252",
        "confident": True,
        "columns": ["id", "nombre"],
        "rows": [["1", "Lucía"], ["2", "Beto"], ["3", "Cora"]],
    }


def test_inspect_csv_con_separador_elegido_a_mano_es_seguro(tmp_path):
    path = tmp_path / "a.csv"
    path.write_text("a,b;c\n1,2;3\n", encoding="utf-8")

    assert inspect_csv(str(path))["confident"] is False
    info = inspect_csv(str(path), ";")
    assert info["confident"] is True
    assert info["columns"] == ["a,b", "c"]


def test_inspect_csv_archivo_inexistente():
    with pytest.raises(MergeError) as exc:
        inspect_csv("/no/existe/archivo.csv")
    assert exc.value.code == "file_not_found"


# ---- columna de origen, claves como texto y nombres de columna al apilar ----


def test_merge_files_columna_de_origen_lleva_el_nombre_de_cada_archivo(tmp_path):
    a = _write_csv(tmp_path / "enero.csv", {"id": [1, 2], "valor": ["a", "b"]})
    b = _write_csv(tmp_path / "febrero.csv", {"id": [3], "valor": ["c"]})

    result = merge_files([a, b], add_source_column=True, source_column_name="source_file")

    assert list(result.columns) == ["source_file", "id", "valor"]
    assert result["source_file"].tolist() == ["enero.csv", "enero.csv", "febrero.csv"]


def test_merge_files_sin_columna_de_origen_no_la_agrega(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})

    assert "archivo_origen" not in merge_files([a]).columns


def test_merge_files_columna_de_origen_no_pisa_una_columna_existente(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"archivo_origen": ["x"], "id": [1]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})

    result = merge_files([a, b], add_source_column=True)

    assert result["archivo_origen"].iloc[0] == "x"
    assert pd.isna(result["archivo_origen"].iloc[1])
    assert result["archivo_origen_2"].tolist() == ["a.csv", "b.csv"]
    # el nombre real (con sufijo) queda expuesto para quien tenga que localizar la columna
    assert result.attrs["source_column"] == "archivo_origen_2"


def test_merge_files_sin_columna_de_origen_no_la_expone_en_attrs(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1]})

    assert "source_column" not in merge_files([a]).attrs


def test_merge_files_ignora_espacios_en_los_nombres_de_columna(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"Nombre": ["Ana"]})
    b = _write_csv(tmp_path / "b.csv", {"nombre ": ["Luis"]})
    c = _write_csv(tmp_path / "c.csv", {" Nombre": ["Eva"]})

    result = merge_files([a, b, c])

    # "Nombre" y "nombre " (distinto de mayúsculas) siguen siendo columnas distintas; lo que se
    # unifica son los espacios: " Nombre" cae en "Nombre".
    assert list(result.columns) == ["Nombre", "nombre"]
    assert result["Nombre"].iloc[0] == "Ana"
    assert result["Nombre"].iloc[2] == "Eva"


def test_join_files_con_celda_vacia_en_la_clave_conserva_las_coincidencias(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id,x\n1,a\n2,b\n,c\n", encoding="utf-8")
    b = _write_csv(tmp_path / "b.csv", {"id": [1, 2], "y": ["p", "q"]})

    result = join_files([str(a), b], ["id", "id"], join_type="inner")

    assert sorted(result["id"].tolist()) == ["1", "2"]


def test_join_files_conserva_ceros_a_la_izquierda_en_la_clave(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,x\n00123,a\n00456,b\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("dni,y\n00123,p\n", encoding="utf-8")

    result = join_files([str(a), str(b)], ["dni", "dni"], join_type="inner")

    assert result["dni"].tolist() == ["00123"]


def test_join_files_conserva_ceros_a_la_izquierda_en_excel_con_clave_vacia(tmp_path):
    a = tmp_path / "a.xlsx"
    pd.DataFrame({"dni": ["00123", "00456", None], "x": [1, 2, 3]}).to_excel(a, index=False)
    b = tmp_path / "b.xlsx"
    pd.DataFrame({"dni": ["00123", "00456"], "y": [1, 2]}).to_excel(b, index=False)

    result = join_files([str(a), str(b)], ["dni", "dni"], join_type="inner")

    assert sorted(result["dni"].tolist()) == ["00123", "00456"]


def test_merge_files_todo_como_texto_conserva_ceros_a_la_izquierda(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("codigo,n\n00123,1\n", encoding="utf-8")

    default = merge_files([str(a)])
    as_text = merge_files([str(a)], all_as_text=True)

    assert default["codigo"].tolist() == [123]
    assert as_text["codigo"].tolist() == ["00123"]
    assert as_text["n"].tolist() == ["1"]


def test_write_output_rechaza_extension_distinta_al_formato(tmp_path):
    out = tmp_path / "salida.bat"

    with pytest.raises(MergeError) as exc:
        write_output(pd.DataFrame({"a": [1]}), str(out), "csv")

    assert exc.value.code == "output_extension_mismatch"
    assert not out.exists()


def test_write_output_acepta_la_extension_en_mayusculas(tmp_path):
    out = tmp_path / "SALIDA.CSV"

    write_output(pd.DataFrame({"a": [1]}), str(out), "csv")

    assert out.exists()


# ---- Fase 4: enteros con huecos, hojas, encabezados, límites y .xls falsos ----


def test_merge_files_enteros_con_huecos_no_pasan_a_decimales(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2], "cantidad": [5, 6]})
    b = _write_csv(tmp_path / "b.csv", {"id": [3]})

    result = merge_files([a, b])
    out = tmp_path / "salida.csv"
    write_output(result, str(out), "csv")

    assert out.read_text(encoding="utf-8-sig").splitlines() == ["id,cantidad", "1,5", "2,6", "3,"]


def test_merge_files_enteros_con_huecos_tambien_en_xlsx_y_xls(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1], "cantidad": [5]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    result = merge_files([a, b])

    for fmt in ("xlsx", "xls"):
        out = tmp_path / f"salida.{fmt}"
        write_output(result, str(out), fmt)
        engine = "openpyxl" if fmt == "xlsx" else "xlrd"
        back = pd.read_excel(out, engine=engine)
        assert back["id"].tolist() == [1, 2]
        assert back["cantidad"].iloc[0] == 5


def test_write_output_xls_escribe_enteros_int64_como_numero_y_no_como_texto(tmp_path):
    # pandas reconvierte "1" a número al releer, así que se mira el tipo real de la celda con xlrd:
    # las columnas Int64 entregan numpy.int64, que antes se escribía como texto.
    import xlrd

    a = _write_csv(tmp_path / "a.csv", {"id": [1], "cantidad": [5], "precio": [1.5]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2]})
    out = tmp_path / "salida.xls"
    write_output(merge_files([a, b]), str(out), "xls")

    sheet = xlrd.open_workbook(str(out)).sheet_by_index(0)
    assert sheet.cell_type(1, 0) == xlrd.XL_CELL_NUMBER
    assert sheet.cell_value(1, 0) == 1
    assert sheet.cell_type(1, 1) == xlrd.XL_CELL_NUMBER
    assert sheet.cell_type(1, 2) == xlrd.XL_CELL_NUMBER
    assert sheet.cell_type(2, 0) == xlrd.XL_CELL_NUMBER
    assert sheet.cell_type(2, 1) == xlrd.XL_CELL_EMPTY  # celda vacía: se escribe ""


def test_merge_files_los_decimales_reales_no_se_tocan(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"precio": [1.5, 2.0]})

    assert merge_files([a])["precio"].tolist() == [1.5, 2.0]


def _write_two_sheet_xlsx(path):
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame({"id": [1, 2], "a": ["x", "y"]}).to_excel(writer, sheet_name="Uno", index=False)
        pd.DataFrame({"id": [3], "b": ["z"]}).to_excel(writer, sheet_name="Dos", index=False)
    return str(path)


def test_list_sheets(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")
    csv_path = _write_csv(tmp_path / "a.csv", {"id": [1]})

    assert list_sheets(xlsx) == ["Uno", "Dos"]
    assert list_sheets(csv_path) == []


def test_merge_files_sin_hoja_elegida_combina_todas(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")

    result = merge_files([xlsx])

    assert result["id"].tolist() == [1, 2, 3]


def test_merge_files_con_hoja_elegida_lee_solo_esa(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")

    result = merge_files([xlsx], sheets={xlsx: "Dos"})

    assert result["id"].tolist() == [3]
    assert list(result.columns) == ["id", "b"]


def test_merge_files_hoja_inexistente(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")

    with pytest.raises(MergeError) as exc:
        merge_files([xlsx], sheets={xlsx: "NoExiste"})
    assert exc.value.code == "sheet_not_found"


def test_join_files_con_hoja_elegida(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")
    other = _write_csv(tmp_path / "otro.csv", {"id": [3, 1], "c": ["p", "q"]})

    result = join_files([xlsx, other], ["id", "id"], sheets={xlsx: "Dos"})

    assert result["id"].tolist() == ["3"]
    assert "b" in result.columns


def test_read_file_columns_lee_solo_los_encabezados(tmp_path, monkeypatch):
    path = _write_csv(tmp_path / "a.csv", {"id": [1, 2, 3], "nombre": ["a", "b", "c"]})
    seen = {}
    real = pd.read_csv

    def spy(*args, **kwargs):
        seen["nrows"] = kwargs.get("nrows")
        return real(*args, **kwargs)

    monkeypatch.setattr(pd, "read_csv", spy)

    assert read_file_columns(path) == ["id", "nombre"]
    assert seen["nrows"] == 0


def test_read_file_columns_excel_y_hoja(tmp_path):
    xlsx = _write_two_sheet_xlsx(tmp_path / "libro.xlsx")

    assert read_file_columns(xlsx, sheet="Dos") == ["id", "b"]
    assert read_file_columns(xlsx) == ["id", "a", "b"]


def test_write_output_xlsx_supera_el_limite_de_filas(tmp_path, monkeypatch):
    monkeypatch.setattr(merger, "XLSX_MAX_ROWS", 2)
    df = pd.DataFrame({"a": [1, 2, 3]})

    with pytest.raises(MergeError) as exc:
        write_output(df, str(tmp_path / "salida.xlsx"), "xlsx")
    assert exc.value.code == "xlsx_row_limit"
    assert exc.value.params["rows"] == 3


def test_xls_falso_en_html_se_lee_como_tabla(tmp_path):
    path = tmp_path / "informe.xls"
    path.write_text(
        "<html><body><table><tr><th>id</th><th>nombre</th></tr>"
        "<tr><td>1</td><td>Ana</td></tr><tr><td>2</td><td>Beto</td></tr></table></body></html>",
        encoding="utf-8",
    )

    result = merge_files([str(path)])

    assert list(result.columns) == ["id", "nombre"]
    assert result["nombre"].tolist() == ["Ana", "Beto"]
    assert read_file_columns(str(path)) == ["id", "nombre"]


def test_xls_falso_en_texto_se_lee_como_csv(tmp_path):
    path = tmp_path / "datos.xls"
    path.write_text("id;nombre\n1;Ana\n2;Beto\n", encoding="utf-8")

    result = merge_files([str(path)])

    assert list(result.columns) == ["id", "nombre"]
    assert result["id"].tolist() == [1, 2]


def test_xls_falso_sin_tabla_da_error_de_lectura(tmp_path):
    path = tmp_path / "vacio.xls"
    path.write_text("<html><body>nada</body></html>", encoding="utf-8")

    with pytest.raises(MergeError) as exc:
        merge_files([str(path)])
    assert exc.value.code == "file_read_error"


def test_xls_autentico_sigue_leyendose_con_xlrd(tmp_path):
    path = tmp_path / "real.xls"
    write_output(pd.DataFrame({"id": [1, 2]}), str(path), "xls")

    assert merge_files([str(path)])["id"].tolist() == [1, 2]


# ---- drop_duplicate_rows (quitar filas duplicadas del resultado) ----


def test_drop_duplicate_rows_quita_y_cuenta_duplicados_exactos_al_apilar(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2], "nombre": ["Ana", "Beto"]})
    b = _write_csv(tmp_path / "b.csv", {"id": [2, 3], "nombre": ["Beto", "Cora"]})

    result, removed = drop_duplicate_rows(merge_files([a, b]))

    assert removed == 1
    assert result.values.tolist() == [[1, "Ana"], [2, "Beto"], [3, "Cora"]]
    assert list(result.index) == [0, 1, 2]


def test_drop_duplicate_rows_conserva_la_primera_aparicion_en_orden(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [3, 1, 3, 2, 1], "n": ["c", "a", "c", "b", "a"]})

    result, removed = drop_duplicate_rows(merge_files([a]))

    assert removed == 2
    assert result.values.tolist() == [[3, "c"], [1, "a"], [2, "b"]]
    # índice renumerado: no quedan huecos de las filas quitadas
    assert list(result.index) == [0, 1, 2]


def test_drop_duplicate_rows_ignora_la_columna_de_origen_al_comparar(tmp_path):
    a = _write_csv(tmp_path / "enero.csv", {"id": [1, 2], "nombre": ["Ana", "Beto"]})
    b = _write_csv(tmp_path / "febrero.csv", {"id": [1], "nombre": ["Ana"]})
    combined = merge_files([a, b], add_source_column=True)

    # Sin ignorarla, la fila repetida de febrero no es duplicada (cambia el archivo de origen).
    assert drop_duplicate_rows(combined)[1] == 0

    result, removed = drop_duplicate_rows(combined, ignore_columns=[combined.attrs["source_column"]])

    assert removed == 1
    assert list(result.columns) == ["archivo_origen", "id", "nombre"]
    # la columna de origen se conserva con el valor de la fila que se queda (la primera)
    assert result.values.tolist() == [["enero.csv", 1, "Ana"], ["enero.csv", 2, "Beto"]]


def test_drop_duplicate_rows_considera_iguales_las_celdas_vacias(tmp_path):
    path = tmp_path / "a.csv"
    path.write_text("id,nota\n1,\n1,\n2,x\n", encoding="utf-8")

    result, removed = drop_duplicate_rows(merge_files([str(path)]))

    assert removed == 1
    assert result["id"].tolist() == [1, 2]
    # también un `None` y un `NaN` en la misma columna cuentan como la misma celda vacía
    _, removed_mixed = drop_duplicate_rows(pd.DataFrame({"a": ["x", "x"], "b": [None, float("nan")]}))
    assert removed_mixed == 1


def test_drop_duplicate_rows_no_iguala_numero_y_texto(tmp_path):
    # En "a" la columna x mezcla texto ("1", "z") y se lee como texto; en "b" solo tiene números y
    # se lee como entero. Al apilar, la misma columna tiene el texto "1" y el número 1: son
    # valores de tipo distinto y no se convierten para comparar.
    a = _write_csv(tmp_path / "a.csv", {"x": ["1", "z"], "y": ["foo", "bar"]})
    b = _write_csv(tmp_path / "b.csv", {"x": [1], "y": ["foo"]})
    combined = merge_files([a, b])
    assert isinstance(combined["x"].iloc[0], str)
    assert not isinstance(combined["x"].iloc[2], str)

    result, removed = drop_duplicate_rows(combined)

    assert removed == 0
    assert len(result) == 3


def test_drop_duplicate_rows_sin_duplicados_devuelve_cero(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2, 3], "n": ["a", "b", "c"]})
    combined = merge_files([a])

    result, removed = drop_duplicate_rows(combined)

    assert removed == 0
    pd.testing.assert_frame_equal(result, combined)


def test_drop_duplicate_rows_tambien_en_el_resultado_de_un_join(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 1, 2], "n": ["a", "a", "b"]})
    b = _write_csv(tmp_path / "b.csv", {"id": [1, 2], "c": ["x", "y"]})

    result, removed = drop_duplicate_rows(join_files([a, b], ["id", "id"], "left"))

    assert removed == 1
    assert result.values.tolist() == [["1", "a", "x"], ["2", "b", "y"]]


# ---- build_result (combinar + estadísticas) ----


def _two_sheet_xlsx(path, first, second):
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame(first).to_excel(writer, sheet_name="Uno", index=False)
        pd.DataFrame(second).to_excel(writer, sheet_name="Dos", index=False)
    return str(path)


def _spy_reads(monkeypatch):
    """Cuenta las lecturas de cada archivo (`{ruta: veces}`) espiando `_read_spreadsheet`."""
    calls = {}
    original = merger._read_spreadsheet

    def spy(path, *args, **kwargs):
        calls[path] = calls.get(path, 0) + 1
        return original(path, *args, **kwargs)

    monkeypatch.setattr(merger, "_read_spreadsheet", spy)
    return calls


def test_build_result_estadisticas_al_apilar(tmp_path, monkeypatch):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2], "nombre": ["Ana", "Beto"]})
    # b: todas las hojas (2 + 1 filas); la fila (1, Ana) repite una de "a"
    b = _two_sheet_xlsx(
        tmp_path / "b.xlsx", {"id": [1, 3], "nombre": ["Ana", "Cora"]}, {"id": [4], "nombre": ["Dani"]}
    )
    # c: solo la hoja "Dos" (1 fila)
    c = _two_sheet_xlsx(
        tmp_path / "c.xlsx", {"id": [9, 9], "nombre": ["X", "Y"]}, {"id": [5], "nombre": ["Eva"]}
    )
    reads = _spy_reads(monkeypatch)

    df, stats = merger.build_result(
        [a, b, c], mode="concat", add_source_column=True, remove_duplicates=True, sheets={c: "Dos"}
    )

    assert reads == {a: 1, b: 1, c: 1}
    assert stats == {
        "mode": "concat",
        "joinType": None,
        "files": [
            {"name": "a.csv", "sheet": None, "rowsRead": 2},
            {"name": "b.xlsx", "sheet": None, "rowsRead": 3},
            {"name": "c.xlsx", "sheet": "Dos", "rowsRead": 1},
        ],
        "resultRows": 5,
        "resultColumns": 3,
        "duplicatesRemoved": 1,
        "options": {"addSourceColumn": True, "allAsText": False, "removeDuplicates": True},
    }
    assert len(df) == 5
    assert list(df.columns) == ["archivo_origen", "id", "nombre"]


def test_build_result_sin_quitar_duplicados_cuenta_cero(tmp_path):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 1]})

    df, stats = merger.build_result([a], all_as_text=True)

    assert stats["duplicatesRemoved"] == 0
    assert stats["resultRows"] == 2
    assert stats["options"] == {"addSourceColumn": False, "allAsText": True, "removeDuplicates": False}
    assert len(df) == 2


def _three_join_files(tmp_path):
    """Tres CSV para el join por `id`, con las cuentas hechas a mano en cada test.

    En qué archivos aparece cada clave: 1 -> {a}, 2 -> {a, b}, 3 -> {a, b, c}, 4 -> {a},
    5 -> {b}, 6 -> {b, c}, 7 -> {c} (" 7 " se recorta). Claves vacías: una celda vacía en "a",
    otra en "b" y una de solo espacios en "c".
    """
    a = tmp_path / "a.csv"
    a.write_text("id,x\n1,a1\n2,a2\n3,a3\n4,a4\n,a5\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("id,y\n2,b1\n3,b2\n5,b3\n6,b4\n,b5\n", encoding="utf-8")
    c = tmp_path / "c.csv"
    c.write_text('id,z\n3,c1\n6,c2\n" 7 ",c3\n"   ",c4\n', encoding="utf-8")
    return str(a), str(b), str(c)


# Esperado por archivo, igual para cualquier tipo de join (es una medida de la entrada):
# a: sin coincidencia 1 y 4 (2), una vacía; b: sin coincidencia 5 (1), una vacía;
# c: sin coincidencia 7 (1), una vacía (solo espacios).
_THREE_JOIN_FILES_STATS = [
    {"name": "a.csv", "sheet": None, "rowsRead": 5, "keyColumn": "id", "unmatchedRows": 2, "emptyKeyRows": 1},
    {"name": "b.csv", "sheet": None, "rowsRead": 5, "keyColumn": "id", "unmatchedRows": 1, "emptyKeyRows": 1},
    {"name": "c.csv", "sheet": None, "rowsRead": 4, "keyColumn": "id", "unmatchedRows": 1, "emptyKeyRows": 1},
]


def test_build_result_estadisticas_join_inner_con_tres_archivos(tmp_path, monkeypatch):
    a, b, c = _three_join_files(tmp_path)
    reads = _spy_reads(monkeypatch)

    df, stats = merger.build_result([a, b, c], mode="join", join_keys=["id", "id", "id"], join_type="inner")

    assert reads == {a: 1, b: 1, c: 1}
    assert df["id"].tolist() == ["3"]
    assert stats == {
        "mode": "join",
        "joinType": "inner",
        "files": _THREE_JOIN_FILES_STATS,
        "resultRows": 1,
        "resultColumns": 4,
        "duplicatesRemoved": 0,
        "options": {"addSourceColumn": False, "allAsText": False, "removeDuplicates": False},
    }


def test_build_result_estadisticas_join_left_anti_con_tres_archivos(tmp_path, monkeypatch):
    a, b, c = _three_join_files(tmp_path)
    reads = _spy_reads(monkeypatch)

    df, stats = merger.build_result(
        [a, b, c],
        mode="join",
        join_keys=["id", "id", "id"],
        join_type="left_anti",
        # en join la columna de origen no se aplica: la opción efectiva es False
        add_source_column=True,
    )

    assert reads == {a: 1, b: 1, c: 1}
    assert df["x"].tolist() == ["a1", "a4", "a5"]
    assert stats["joinType"] == "left_anti"
    assert stats["files"] == _THREE_JOIN_FILES_STATS
    assert (stats["resultRows"], stats["resultColumns"]) == (3, 2)
    assert stats["options"]["addSourceColumn"] is False


def test_build_result_join_con_claves_de_distinto_nombre_y_hoja(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,n\n001,Ana\n002,Beto\n", encoding="utf-8")
    b = _two_sheet_xlsx(tmp_path / "b.xlsx", {"otro": [1]}, {"documento": ["001", "009"], "c": ["x", "y"]})

    _, stats = merger.build_result(
        [str(a), b], mode="join", join_keys=["dni", "documento"], join_type="left", sheets={b: "Dos"}
    )

    assert stats["files"] == [
        {
            "name": "a.csv",
            "sheet": None,
            "rowsRead": 2,
            "keyColumn": "dni",
            "unmatchedRows": 1,
            "emptyKeyRows": 0,
        },
        {
            "name": "b.xlsx",
            "sheet": "Dos",
            "rowsRead": 2,
            "keyColumn": "documento",
            "unmatchedRows": 1,
            "emptyKeyRows": 0,
        },
    ]


def test_build_result_es_serializable_a_json(tmp_path):
    import json

    a, b, c = _three_join_files(tmp_path)

    _, stats = merger.build_result([a, b, c], mode="join", join_keys=["id"] * 3, join_type="outer")

    assert json.loads(json.dumps(stats)) == stats


# ---- informe de la combinación (build_report / write_output con report) ----


_FIXED_DATE = __import__("datetime").datetime(2026, 10, 14, 9, 5)

_EN_LABELS = {
    "sheetName": "Report",
    "fileSuffix": "report",
    "generatedAt": "Date and time",
    "mode": "Mode",
    "modeConcat": "Stack rows",
    "modeJoin": "Join by key",
    "joinType": "Join type",
    "joinInner": "Inner join",
    "joinLeftAnti": "Left anti join",
    "resultRows": "Result rows",
    "resultColumns": "Result columns",
    "duplicatesRemoved": "Duplicate rows removed",
    "addSourceColumn": "Add source column",
    "allAsText": "All as text",
    "removeDuplicates": "Remove duplicates",
    "yes": "Yes",
    "no": "No",
    "file": "File",
    "sheet": "Sheet",
    "allSheets": "All",
    "rowsRead": "Rows read",
    "keyColumn": "Key column",
    "unmatchedRows": "Unmatched rows",
    "emptyKeyRows": "Empty key rows",
}


def _concat_report(tmp_path, labels=None):
    a = _write_csv(tmp_path / "a.csv", {"id": [1, 2]})
    b = _two_sheet_xlsx(tmp_path / "b.xlsx", {"id": [3]}, {"id": [4]})
    df, stats = merger.build_result([a, b], remove_duplicates=True, sheets={b: "Dos"})
    return df, merger.build_report(stats, labels, generated_at=_FIXED_DATE)


def test_build_report_apilar_en_espanol_por_defecto(tmp_path):
    _, report = _concat_report(tmp_path)

    assert report["sheet_name"] == "Informe"
    assert report["file_suffix"] == "informe"
    assert report["rows"] == [
        ["Fecha y hora", "2026-10-14 09:05"],
        ["Modo de combinación", "Apilar filas"],
        ["Filas del resultado", 3],
        ["Columnas del resultado", 1],
        ["Filas duplicadas quitadas", 0],
        ["Añadir columna con nombre de archivo origen", "No"],
        ["Leer todas las columnas como texto (conserva ceros a la izquierda)", "No"],
        ["Quitar filas duplicadas", "Sí"],
        [],
        ["Archivo", "Hoja", "Filas leídas"],
        ["a.csv", "Todas", 2],
        ["b.xlsx", "Dos", 1],
    ]


def test_build_report_join_con_etiquetas_traducidas(tmp_path):
    a, b, c = _three_join_files(tmp_path)
    _, stats = merger.build_result([a, b, c], mode="join", join_keys=["id"] * 3, join_type="left_anti")

    report = merger.build_report(stats, _EN_LABELS, generated_at=_FIXED_DATE)

    assert report["rows"][:3] == [
        ["Date and time", "2026-10-14 09:05"],
        ["Mode", "Join by key"],
        ["Join type", "Left anti join"],
    ]
    assert report["rows"][10:] == [
        ["File", "Sheet", "Rows read", "Key column", "Unmatched rows", "Empty key rows"],
        ["a.csv", "All", 5, "id", 2, 1],
        ["b.csv", "All", 5, "id", 1, 1],
        ["c.csv", "All", 4, "id", 1, 1],
    ]
    # el bloque resumen lleva en join una fila más (tipo de join) antes de la fila en blanco
    assert report["rows"][9] == []


def test_build_report_ignora_etiquetas_invalidas(tmp_path):
    labels = {"sheetName": 42, "mode": "   ", "yes": None, "resultRows": "Rows", "inventada": "x"}

    _, report = _concat_report(tmp_path, labels)

    assert report["sheet_name"] == "Informe"
    assert report["rows"][1] == ["Modo de combinación", "Apilar filas"]
    assert report["rows"][2] == ["Rows", 3]
    assert report["rows"][7] == ["Quitar filas duplicadas", "Sí"]


def test_report_sheet_name_sanea_y_trunca():
    assert merger.report_sheet_name("Informe: [enero]/a*b?c\\d") == "Informe eneroabcd"
    long_name = "Relatório da combinação de arquivos 2026"
    assert merger.report_sheet_name(long_name) == long_name[:31].strip()
    assert len(merger.report_sheet_name("x" * 50)) == 31
    assert merger.report_sheet_name("'Bericht'") == "Bericht"
    # vacío tras limpiar, o igual que la hoja de datos: nombre por defecto
    assert merger.report_sheet_name("[]:*?/\\") == "Informe"
    assert merger.report_sheet_name("sheet1") == "Informe"
    assert merger.report_sheet_name("Combinado", "Combinado") == "Informe"


def test_write_output_xlsx_con_informe_en_una_segunda_hoja(tmp_path):
    df, report = _concat_report(tmp_path, _EN_LABELS)
    out = tmp_path / "salida.xlsx"

    write_output(df, str(out), "xlsx", report=report)

    assert pd.ExcelFile(out).sheet_names == ["Sheet1", "Report"]
    assert pd.read_excel(out, sheet_name="Sheet1")["id"].tolist() == [1, 2, 4]
    sheet = pd.read_excel(out, sheet_name="Report", header=None, dtype=object)
    assert sheet.iloc[0].tolist()[:2] == ["Date and time", "2026-10-14 09:05"]
    assert sheet.iloc[2].tolist()[:2] == ["Result rows", 3]
    assert sheet.iloc[8].isna().all()
    assert sheet.iloc[9].tolist() == ["File", "Sheet", "Rows read"]
    assert sheet.iloc[10].tolist() == ["a.csv", "All", 2]
    assert sheet.iloc[11].tolist() == ["b.xlsx", "Dos", 1]


def test_write_output_ods_con_informe_en_una_segunda_hoja(tmp_path):
    df, report = _concat_report(tmp_path)
    out = tmp_path / "salida.ods"

    write_output(df, str(out), "ods", report=report)

    assert pd.ExcelFile(out, engine="odf").sheet_names == ["Sheet1", "Informe"]
    sheet = pd.read_excel(out, sheet_name="Informe", header=None, engine="odf")
    assert sheet.iloc[1].tolist()[:2] == ["Modo de combinación", "Apilar filas"]
    assert sheet.iloc[-1].tolist() == ["b.xlsx", "Dos", 1]


def test_write_output_xls_con_informe_en_una_segunda_hoja(tmp_path):
    import xlrd

    df, report = _concat_report(tmp_path, _EN_LABELS)
    out = tmp_path / "salida.xls"

    write_output(df, str(out), "xls", report=report)

    book = xlrd.open_workbook(str(out))
    assert book.sheet_names() == ["Combinado", "Report"]
    data = book.sheet_by_name("Combinado")
    assert data.nrows == 4 and data.cell_value(0, 0) == "id"
    sheet = book.sheet_by_name("Report")
    assert sheet.row_values(0)[:2] == ["Date and time", "2026-10-14 09:05"]
    assert sheet.row_values(10)[:3] == ["a.csv", "All", 2]


def test_write_output_csv_con_informe_en_un_archivo_aparte(tmp_path):
    df, report = _concat_report(tmp_path, _EN_LABELS)
    out = tmp_path / "salida.csv"

    write_output(df, str(out), "csv", csv_separator=";", report=report)

    report_path = tmp_path / "salida_report.csv"
    assert merger.report_output_path(str(out), "csv", report) == str(report_path)
    assert report_path.read_bytes().startswith(b"\xef\xbb\xbf")
    lines = report_path.read_text(encoding="utf-8-sig").splitlines()
    assert lines[0] == "Date and time;2026-10-14 09:05"
    assert lines[2] == "Result rows;3"
    assert lines[8] == ""
    assert lines[9:] == ["File;Sheet;Rows read", "a.csv;All;2", "b.xlsx;Dos;1"]
    # el CSV principal no cambia
    assert out.read_text(encoding="utf-8-sig").splitlines() == ["id", "1", "2", "4"]


def test_report_output_path_solo_en_csv(tmp_path):
    _, report = _concat_report(tmp_path)

    assert merger.report_output_path("/x/datos.csv", "csv", report) == "/x/datos_informe.csv"
    assert merger.report_output_path("/x/datos.xlsx", "xlsx", report) is None
    assert merger.report_output_path("/x/datos.csv", "csv", None) is None
    # el sufijo se limpia igual que `sanitizeFileName` del frontend
    report_raro = merger.build_report({"mode": "concat"}, {"fileSuffix": ' in<for>me:"1"?*| '})
    assert merger.report_output_path("/x/datos.csv", "csv", report_raro) == "/x/datos_informe1.csv"


@pytest.mark.parametrize("output_format", ["xlsx", "ods", "xls", "csv"])
def test_write_output_sin_informe_escribe_un_solo_archivo_y_una_sola_hoja(tmp_path, output_format):
    out_dir = tmp_path / "salida"
    out_dir.mkdir()
    out = out_dir / f"combinado.{output_format}"

    write_output(pd.DataFrame({"id": [1, 2]}), str(out), output_format)

    assert [p.name for p in out_dir.iterdir()] == [out.name]
    if output_format in ("xlsx", "ods"):
        assert pd.ExcelFile(out).sheet_names == ["Sheet1"]
    elif output_format == "xls":
        assert pd.ExcelFile(out, engine="xlrd").sheet_names == ["Combinado"]
