<div align="center">

<img src="resources/icons/icon.png" alt="Logo de Merger Lab" width="96" height="96" />

# Merger Lab

Combina varios archivos de hoja de cálculo en uno solo, sin instalar nada más.

[![CI](https://github.com/SalgueroOv/mergerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/SalgueroOv/mergerlab/actions/workflows/ci.yml)
[![Última versión](https://img.shields.io/github/v/release/SalgueroOv/mergerlab?label=%C3%BAltima%20versi%C3%B3n)](https://github.com/SalgueroOv/mergerlab/releases/latest)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

</div>

Merger Lab es una aplicación de escritorio gratuita y de código abierto para Windows, macOS y
Linux que une varios archivos `.xls`, `.xlsx`, `.csv` u `.ods` en un único archivo de salida —
cruzándolos por una columna clave (join) o apilándolos uno debajo de otro — sin necesidad de
tocar Excel, escribir fórmulas ni instalar Python o Node. Disponible en español, inglés, alemán,
francés, italiano, portugués, ruso y chino simplificado.

## Descargar e instalar (Windows)

|                                                                                                                                |                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔽 **[Descargar instalador](https://github.com/SalgueroOv/mergerlab/releases/download/v0.9.0/MergerLab-Setup-0.9.0-x64.exe)**  | Recomendado. Doble clic, siguiente, siguiente. No pide permisos de administrador. Crea acceso directo en el escritorio y el menú de inicio.                                                 |
| 🔽 **[Descargar portable](https://github.com/SalgueroOv/mergerlab/releases/download/v0.9.0/MergerLab-Portable-0.9.0-x64.exe)** | No instala nada: descarga el `.exe` y ejecútalo directamente, incluso desde un USB. Útil si no puedes/quieres instalar programas en ese ordenador. No se actualiza solo (el instalador sí). |

¿Windows te avisa de "editor desconocido" (SmartScreen)? Es normal en apps sin firma de código
comercial (tiene un coste anual) — pulsa "Más información" → "Ejecutar de todas formas".

¿macOS o Linux? Por ahora no hay compilados listos para descargar; puedes generarlos tú mismo
siguiendo la [guía de desarrollo](docs/DEVELOPMENT.md#build-de-distribución-instalador--portable).

Todas las versiones, con su registro de cambios, están en la
[página de Releases](https://github.com/SalgueroOv/mergerlab/releases).

## Funcionalidades

- **Combinar por clave (join)**: cruza archivos como un JOIN de SQL, con inner/left/right/outer,
  incluso si la columna clave se llama distinto en cada archivo. Los tipos "anti" sacan las filas
  de un archivo que no están en los demás (útil para comparar listas).
- **Apilar filas**: concatena archivos con las mismas columnas, uno debajo del otro (por ejemplo,
  ventas de varios meses).
- Encadena tantos archivos como quieras, en el orden que elijas (arrastrar y soltar para
  reordenar, o soltarlos directamente en cualquier parte de la ventana).
- Exporta a `.xlsx`, `.xls`, `.csv` u `.ods`, sin importar en qué formato llegaron los archivos
  de entrada.
- **Vista previa** antes de guardar: filas y columnas del resultado, filas leídas y sin
  coincidencia por archivo, y las primeras 20 filas.
- Opciones para quitar filas duplicadas e incluir un **informe** de la combinación (hoja extra
  en Excel/ODS, o un CSV aparte).
- Tutoriales integrados (con diagramas) para cada modo, y un recorrido de bienvenida la primera
  vez que se abre la app.
- Tema claro/oscuro (o seguir al sistema) y 8 idiomas.
- Se actualiza sola (versión instalada) avisando antes de reiniciar.

## Cómo se usa

1. Añade uno o varios archivos (`.xls`, `.xlsx`, `.csv`, `.ods`) — botón, o arrastrarlos a la
   ventana. El orden importa: se puede reordenar.
2. Elige el modo: **Join** (cruzar por columna clave) o **Apilar filas**.
3. Elige el formato de salida y dónde guardarlo.
4. Pulsa "Combinar archivos" y espera a que termine — verás el progreso en pantalla.

## Formatos soportados y limitaciones

- Entrada y salida: `.xlsx`, `.xls`, `.csv`, `.ods`.
- El formato `.xls` clásico admite un máximo de 65 535 filas; si el resultado combinado lo
  supera, exporta a `.xlsx`, `.csv` u `.ods` en su lugar.
- El formato `.xlsx` admite un máximo de 1 048 575 filas de datos; si el resultado lo supera,
  exporta a `.csv`.
- Si un Excel tiene varias hojas, por defecto se combinan todas; en la lista de archivos puedes
  elegir una hoja concreta.
- Un `.xls` que en realidad es una tabla HTML o un texto delimitado se lee igualmente.
- Los archivos protegidos con contraseña no son compatibles.

## Desarrollo y contribuciones

Este repositorio es de código abierto (licencia MIT). Si quieres levantar el entorno de
desarrollo, entender la arquitectura, correr los tests o generar tú mismo los instaladores, toda
esa documentación técnica está en **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Licencia

[MIT](LICENSE) © Alejandro Salguero Oviedo
