"""Tests de los endpoints de backend/server.py con el cliente de pruebas de Flask."""

import time

import pandas as pd
import pytest

import server

TOKEN = "token-de-prueba"


@pytest.fixture
def client():
    """Cliente de Flask que ya envía el token de autenticación en cada petición."""
    server.app.config["TESTING"] = True
    server.app.config["AUTH_TOKEN"] = TOKEN
    with server.app.test_client() as test_client:
        test_client.environ_base["HTTP_X_AUTH_TOKEN"] = TOKEN
        yield test_client


@pytest.fixture
def anonymous_client():
    """Cliente de Flask sin token, como lo vería una web ajena."""
    server.app.config["TESTING"] = True
    server.app.config["AUTH_TOKEN"] = TOKEN
    with server.app.test_client() as test_client:
        yield test_client


def _run_merge(client, payload):
    response = client.post("/api/merge", json=payload)
    assert response.status_code == 202, response.get_json()
    job_id = response.get_json()["job_id"]
    for _ in range(100):
        status = client.get(f"/api/status/{job_id}").get_json()
        if status["status"] in ("done", "error"):
            return status
        time.sleep(0.05)
    raise AssertionError("el trabajo no terminó")


def test_merge_aplica_la_columna_de_origen_y_su_nombre(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id\n1\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("id\n2\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a), str(b)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "add_source_column": True,
            "source_column_name": "source_file",
        },
    )

    assert status["status"] == "done", status
    result = pd.read_csv(out, dtype=str)
    assert result["source_file"].tolist() == ["a.csv", "b.csv"]


def test_merge_sin_la_opcion_no_agrega_columna_de_origen(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id\n1\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client, {"files": [str(a)], "output_format": "csv", "output_path": str(out), "mode": "concat"}
    )

    assert status["status"] == "done", status
    assert list(pd.read_csv(out).columns) == ["id"]


def test_merge_aplica_todo_como_texto(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("codigo\n00123\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "all_as_text": True,
        },
    )

    assert status["status"] == "done", status
    assert pd.read_csv(out, dtype=str)["codigo"].tolist() == ["00123"]


def test_merge_join_conserva_ceros_en_la_clave(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,x\n00123,a\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("dni,y\n00123,p\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a), str(b)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "join",
            "join_keys": {str(a): "dni", str(b): "dni"},
            "join_type": "inner",
        },
    )

    assert status["status"] == "done", status
    assert pd.read_csv(out, dtype=str)["dni"].tolist() == ["00123"]


def test_merge_right_anti_con_tres_archivos_recibe_400(client, tmp_path):
    paths = []
    for name in ("a", "b", "c"):
        path = tmp_path / f"{name}.csv"
        path.write_text("id\n1\n", encoding="utf-8")
        paths.append(str(path))
    out = tmp_path / "salida.csv"

    response = client.post(
        "/api/merge",
        json={
            "files": paths,
            "output_format": "csv",
            "output_path": str(out),
            "mode": "join",
            "join_keys": {p: "id" for p in paths},
            "join_type": "right_anti",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["code"] == "right_anti_two_files"
    assert not out.exists()


def test_merge_left_anti_escribe_las_filas_sin_coincidencia(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,nombre\n00123,Ana\n00456,Beto\n,Cora\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("documento,ciudad\n00456,Lima\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a), str(b)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "join",
            "join_keys": {str(a): "dni", str(b): "documento"},
            "join_type": "left_anti",
        },
    )

    assert status["status"] == "done", status
    result = pd.read_csv(out, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    assert list(result.columns) == ["dni", "nombre"]
    assert result.values.tolist() == [["00123", "Ana"], ["", "Cora"]]


# ---- quitar filas duplicadas ----


def _two_csv_with_a_repeated_row(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id,nombre\n1,Ana\n2,Beto\n1,Ana\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("id,nombre\n2,Beto\n3,Cora\n", encoding="utf-8")
    return str(a), str(b)


def test_merge_quita_filas_duplicadas_al_apilar(client, tmp_path):
    a, b = _two_csv_with_a_repeated_row(tmp_path)
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [a, b],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "add_source_column": True,
            "remove_duplicates": True,
        },
    )

    assert status["status"] == "done", status
    assert status["code"] == "merge_done_duplicates"
    assert status["params"] == {"duplicatesRemoved": 2, "count": 2}
    assert "Se quitaron 2 filas duplicadas." in status["message"]
    result = pd.read_csv(out, dtype=str, encoding="utf-8-sig")
    # la columna de origen no impide detectar la fila de "b" repetida de "a", y se conserva
    assert result.values.tolist() == [["a.csv", "1", "Ana"], ["a.csv", "2", "Beto"], ["b.csv", "3", "Cora"]]


def test_merge_sin_la_opcion_no_quita_duplicados(client, tmp_path):
    a, b = _two_csv_with_a_repeated_row(tmp_path)
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {"files": [a, b], "output_format": "csv", "output_path": str(out), "mode": "concat"},
    )

    assert status["status"] == "done", status
    assert status["code"] == "merge_done"
    assert status["params"] == {"duplicatesRemoved": 0}
    assert len(pd.read_csv(out)) == 5


def test_merge_con_la_opcion_y_sin_duplicados_mantiene_merge_done(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id\n1\n2\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "remove_duplicates": True,
        },
    )

    assert status["code"] == "merge_done"
    assert status["params"] == {"duplicatesRemoved": 0}


