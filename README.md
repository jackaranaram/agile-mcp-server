# Agile MCP Server

Servidor MCP que convierte especificaciones en lenguaje natural en estructuras ágiles de project management (epics, stories, tareas) y las sincroniza con **GitHub** (con soporte para **Jira** y **Azure DevOps** en camino).

---

## 🛠️ Instalación

### Requisitos Previos
* **Node.js** (v18 o superior)
* Un **GitHub Personal Access Token (PAT)** con permisos `repo` (o `issues:write` + `metadata:read`).

### Uso rápido (via npx)
```bash
npx -y @jackaranaram/agile-mcp-server
```

### Instalación local
```bash
npm install
npm run build
```

---

## ⚙️ Autenticación

Soporta dos métodos de autenticación con GitHub:

### PAT (Personal Access Token)
```json
{
  "mcpServers": {
    "agile-mcp-server": {
      "command": "npx",
      "args": ["-y", "@jackaranaram/agile-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "github_pat_...",
        "GITHUB_REPOSITORY": "owner/repo"
      }
    }
  }
}
```

### GitHub App (recomendado para organizaciones)
```json
{
  "mcpServers": {
    "agile-mcp-server": {
      "command": "npx",
      "args": ["-y", "@jackaranaram/agile-mcp-server"],
      "env": {
        "GITHUB_APP_ID": "123456",
        "GITHUB_APP_PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----",
        "GITHUB_APP_INSTALLATION_ID": "789012",
        "GITHUB_REPOSITORY": "owner/repo"
      }
    }
  }
}
```
> La private key PEM debe escaparse con `\n` para cada salto de línea en JSON.

> En Windows, agrega `"command": "cmd"` y `"args": ["/c", "npx", "-y", "@jackaranaram/agile-mcp-server"]`.

### Claude Code
```bash
# PAT
claude mcp add agile-mcp-server -- npx -y @jackaranaram/agile-mcp-server

# GitHub App
claude mcp add agile-mcp-server -- npx -y @jackaranaram/agile-mcp-server
```
Las variables de entorno se configuran en la UI de Claude Code.

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
