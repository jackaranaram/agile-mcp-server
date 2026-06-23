# Agile Agent Harness (MCP Server)

Este es un servidor compatible con el **Model Context Protocol (MCP)** diseñado para automatizar la gestión ágil de proyectos en GitHub. Permite a agentes de IA (como Antigravity, Cursor o Claude Desktop) traducir especificaciones escritas en lenguaje natural en estructuras de gestión de proyectos validadas y subirlas a GitHub.

---

## 🛠️ Configuración e Instalación

### 1. Requisitos Previos
* **Node.js** (v18 o superior)
* Un **GitHub Personal Access Token (PAT)** con permisos de escritura en el repositorio (permisos `repo` o al menos `issues:write` y `metadata:read`).

### 2. Instalación y Compilación
Clona o abre el directorio del proyecto y ejecuta:
```bash
npm install
npm run build
```

---

## ⚙️ Registro del Servidor MCP

Para que tus editores o clientes de IA puedan ver y usar las herramientas, debes registrar este servidor en sus archivos de configuración de MCP.

### Opción A: Configuración en Cursor o VS Code (Antigravity)
Agrega un nuevo servidor MCP de tipo **command**:
* **Name:** `agile-agent-harness`
* **Type:** `command`
* **Command:** `node c:/Projects/harness/dist/index.js`
* **Variables de Entorno (Opcional):**
  * `GITHUB_TOKEN`: Tu token de GitHub.
  * `GITHUB_REPOSITORY`: El repositorio objetivo en formato `owner/repo`.

### Opción B: Claude Desktop (`claude_desktop_config.json`)
Agrega la configuración al archivo en `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "agile-agent-harness": {
      "command": "node",
      "args": ["c:/Projects/harness/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "tu_token_aqui",
        "GITHUB_REPOSITORY": "owner/repo"
      }
    }
  }
}
```

---

## 🚀 Flujo de Uso

El servidor proporciona dos herramientas principales que garantizan un flujo seguro antes de escribir datos en GitHub:

### Paso 1: Generar y Validar el Plan Local (`stage_agile_plan`)
El agente de IA lee tus requisitos en lenguaje natural y genera una propuesta estructurada. Llama a esta herramienta pasando el payload. El servidor valida la estructura con `Zod` y genera un archivo temporal `.agile_plan.json` en la raíz de tu proyecto.

* **Argumento:** `payload` (JSON estructurado del Epic, Historias y Tareas).

### Paso 2: Simulación de Cambios (`apply_agile_plan` con `dryRun: true`)
Antes de crear cualquier elemento en GitHub, ejecuta la simulación.
* **Argumentos:**
  * `dryRun`: `true` (por defecto).
  * `githubToken` / `repository`: Opcional (si no se configuraron variables de entorno).
* **Resultado:** Obtendrás un reporte detallado en Markdown que muestra exactamente qué etiquetas, hitos e incidencias se crearían, junto con su prioridad y dependencias.

### Paso 3: Aplicar Cambios en GitHub (`apply_agile_plan` con `dryRun: false`)
Una vez revisado y aprobado el reporte del simulador, ejecuta la aplicación definitiva.
* **Argumento:** `dryRun: false`.
* **Resultado:** El broker:
  1. Creará o asegurará la existencia de etiquetas de prioridad y taxonomía (`type:story`, `priority:HIGH`, etc.).
  2. Creará el Hito (Milestone) para el Epic.
  3. Creará las incidencias para las User Stories.
  4. Creará las incidencias para las Technical Tasks.
  5. Vinculará dinámicamente las tareas con sus historias usando listas de tareas de GitHub (`- [ ] #num_issue`).