def test_merge_quita_filas_duplicadas_en_un_join(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("dni,nombre\n001,Ana\n001,Ana\n002,Beto\n", encoding="utf-8")
    b = tmp_path / "b.csv"
    b.write_text("dni,ciudad\n001,Lima\n002,Quito\n", encoding="utf-8")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [str(a), str(b)],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "join",
            "join_keys": {str(a): "dni", str(b): "dni"},
            "join_type": "inner",
            "remove_duplicates": True,
        },
    )

    assert status["status"] == "done", status
    assert status["code"] == "merge_done_duplicates"
    assert status["params"] == {"duplicatesRemoved": 1, "count": 1}
    assert status["message"] == "Combinación completada. Se quitó 1 fila duplicada."
    result = pd.read_csv(out, dtype=str, encoding="utf-8-sig")
    assert result.values.tolist() == [["001", "Ana", "Lima"], ["002", "Beto", "Quito"]]


# ---- informe de la combinación ----


def test_merge_con_informe_en_csv_devuelve_report_path(client, tmp_path):
    a, b = _two_csv_with_a_repeated_row(tmp_path)
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [a, b],
            "output_format": "csv",
            "output_csv_separator": ";",
            "output_path": str(out),
            "mode": "concat",
            "remove_duplicates": True,
            "include_report": True,
            "report_labels": {"fileSuffix": "report", "resultRows": "Result rows", "file": "File"},
        },
    )

    assert status["status"] == "done", status
    report_path = tmp_path / "salida_report.csv"
    assert status["report_path"] == str(report_path)
    assert report_path.exists()
    lines = report_path.read_text(encoding="utf-8-sig").splitlines()
    assert "Result rows;3" in lines
    # lo que no llegó en report_labels sale en español
    assert "Filas duplicadas quitadas;2" in lines
    assert lines[-3:] == ["File;Hoja;Filas leídas", "a.csv;Todas;3", "b.csv;Todas;2"]


def test_merge_con_informe_en_xlsx_no_tiene_report_path(client, tmp_path):
    a, b = _two_csv_with_a_repeated_row(tmp_path)
    out = tmp_path / "salida.xlsx"

    status = _run_merge(
        client,
        {
            "files": [a, b],
            "output_format": "xlsx",
            "output_path": str(out),
            "mode": "join",
            "join_keys": {a: "id", b: "id"},
            "join_type": "inner",
            "include_report": True,
            # basura: se ignora lo que no es una clave conocida con un texto
            "report_labels": {"sheetName": ["x"], "inventada": "x", "joinInner": 3},
        },
    )

    assert status["status"] == "done", status
    assert status["report_path"] is None
    assert pd.ExcelFile(out).sheet_names == ["Sheet1", "Informe"]
    sheet = pd.read_excel(out, sheet_name="Informe", header=None)
    assert sheet.iloc[2].tolist()[:2] == ["Tipo de join", "Inner join (intersección)"]


def test_merge_sin_informe_escribe_solo_el_resultado(client, tmp_path):
    a, b = _two_csv_with_a_repeated_row(tmp_path)
    out_dir = tmp_path / "salida"
    out_dir.mkdir()
    out = out_dir / "combinado.csv"

    status = _run_merge(
        client,
        {
            "files": [a, b],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "report_labels": {"fileSuffix": "report"},
        },
    )

    assert status["status"] == "done", status
    assert status["report_path"] is None
    assert [p.name for p in out_dir.iterdir()] == ["combinado.csv"]


def test_report_labels_solo_acepta_claves_conocidas_con_texto():
    assert server._report_labels_from({}) == {}
    assert server._report_labels_from({"report_labels": "Informe"}) == {}
    assert server._report_labels_from({"report_labels": ["Informe"]}) == {}
    assert server._report_labels_from(
        {"report_labels": {"sheetName": "Report", "yes": "", "no": 0, "otra": "x", "file": {"a": 1}}}
    ) == {"sheetName": "Report"}


