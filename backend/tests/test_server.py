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
