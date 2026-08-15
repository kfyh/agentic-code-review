# Phase 1: Single Repo Review MVP Specification

## 1. Overview & Goal

This document specifies the Phase 1 MVP design for the **Code Review Desktop Application**. Phase 1 implements a single-repository code review workflow powered by shelling out directly to `run-agent` (aliased in the environment shell).

The MVP focuses on simplicity and speed:
- A startup screen with an SSH Git repository URL input box equipped with a **recent repository history** dropdown.
- Automatic remote branch detection via `git ls-remote --symref` to pre-populate the default branch (e.g., `main`, `master`, `develop`), which the user can override.
- Local persistence of valid Git URLs and branches where a code review was started.
- A trigger button (**Start Code Review**) to launch execution.
- Host-side Git operations (clone/fetch, branch checkout, resolving commit SHA).
- Host-side dependency installation (`npm install`) on the checked-out workspace prior to staging copy (resolving `node_modules` for AST analysis tools like `ts-morph` and `madge`).
- Workspace folder naming based on commit SHA to uniquely cover branch name and revision history.
- Staging preparation (excluding `.git/` and `CLAUDE.md`).
- Subprocess invocation of `run-agent` with `code-review-prompt.md`.
- Live stdout/stderr log streaming in the UI.
- Markdown rendering of the resulting code review reports (`reports/*.md`).

---

## 2. User Experience & Application Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Startup / Input View                            │
│                                                                        │
│  Git Repository URL (SSH):                                             │
│  [ git@github.com:org/repo.git                                     ▼]  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Recent Repositories:                                             │  │
│  │ • git@github.com:org/repo.git (main - 2 hours ago)              │  │
│  │ • git@github.com:acme/backend.git (dev - yesterday)              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  Branch Name: (Auto-detected from remote HEAD)                         │
│  [ main                                                            ]  │
│                                                                        │
│  [ Start Code Review ]                                                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ User clicks "Start Code Review"
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Execution & Log Streaming View                     │
│                                                                        │
│  Status: [●] Fetching main ──► Installing Deps ──► Staging ──► Agent   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Log Console Output                                               │  │
│  │ [10:14:02] [GIT] Checking out git@github.com:org/repo.git (main) │  │
│  │ [10:14:04] [GIT] Resolved commit SHA: e3b0c44298fc1c149afbf4c8...│  │
│  │ [10:14:05] [INSTALL] Running npm install on host workspace...    │  │
│  │ [10:14:08] [STAGING] Prepared workspace at /tmp/.../staged/e3b0c4│  │
│  │ [10:14:09] [AGENT] Spawning run-agent -r spec...                 │  │
│  │ [10:14:12] [CONTAINER] Initializing AST analysis with madge...   │  │
│  │ ...                                                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ Abort Execution ]                                                   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Agent finishes execution
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Review Report View                             │
│                                                                        │
│  Tabs: [ pkg-a_code_smells.md ] [ pkg-b_code_smells.md ]                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ # Code Smell & Dependency Analysis Report                        │  │
│  │ ## Dependency Cycles                                             │  │
│  │ - src/utils/a.ts -> src/utils/b.ts -> src/utils/a.ts             │  │
│  │ ...                                                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Flow Steps:
1. **URL Entry & Default Branch Auto-Detection**:
   - User enters or selects a previously reviewed SSH Git URL (`git@github.com:owner/repo.git`) from the history dropdown.
   - Upon input blur or history selection, the app executes `git ls-remote --symref <gitUrl> HEAD` to query the remote's default branch.
   - The detected default branch is automatically populated in the **Branch Name** field.
2. **Review Trigger & History Persistence**:
   - User accepts or modifies the branch name, then clicks **Start Code Review**.
   - Upon successful Git fetch and SHA resolution, the URL and branch are saved/updated in `repo_history.json`.
3. **Host Git Sync & SHA Resolution**:
   - The app clones/fetches the repository on the host into a local git cache.
   - The app checks out the target branch and resolves the exact full 40-character Commit SHA (`git rev-parse origin/<branch>`).
4. **Host Dependency Installation (`npm install`)**:
   - The app executes `npm install` (or `npm ci` if `package-lock.json` exists) inside the host checkout workspace (`workspaceDir`).
   - This resolves the package graph and installs `node_modules` locally before staging.