# ---- seguridad: token, CORS y extensión de salida ----


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/health"),
        ("post", "/api/inspect-csv"),
        ("post", "/api/columns"),
        ("post", "/api/merge"),
        ("get", "/api/status/x"),
    ],
)
def test_peticion_sin_token_recibe_401(anonymous_client, method, path):
    response = getattr(anonymous_client, method)(path, json={"files": []})

    assert response.status_code == 401
    assert response.get_json()["code"] == "unauthorized"


def test_peticion_con_token_incorrecto_recibe_401(anonymous_client):
    response = anonymous_client.get("/api/health", headers={"X-Auth-Token": "otro"})

    assert response.status_code == 401


def test_inspect_csv_sin_token_no_filtra_el_contenido_del_archivo(anonymous_client, tmp_path):
    secret = tmp_path / "secreto.csv"
    secret.write_text("clave,valor\nuno,contenido-privado\n", encoding="utf-8")

    response = anonymous_client.post("/api/inspect-csv", json={"files": [str(secret)]})

    assert response.status_code == 401
    assert b"contenido-privado" not in response.data


def test_sin_token_configurado_en_el_servidor_se_rechaza_todo(client):
    server.app.config["AUTH_TOKEN"] = None

    assert client.get("/api/health").status_code == 401


def test_peticion_con_token_correcto_funciona(client):
    assert client.get("/api/health").status_code == 200


def test_cors_ya_no_acepta_cualquier_origen(client):
    ajeno = client.get("/api/health", headers={"Origin": "https://sitio-malicioso.example"})
    propio = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    file_origin = client.get("/api/health", headers={"Origin": "null"})

    assert "Access-Control-Allow-Origin" not in ajeno.headers
    assert propio.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert file_origin.headers["Access-Control-Allow-Origin"] == "null"


def test_preflight_no_necesita_token_y_permite_la_cabecera_del_token(anonymous_client):
    response = anonymous_client.options("/api/merge", headers={"Origin": "null"})

    assert response.status_code == 204
    assert "X-Auth-Token" in response.headers["Access-Control-Allow-Headers"]


def test_merge_rechaza_una_salida_con_extension_distinta_al_formato(client, tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("id\n1\n", encoding="utf-8")
    out = tmp_path / "salida.bat"

    response = client.post(
        "/api/merge",
        json={"files": [str(a)], "output_format": "csv", "output_path": str(out), "mode": "concat"},
    )

    assert response.status_code == 400
    assert response.get_json()["code"] == "output_extension_mismatch"
    assert not out.exists()


# ---- hojas de Excel ----


def _two_sheet_xlsx(path):
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame({"id": [1, 2]}).to_excel(writer, sheet_name="Uno", index=False)
        pd.DataFrame({"id": [3]}).to_excel(writer, sheet_name="Dos", index=False)
    return str(path)


def test_sheets_lista_las_hojas_de_cada_archivo(client, tmp_path):
    xlsx = _two_sheet_xlsx(tmp_path / "libro.xlsx")
    csv_path = tmp_path / "a.csv"
    csv_path.write_text("id\n1\n", encoding="utf-8")

    response = client.post("/api/sheets", json={"files": [xlsx, str(csv_path)]})

    assert response.get_json() == {"sheets": {xlsx: ["Uno", "Dos"], str(csv_path): []}}


def test_merge_aplica_la_hoja_elegida(client, tmp_path):
    xlsx = _two_sheet_xlsx(tmp_path / "libro.xlsx")
    out = tmp_path / "salida.csv"

    status = _run_merge(
        client,
        {
            "files": [xlsx],
            "output_format": "csv",
            "output_path": str(out),
            "mode": "concat",
            "sheets": {xlsx: "Dos"},
        },
    )

    assert status["status"] == "done", status
    assert pd.read_csv(out)["id"].tolist() == [3]


def test_columns_respeta_la_hoja_elegida(client, tmp_path):
    xlsx = tmp_path / "libro.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as writer:
        pd.DataFrame({"a": [1]}).to_excel(writer, sheet_name="Uno", index=False)
        pd.DataFrame({"b": [1]}).to_excel(writer, sheet_name="Dos", index=False)

    response = client.post("/api/columns", json={"files": [str(xlsx)], "sheets": {str(xlsx): "Dos"}})

    assert response.get_json() == {"columns": {str(xlsx): ["b"]}}
