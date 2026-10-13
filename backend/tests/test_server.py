"""Tests de los endpoints de backend/server.py con el cliente de pruebas de Flask."""

import time

import pandas as pd
import pytest

import server


@pytest.fixture
def client():
    server.app.config["TESTING"] = True
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
