# agentic-code-review

A desktop application (Electron + React + TypeScript) built to automate single-repository and pull request diff code reviews using agentic AI models executing inside isolated container sandboxes.

---

## Background & Motivation

This project builds on top of **[agentflow](https://github.com/kfyh/agentflow)**, a multi-vendor agentic container runner designed to fit a personal workflow and comfort level with using LLM agents.

One primary use case for `agentflow` is conducting thorough code reviews. Before this app, preparing a code review required manual steps: checking out target repositories or branches on the host, setting up isolated staging directories, stripping unsafe metadata, selecting prompt templates, and invoking `run-agent`.

`agentic-code-review` automates this entire orchestration pipeline, making manual agentic code review workflows **consistent, repeatable, and easy to execute**.

---

## Objectives

The application provides two main review capabilities:

1. **Single Codebase Deep Review**:
   - Conducts a deep structural pass of a codebase to identify hidden technical debt.
   - Measures cyclomatic complexity hotspots (> 15) using AST parsing (`ts-morph`).
   - Detects intra-package circular dependency loops using established AST tools (`madge`, `dpdm`, `dependency-cruiser`).
   - Scans for SOLID principle violations and clean architecture code smells (layer leakage, feature envy, temporal coupling, primitive obsession).

2. **PR / Diff Review (Branch vs Main)**:
   - Evaluates pull requests and branch diffs against a base branch (e.g. `main`).
   - Detects hard-to-spot issues such as code overreach, backwards compatibility breaks (broken API contracts), unintended behaviour changes, and violations of modular coding standards.

---

## Key Highlights & Architecture

### 1. `agentflow` Integration (Phase 1 Subprocess → Phase 2 Dev Dependency)

![System Architecture](docs/architecture.svg)

<details>
<summary>View ASCII / Text Diagram</summary>

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          HOST ENVIRONMENT (ELECTRON APP)                        │
│                                                                                 │
│   ┌───────────────────┐        ┌─────────────────────┐        ┌──────────────┐  │
│   │ React Renderer UI ├───────►│ Electron Main Proc. ├───────►│ Git Service  │  │
│   └─────────▲─────────┘        └──────────┬──────────┘        └──────────────┘  │
│             │                             │                                     │
│             │                             ▼                                     │
│             │                  ┌─────────────────────┐                          │
│             │                  │ Staging Service     │                          │
│             │                  │ (excl .git, CLAUDE) │                          │
│             │                  └──────────┬──────────┘                          │
│             │                             │                                     │
│             │                             ▼                                     │
│             │                  ┌─────────────────────┐                          │
│             │                  │ Agent Invoker (sub) │                          │
│             │                  └──────────┬──────────┘                          │
└─────────────┼─────────────────────────────┼─────────────────────────────────────┘
              │                             │ shell execution: run-agent . -p "..."
              │                             ▼
┌─────────────┼───────────────────────────────────────────────────────────────────┐
│             │             ISOLATED CONTAINER SANDBOX (PODMAN / DOCKER / COLIMA) │
│             │                                                                   │
│             │                  ┌─────────────────────┐                          │
│             │                  │ Agentic Environment │                          │
│             │                  └──────────┬──────────┘                          │
│             │                             │                                     │
│             │                             ▼                                     │
│             │                  ┌─────────────────────┐                          │
│             │                  │ AST Analysis Tools  │                          │
│             │                  │ (madge, ts-morph)   │                          │
│             │                  └──────────┬──────────┘                          │
│             │                             │                                     │
│             │                             ▼                                     │
│             │                  ┌─────────────────────┐                          │
│             └──────────────────┤ /workspace/reports/ │                          │
│                                │  code_smells.md     │                          │
│                                └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

</details>

- **Phase 1 (Current)**: The desktop app serves as an orchestration layer. It handles host-side Git operations and workspace staging, then shells out as a subprocess to `agentflow`'s `run-agent` terminal command within a staged directory (`~/.agentic-code-review/staged/`).
- **Phase 2 (Upcoming Roadmap)**: There is an active desire to **turn `agentflow` into a dev dependency** (or shared library package). Transitioning from CLI subprocess invocation to a direct TypeScript library API will eliminate the requirement for a separate local `agentflow` checkout, enable typed container orchestration, and support dynamic AI provider detection.

---

### 2. Sandbox & Container Engine Flexibility

The app is container-runtime agnostic:

- Supports **Podman** on Linux.
- Supports **Colima** or Docker Desktop on macOS.
- Supports native **Docker Engine** on Linux / WSL2 on Windows.

All execution occurs inside non-root container sandboxes with dropped privileges (`--cap-drop ALL`, `--security-opt no-new-privileges`).

---

### 3. Real-Time Stream Monitoring & Debugging

![Real-Time Execution Sequence](docs/sequence.svg)

<details>
<summary>View ASCII / Text Sequence Diagram</summary>

```
┌──────────────────────┐           ┌──────────────────────┐          ┌──────────────────────┐
│ React Renderer (UI)  │           │ Electron Main Proc.  │          │ Container Sandbox    │
└──────────┬───────────┘           └──────────┬───────────┘          └──────────┬───────────┘
           │                                  │                                 │
           │  1. Trigger Code Review          │                                 │
           ├─────────────────────────────────►│                                 │
           │                                  │  2. Spawn run-agent . -p "..."  │
           │                                  ├────────────────────────────────►│
           │                                  │                                 │
           │                                  │  ◄── Real-Time Execution Loop ──┤
           │  3. IPC Stream (review:log)      │  4. stdout / stderr log chunks │
           │◄─────────────────────────────────┤                                 │
           │                                  │                                 │
           │  [ Human Monitoring & Retrospective Debugging Log Output ]         │
           │                                  │                                 │
           │                                  │  5. Exit Code 0 & Report File   │
           │                                  │◄────────────────────────────────┤
           │  6. Render Sanitised Report      │                                 │
           │◄─────────────────────────────────┤                                 │
```

</details>

- Streams container `stdout` and `stderr` live to an interactive log console UI.
- Enables **human monitoring** of the agent's actions in real-time during execution.
- Preserves full log records for **retrospective debugging** if analysis encounters errors or partial passes.

---

### 4. Customisable Prompt Architecture

- Built on a comprehensive code review prompt template ([`code-review-prompt.md`](file:///workspace/code-review-prompt.md)).
- Mandates AST-based tool execution (`madge`, `dpdm`, `dependency-cruiser`, `ts-morph`) rather than relying on LLM token prediction alone.
- **Prompt Customisation Note**: While the code review prompt template can currently be modified on disk via [`code-review-prompt.md`](file:///workspace/code-review-prompt.md), **there are future plans to allow users to edit, customise, and manage prompts directly within the application**.

---

## Threat Model & Security Realities

> [!NOTE]
> **Network Access**: The agent operates with full outbound network access via the container host to install required analysis packages (`madge`, `ts-morph`) or fetch public dependencies.

The threat model focuses primarily on **host integrity and source safety** rather than data exfiltration:

| Threat Vector                   | Mitigation Strategy                                                                                                                     |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **Host System Tampering**       | Agent runs inside non-root container with dropped capabilities (`--cap-drop ALL`, `--security-opt no-new-privileges`).                  |
| **Codebase Corruption**         | Workspace is mounted in an isolated staging copy (`~/.agentic-code-review/staged/<commitSha>`); host repo remains untouched.            |
| **Unauthorised Git Commits**    | `git` binary is intentionally omitted from the container image, preventing unauthorised local or remote commits.                        |
| **Git History Leakage**         | `.git/` directory is explicitly excluded during staging prep before mounting into the sandbox.                                          |
| **File-Based Prompt Injection** | `CLAUDE.md` is stripped from the staged workspace to prevent instruction overriding; baseline constraints enforced by `guidelines.txt`. |
| **Credential Safety**           | OAuth tokens reside in named container volumes (`agentic-coder-claude`), keeping credentials out of `process.env`.                      |
| **Renderer XSS**                | UI runs with `contextIsolation: true`, `nodeIntegration: false`, and renders Markdown via `marked` + `DOMPurify`.                       |

---

## Prerequisites

- **`run-agent` Command / Alias**: The `run-agent` terminal command (or shell alias) must be available and executable from your terminal path.
- For container runtime setup, engine image builds (Claude, Gemini, Mistral), and credential authentication, see **[agentflow](https://github.com/kfyh/agentflow)**.

---

## Quick Start & Build Instructions

### 1. Development Mode

Run the Electron main, preload, and Vite renderer in development mode:

```bash
# Install dependencies
npm install

# Start development server and Electron app
npm run dev
```

### 2. Build & Run Locally

To compile TypeScript bundles and launch the local Electron application:

```bash
# Build main, preload, and renderer bundles
npm run build

# Run local Electron app
npx electron .
# or
npm run start
```

### 3. Packaging Standalone Desktop Executable

To generate a standalone desktop executable/binary (e.g., `AppImage` / executable binary on Linux, `.dmg` on macOS, `.exe` on Windows):

```bash
# Build desktop executable (outputs to release/ directory)
npm run dist

# Or create unpacked executable directory
npm run pack
```

---

## Available NPM Scripts

- `npm run dev`: Launch Vite dev server and esbuild watchers for Electron development.
- `npm run start`: Build main, preload, and renderer assets and start Electron process.
- `npm run build`: Build production bundles for main, preload, and renderer processes.
- `npm run pack`: Create unpacked desktop executable directory under `release/`.
- `npm run dist`: Package standalone executable distributions under `release/`.
- `npm run test`: Execute Jest unit test suite.
- `npm run typecheck`: Perform TypeScript type checking (`tsc --noEmit`).
- `npm run lint`: Run ESLint across the codebase.
- `npm run format`: Format codebase with Prettier.

---

## Project Structure

```
agentic-code-review/
├── docs/                        # Diagram assets (SVG)
│   ├── architecture.svg
│   └── sequence.svg
├── src/
│   ├── main/                    # Electron main process
│   │   ├── config.ts            # Workspace & staging path configuration
│   │   ├── ipc.ts               # Inter-process communication handlers
│   │   └── services/
│   │       ├── agentInvoker.ts  # Subprocess wrapper spawning run-agent
│   │       ├── gitService.ts    # Host-side git clone, fetch, and diff ops
│   │       ├── stagingService.ts# Workspace staging and exclusion filtering
│   │       ├── historyService.ts# Persistent review execution history
│   │       ├── installService.ts# Dependency & tool verification
│   │       └── reportService.ts # Markdown report parsing & stdout fallback
│   ├── preload/                 # Electron preload scripts (contextBridge)
│   ├── renderer/                # React UI renderer process
│   └── shared/                  # Shared types and IPC channel definitions
├── specs/                       # Architecture specs & prompt design docs
│   ├── app-spec.md
│   ├── prompt_mvp.md
│   └── prompt_mvp_review.md
├── code-review-prompt.md        # Code review prompt template
├── readme_corrections.md        # Documentation audit & corrections log
├── package.json
└── tsconfig.json
```

---

## License

ISC License.
