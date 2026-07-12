# Agile MCP Server

Servidor MCP que convierte especificaciones en lenguaje natural en estructuras ágiles de project management (epics, stories, tareas) y las sincroniza con **GitHub** (con soporte para **Jira** y **Azure DevOps** en camino).

> **v1.0.1** — Soporta auto-detección de owner/repo desde git remote, vinculación real de issues a GitHub Projects V2, inicialización automatizada de labels, y obtención de epics existentes para contexto de planificación.

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

> El servidor auto-detecta `GITHUB_REPOSITORY` y `ownerLogin` desde el remote `origin` del repositorio git actual, por lo que estos valores son opcionales cuando se ejecuta dentro de un repositorio clonado.

---

## 🚀 Flujo de Uso

El servidor proporciona las siguientes herramientas:

| Herramienta | Descripción |
|---|---|
| `stage_agile_plan` | Valida y guarda un plan ágil estructurado (Epic, Stories, Tasks) |
| `apply_agile_plan` | Aplica el plan a GitHub (milestones + issues) y opcionalmente lo sincroniza a Projects V2 |
| `init_agile_harness` | Verifica conectividad, asegura labels estándar y reporta el estado de inicialización |
| `fetch_existing_epics` | Obtiene milestones abiertos con sus issues asociados para contexto de planificación |
| `list_github_projects` | Lista Projects V2 disponibles (auto-detecta owner desde git remote) |
| `create_project` | Crea un nuevo GitHub Project V2 (auto-detecta owner desde git remote) |
| `get_project_fields` | Obtiene campos personalizados de un Project V2 |
| `apply_plan_to_project` | Aplica el plan a un Project V2 (draft issues o issues reales) |
| `sync_project_with_milestones` | Consulta items de un Project V2 con sus milestones/issues asociados |

### Auto-detección desde git remote

Los campos `repository` y `ownerLogin` son **opcionales** en todas las herramientas. Si no se proveen, el servidor los detecta automáticamente desde el remote `origin` del repositorio git actual. Soporta URLs SSH (`git@github.com:owner/repo.git`) y HTTPS (`https://github.com/owner/repo.git`).

### Paso 1: Inicializar el repositorio (`init_agile_harness`)
Verifica que el token tenga acceso, que el repositorio exista, y crea las labels estándar (`type:story`, `type:task`, `priority:HIGH`, `priority:MEDIUM`, `priority:LOW`, `status:backlog`, `status:in-progress`, `status:done`) si no existen.

### Paso 2: Obtener contexto existente (`fetch_existing_epics`)
Obtiene todos los milestones abiertos con sus issues asociados, útil para que la IA tenga contexto de lo que ya existe antes de planificar.

### Paso 3: Generar y Validar el Plan Local (`stage_agile_plan`)
El agente de IA lee tus requisitos en lenguaje natural y genera una propuesta estructurada. Llama a esta herramienta pasando el payload. El servidor valida la estructura con `Zod` y genera un archivo temporal `.agile_plan.json` en la raíz de tu proyecto.

* **Argumento:** `payload` (JSON estructurado del Epic, Historias y Tareas).
* **Opcional:** `targetProject` — ID del Project V2 para sincronización automática al aplicar.

### Paso 4: Simulación de Cambios (`apply_agile_plan` con `dryRun: true`)
Antes de crear cualquier elemento en GitHub, ejecuta la simulación.
* **Argumentos:**
  * `dryRun`: `true` (por defecto).
  * `githubToken` / `repository`: Opcional (auto-detectados si se omite).
  * `idempotent`: `true` para evitar duplicados reusando elementos existentes.
* **Resultado:** Obtendrás un reporte detallado en Markdown que muestra exactamente qué etiquetas, hitos e incidencias se crearían, junto con su prioridad y dependencias.

### Paso 5: Aplicar Cambios en GitHub (`apply_agile_plan` con `dryRun: false`)
Una vez revisado y aprobado el reporte del simulador, ejecuta la aplicación definitiva.
* **Argumento:** `dryRun: false`.
* **Resultado:** El broker:
  1. Creará o asegurará la existencia de etiquetas de prioridad y taxonomía (`type:story`, `priority:HIGH`, etc.).
  2. Creará el Hito (Milestone) para el Epic.
  3. Creará las incidencias para las User Stories.
  4. Creará las incidencias para las Technical Tasks.
  5. Vinculará dinámicamente las tareas con sus historias usando listas de tareas de GitHub (`- [ ] #num_issue`).
  6. Si `targetProject` fue configurado en el plan, sincronizará automáticamente los issues creados al Project V2 (con vinculación real, no draft issues).

---

## 📊 GitHub Projects V2 (GraphQL API)

Además de la integración con milestones/issues, el servidor soporta **GitHub Projects V2** — tableros kanban con campos personalizados, vistas y linked issues.

### Herramientas disponibles

| Herramienta | Descripción |
|---|---|
| `list_github_projects` | Lista los Projects V2 de un usuario u organización (auto-detecta owner) |
| `create_project` | Crea un nuevo GitHub Project V2 |
| `get_project_fields` | Obtiene los campos personalizados (columnas) de un proyecto |
| `apply_plan_to_project` | Aplica el plan agile a un proyecto (draft issues o issues reales vinculados) |
| `sync_project_with_milestones` | Consulta los items de un proyecto para contexto de planificación |

### Flujo con Projects V2

#### Opción A: Aplicar plan directamente al proyecto (draft issues)

```json
{
  "tool": "apply_plan_to_project",
  "arguments": {
    "projectId": "PVTI_xxxxx",
    "dryRun": true,
    "createAsDraftIssues": true
  }
}
```

Esto crea draft issues en el proyecto con campos configurados (Type, Priority, Risk, Story Points).

#### Opción B: Vincular issues reales al proyecto

```json
{
  "tool": "apply_plan_to_project",
  "arguments": {
    "projectId": "PVTI_xxxxx",
    "createAsDraftIssues": false,
    "issueNodeIdMap": {
      "STORY-1": "I_kwDOSrHgs88AAAABIgHY0Q",
      "STORY-2": "I_kwDOSrHgs88AAAABIgHZRQ"
    }
  }
}
```

Esto agrega issues existentes al proyecto en lugar de crear draft issues.

#### Opción C: Combinar milestones + projects en un solo paso (recomendado)

Incluye `targetProject` en el payload de `stage_agile_plan`:

```json
{
  "payload": {
    "epic": { "id": "EPIC-1", "title": "...", ... },
    "targetProject": "PVTI_xxxxx",
    "projectOptions": {
      "createAsDraftIssues": false,
      "linkToMilestones": false
    }
  }
}
```

Luego ejecuta `apply_agile_plan` normalmente — creará milestones/issues **y** los vinculará al proyecto automáticamente usando los `node_id` de los issues recién creados.

### Mapeo de campos

| Campo Agile | Campo Project | Tipo |
|---|---|---|
| `priority` | Priority | SingleSelect |
| `risk_level` | Risk | SingleSelect |
| `story_points` | Story Points | Number |
| `type` (story/task) | Type | SingleSelect |
| `tags` | Labels | Labels (built-in) |