5. **Commit SHA Workspace Hashing & Staging Prep**:
   - The app copies code (including installed `node_modules`) into the staged workspace inside the user's home directory (`~/.code-review-app/staged/<commit-sha>/`), excluding `.git/` and `CLAUDE.md`, and generates `context.json`. Using `~/.code-review-app/` ensures full read-write volume mount permissions across macOS (Colima/Docker Desktop) and Linux (Fedora Workstation / Podman rootless SELinux `user_home_t` contexts).
6. **Subprocess Invocation**:
   - The app spawns `run-agent -r spec <staged-dir> -p "$(cat code-review-prompt.md)"` using the shell environment alias.
7. **Live Log Output**: Stdout/stderr from `run-agent` are captured and streamed to the renderer UI log console in real time.
8. **Report Display**: Upon completion, the app reads generated markdown report(s) from `<staged-workspace>/reports/` and renders them with DOMPurify sanitization.

---

## 3. Host Workspace & Git Operations

### Environment Assumption
- The host machine has SSH keys already configured (`~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, etc.) and added to the SSH agent.
- `run-agent` is an established shell alias or binary available on PATH in the shell execution environment.
- Git operations rely directly on the host's native `git` CLI via SSH.

### Remote Default Branch Detection Logic
To detect the remote repository's default branch prior to review start:
```bash
git ls-remote --symref <gitUrl> HEAD
```
Extracted branch: `main`. Fallback if query times out or fails: `main`.

### Host Dependency Installation (`npm install`)
After git checkout and before staging copy, `gitService` / `installService` runs:
```bash
npm install --no-audit --no-fund
```
- Executed on the **host machine** prior to staging copy.
- Resolves package graphs and `node_modules` required for AST analysis tools (`ts-morph`, `madge`, `dpdm`).
- Avoids running `npm install` inside the container runtime.

### Repository History Persistence (`historyService`)
- Storage location: `path.join(app.getPath('userData'), 'repo_history.json')`.
- Trigger: Added/updated when Git fetch/checkout succeeds and review is started.
- Sorting: Reverse-chronological (`lastReviewedAt`).
- Capacity: Retains up to 30 most recent unique Git URLs.

---

## 4. Staging Workspace Preparation

Before mounting code into the Docker container, the host creates an isolated staging workspace to enforce security boundaries.

### Exclusions & Security Rules
- Exclude `.git/`: Prevents raw git object inspection, history scraping, and git execution inside the container.
- Exclude `CLAUDE.md`: Prevents file-based prompt injection attacks that target Claude Code prior to system prompt evaluation.

### Staging Procedure
1. Create staging directory: `stagedDir = path.join(os.tmpdir(), 'code-review-app', 'staged', commitSha)`.
2. Copy files from `workspaceDir` to `stagedDir` excluding `.git/` and `CLAUDE.md`:
   ```bash
   rsync -av --exclude='.git/' --exclude='CLAUDE.md' <workspaceDir>/ <stagedDir>/
   ```
3. Generate `context.json` inside `stagedDir`:
   ```json
   {
     "repoUrl": "git@github.com:org/repo.git",
     "branch": "main",
     "commitSha": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4",
     "stagedAt": "2026-08-14T21:02:34Z"
   }
   ```

---

## 5. Agent Subprocess Invocation (`runAgentInvoker`)

Phase 1 delegates execution by calling `run-agent` directly via shell subprocess execution.

### Command Construction
- **Executable**: `run-agent` (executed through a shell wrapper like `bash -i -c` or `sh -c` to inherit user shell aliases).
- **Prompt Source**: `code-review-prompt.md`.
- **Invocation Command**:
  ```bash
  run-agent -r spec <stagedDir> -p "$(cat code-review-prompt.md)"
  ```

---

## 6. Application Architecture & File Layout

### File Structure
```
code-review-app/
├── src/
│   ├── main/
│   │   ├── index.ts                # Main process entry point
│   │   ├── ipc.ts                  # IPC handlers setup
│   │   ├── services/
│   │   │   ├── gitService.ts       # SSH clone, branch fetch, SHA resolution, default branch detection
│   │   │   ├── historyService.ts   # Local JSON persistence for valid Git URLs & branches
│   │   │   ├── installService.ts   # Host-side npm install execution
│   │   │   ├── stagingService.ts   # rsync copy excl. .git/ & CLAUDE.md, context.json
│   │   │   ├── agentInvoker.ts     # Shell subprocess spawn for `run-agent`, log streaming
│   │   │   └── reportService.ts    # Read and parse output reports from reports/
│   │   └── config.ts               # App paths and workspace directory config
│   ├── preload/
│   │   └── index.ts                # Typed window.api bridge
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── RepoInputForm.tsx   # Git URL + History Dropdown + Branch input & start button
│   │   │   ├── StatusTimeline.tsx  # Stage progress indicator (Git -> npm install -> Staging -> Agent)
│   │   │   ├── LogConsole.tsx      # Real-time stdout/stderr log viewer
│   │   │   └── ReportViewer.tsx    # Tabbed DOMPurify-sanitized report reader
│   │   └── styles/
│   │       └── app.css
│   └── shared/
│       └── types.ts                # Shared TypeScript interfaces
├── specs/
│   ├── app-spec.md
│   └── prompt_mvp.md               # This Phase 1 MVP spec
└── package.json
```

### Shared IPC Type Definitions (`src/shared/types.ts`)
```typescript
export interface HistoryEntry {
  gitUrl: string;
  lastBranch: string;
  lastCommitSha?: string;
  lastReviewedAt: string;
}

export interface ReviewRequest {
  gitUrl: string;
  branch: string;
}

export type ReviewStage = 'idle' | 'fetching' | 'installing' | 'staging' | 'running' | 'completed' | 'failed' | 'aborted';

export interface LogEntry {
  timestamp: string;
  source: 'app' | 'git' | 'install' | 'staging' | 'agent' | 'stderr';
  message: string;
}

export interface ReviewReport {
  packageName: string;
  filePath: string;
  content: string;
}

export interface ReviewStateUpdate {
  stage: ReviewStage;
  branch?: string;
  commitSha?: string;
  error?: string;
}
```

---

## 7. Renderer UI Components & Security

### Security Constraints
- `contextIsolation: true`, `nodeIntegration: false`.
- DOMPurify sanitization applied to all rendered Markdown content.

### UI Components Specification
1. **RepoInputForm**:
   - `gitUrl` text input field with autocomplete / recent repositories dropdown menu.
   - `branch` text input field pre-filled automatically via remote `git ls-remote --symref` query or selected history entry.
   - **Start Code Review** primary button.
   - Fields disabled while a review is actively running.
2. **LogConsole**:
   - Auto-scrolling terminal log interface displaying real-time git operations, host `npm install` output, staging prep, and `run-agent` container output.
3. **ReportViewer**:
   - Automatically loads Markdown reports from `<stagedDir>/reports/*.md`.
   - Renders tabbed view for package code smell reports.

---

## 8. Error Handling & Edge Cases

| Failure Mode | Cause | Handling Strategy |
|---|---|---|
| Remote Default Branch Query Failure | Network latency or invalid URL | Fallback to `main` automatically; allow user manual entry. |
| Host `npm install` Failure | Missing package or private registry auth | Capture `npm install` stderr, log warning, and proceed with staging so static AST analysis can still run on available source files. |
| Invalid Branch / Repo Failure | Remote fetch fails | Do NOT add/update entry in history list until Git fetch succeeds. |
| SSH Key Error | Missing host SSH auth | Capture `git` stderr, show prompt explaining host SSH key requirement. |
| Missing `run-agent` alias | Shell alias not loaded | Pre-flight test `which run-agent` or shell command test; alert user if `run-agent` command not found. |
| User Abort | User clicks "Abort" | Process SIGTERM sent to active subprocess; UI transitions to `aborted`. |

---

## 9. Phase 1 Execution Plan & Tasks

1. **Project Setup**:
   - Initialize Electron TypeScript application shell.
2. **History Service**:
   - Implement `historyService.ts` to read/write `repo_history.json` in user data directory.
3. **Git & Remote Branch Detection Service**:
   - Implement `gitService.ts` for default branch detection (`git ls-remote --symref`), SSH clone/fetch, commit SHA resolution, and SHA workspace creation.
4. **Host Dependency Install Service**:
   - Implement `installService.ts` to execute host-side `npm install` inside the workspace directory.
5. **Staging & Isolation Service**:
   - Implement `stagingService.ts` to copy workspace to `/tmp/.../staged/<commit-sha>/` excluding `.git/` and `CLAUDE.md`, writing `context.json`.
6. **Agent Subprocess Invoker**:
   - Implement `agentInvoker.ts` executing `run-agent` shell command and streaming logs via IPC.
7. **Renderer UI**:
   - Build `RepoInputForm` with URL history dropdown and default branch auto-detection, `StatusTimeline` with `installing` stage, `LogConsole`, and `ReportViewer` components.
8. **Verification**:
   - Run end-to-end flow with sample repository, verifying host `npm install`, history persistence, log streaming, and report rendering.
