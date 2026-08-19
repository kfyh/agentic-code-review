# Specification: Flow 2 — Diff Review against Change Spec (`specs/prompt_diff.md`)

## 1. Overview & Goal

Flow 2 extends the desktop application's capability beyond single-repository code smell analysis to conduct **PR / Branch Diff Reviews** against a base branch (e.g. `main` or `master`) in the context of a **User Change Specification** (e.g., JIRA ticket description, product requirement, or PR description).

### Key Objectives:
- **Spec Compliance**: Verify whether implemented changes fulfill the provided JIRA / feature description.
- **Diff & Regression Analysis**: Detect unintended side effects, broken API contracts, backward compatibility issues, and scope creep.
- **Structural Integrity**: Ensure new or modified code follows established repository patterns, clean architecture principles, and AST modularity standards.
- **Automated Workspace Staging**: Prepare isolated parent staging directories containing baseline (`base/`), updated (`compare/`), and patch (`diff.patch`) files without altering the developer's host repository.

---

## 2. Architectural Principles: Flow 1 Service & Component Reuse

To maintain codebase simplicity and prevent duplicate logic, **Flow 2 relies on the exact same underlying services, IPC channels, and UI components created for Flow 1**, parameterizing them where necessary.

> [!IMPORTANT]
> **Core Architectural Requirement**: Anything not explicitly noted as unique to Flow 2 is **identical to Flow 1**.

### Service & Component Reuse Matrix:

| Subsystem / Service | Shared from Flow 1? | Parameterization / Flow 2 Adaptation |
| :--- | :---: | :--- |
| **Agent Subprocess Invoker** (`agentInvoker.ts`) | **YES (100%)** | Parameterized with `stagedDir` (parent staging directory path) and `promptContent` (merged diff prompt string). Spawns `run-agent . -p "<prompt>"` in `cwd: stagedDir`. |
| **Live Log Streaming & Console** (`LogConsole.tsx` & `review:log`) | **YES (100%)** | Unchanged. Captures real-time `stdout` and `stderr` chunks from the container process and streams them directly to the renderer UI. |
| **Progress & Stage Indicator** (`StatusTimeline.tsx` & `review:state`) | **YES (100%)** | Unchanged. Uses the exact same stage state machine (`idle` -> `fetching` -> `installing` -> `staging` -> `running` -> `completed` / `failed`). |
| **Report Extraction & Parser** (`reportService.ts`) | **YES (100%)** | Parameterized by output directory location (`<stagedDir>/reports/`). Parses markdown report files (`review.md` / `diff_review.md`) with fallback to formatted `stdout` blocks. |
| **Report Viewer Component** (`ReportViewer.tsx`) | **YES (100%)** | Unchanged. Renders tabbed Markdown reports with DOMPurify sanitization and code block syntax highlighting. |
| **Repository History Service** (`historyService.ts`) | **YES (100%)** | Unchanged. Reads and writes recent SSH Git repository URLs to `repo_history.json`. |
| **Host Git & Install Services** (`gitService.ts` & `installService.ts`) | **YES (100%)** | Extended to fetch two branches (`baseBranch` and `compareBranch`) and execute host `npm install` on both checked-out subtrees prior to staging. Auto-detects default branch via `git ls-remote`. |

---

## 3. User Experience & UI View Switching

The application UI introduces a top-level **Flow Switcher** (Tab Navigation or Segmented Control) allowing users to toggle seamlessly between **Flow 1 (Single Codebase Review)** and **Flow 2 (PR & Diff Review)**.

### UI Layout & Wireframe:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Mode Switcher Tabs: [ Single Repo Review ]  [ ★ PR & Diff Review ]    │
├────────────────────────────────────────────────────────────────────────┤
│                     Flow 2: Diff Review Input View                      │
│                                                                        │
│  Git Repository URL (SSH):                                             │
│  [ git@github.com:org/repo.git                                     ▼]  │
│                                                                        │
│  Base Branch (Target):                Compare Branch (Feature):        │
│  [ main                           ]   [ feature/JIRA-1234          ]  │
│  (Auto-detected remote default)       (User feature branch)            │
│                                                                        │
│  Change Specification (JIRA Description / Acceptance Criteria):        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ JIRA-1234: Add retry mechanism and rate-limiting to API client. │  │
│  │ - Must retry HTTP 5xx errors up to 3 times with exponential back.│  │
│  │ - Must respect 429 Retry-After headers.                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ Start Diff Review ]                                                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ User clicks "Start Diff Review"
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Execution & Staging Setup (Reused UI)                    │
│                                                                        │
│  Status Timeline (Reused):                                             │
│  [●] Fetching Branches ──► Host Diff ──► Staging ──► Agent             │
│                                                                        │
│  Log Console Output (Reused LogConsole.tsx):                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ [10:14:02] [GIT] Fetching origin/main and origin/feature/JIRA-1234...│
│  │ [10:14:05] [DIFF] Generated unified diff at ./diff.patch (4.2 KB)│  │
│  │ [10:14:08] [STAGING] Prepared parent staging directory...        │  │
│  │ [10:14:09] [AGENT] Spawning run-agent . -p "<merged prompt>"...  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ Abort Execution ]                                                   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Agent completes execution
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Diff Review Report View (Reused)                     │
│                                                                        │
│  Report Viewer (Reused ReportViewer.tsx):                              │
│  [ review.md ]                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ # PR & Diff Review Report (JIRA-1234)                            │  │
│  │ ## 1. Change Specification Verification                           │  │
│  │ - [x] Exponential backoff retry implemented for HTTP 5xx.        │  │
│  │ - [!] Missing handling for Retry-After header in httpClient.ts.  │  │
│  │ ...                                                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### View Switcher Options:
- **Baseline Design**: Header Tab Bar (`[ Single Repo Review ]` vs `[ PR & Diff Review ]`).
- **Alternative Design Options**: Segmented Control Toggle button bar embedded at the top of the input form card.
- **State Preservation**: Switching tabs preserves active input state and log outputs between views.

---

## 4. Host Workspace & Staging Setup (Parent Directory Structure)

The host staging service (`stagingService.ts`) prepares a dedicated parent staging folder for Flow 2 under `~/.agentic-code-review/staged/diff-<hash>/`.

### Folder Layout:

```
~/.agentic-code-review/staged/diff-<commitSha>/
├── base/             # Checkout of Base Branch (e.g. main/master)
├── compare/          # Checkout of Compare Branch (e.g. feature/JIRA-1234)
├── diff.patch        # Unified git diff generated on host (git diff base..compare)
├── context.json      # Metadata containing repo URL, branches, commit SHAs, and change spec
└── reports/          # Output directory where agent writes review.md
```

### Staging Steps:

1. **Host Checkout & Fetch**:
   - Fetch remote branches on host: `git fetch origin <baseBranch> <compareBranch>`.
   - Checkout `<baseBranch>` into host workspace `base/` and resolve `baseCommitSha`.
   - Checkout `<compareBranch>` into host workspace `compare/` and resolve `compareCommitSha`.

2. **Host Diff File Generation**:
   - Generate unified diff patch on the host:
     ```bash
     git diff origin/<baseBranch>..origin/<compareBranch> > diff.patch
     ```
   - Save `diff.patch` to the parent staging root.

3. **Sanitization & Cleanup**:
   - **Strip `.git/`**: Delete `.git/` directories from both `base/` and `compare/` subtrees to block raw git object reads, history scraping, and git command execution inside the container.
   - **Strip `CLAUDE.md`**: Delete `CLAUDE.md` files from both `base/` and `compare/` subtrees to prevent file-based prompt injection override attacks.

4. **Host Dependency Resolution**:
   - Run `npm install --no-audit --no-fund` in `base/` and `compare/` on the host prior to container mounting to supply `node_modules` for AST analysis tools (`ts-morph`, `madge`).

5. **`context.json` Generation**:
   - Write metadata file to parent staging root:
     ```json
     {
       "repoUrl": "git@github.com:org/repo.git",
       "baseBranch": "main",
       "baseCommitSha": "a1b2c3d4...",
       "compareBranch": "feature/JIRA-1234",
       "compareCommitSha": "e5f6g7h8...",
       "changeSpec": "JIRA-1234: Add retry mechanism and rate-limiting to API client...",
       "stagedAt": "2026-08-19T20:30:00Z"
     }
     ```

---

## 5. Prompt Construction & Spec Merging

The prompt builder (`promptService.ts`) merges the base diff review prompt template with the user's Change Spec and guidelines.

### Prompt Composition:

```
┌────────────────────────────────────────────────────────┐
│ 1. Base Diff Review Template                           │
│    (prompts/diff-review-prompt.md)                    │
├────────────────────────────────────────────────────────┤
│ 2. Change Specification Section                        │
│    ## Target Change Specification (User Provided)     │
│    <user change spec text>                             │
├────────────────────────────────────────────────────────┤
│ 3. Workspace Context Instructions                      │
│    - Base code is in ./base/                           │
│    - Compare code is in ./compare/                     │
│    - Patch file is in ./diff.patch                     │
├────────────────────────────────────────────────────────┤
│ 4. Guidelines System                                   │
│    (prompts/guidelines.txt)                            │
└────────────────────────────────────────────────────────┘
```

### Interpolated Prompt Variables:
- `{{CHANGE_SPEC}}`: Inserted verbatim from user input.
- `{{BASE_BRANCH}}`: Inserted from selected base branch name.
- `{{COMPARE_BRANCH}}`: Inserted from selected compare branch name.
- `{{DIFF_PATCH_PATH}}`: Path `./diff.patch` relative to parent staging root.

---

## 6. Agent Subprocess Invocation (`runAgentInvoker` - Reused)

The Electron main process invokes `run-agent` using the **exact same `agentInvoker.ts` service as Flow 1**, passing the parent staging folder as working directory and the merged diff prompt string.

### Execution Command:

```bash
run-agent . -p "<merged_diff_prompt_content>"
```

- **Working Directory (`cwd`)**: `~/.agentic-code-review/staged/diff-<commitSha>/`
- **Mount Access**: Non-root container mounts parent staging folder giving agent access to `./base/`, `./compare/`, `./diff.patch`, and `./reports/`.
- **Log Streaming**: Live `stdout` and `stderr` streams captured via IPC (`review:log`) and displayed in `LogConsole`.

---

## 7. Report Delivery & Output Extraction (`reportService.ts` - Reused)

1. **Target Report File**: The agent writes its final analysis report to `./reports/review.md` (or `reports/diff_review.md`) inside the parent staging folder.
2. **Extraction & Fallback**:
   - Reused `reportService.ts` checks for `reports/review.md` in the parameterized staging directory upon process exit (code 0).
   - If `reports/review.md` is absent, falls back to parsing formatted markdown blocks from captured `stdout`.
3. **UI Rendering**:
   - Reused `ReportViewer.tsx` loads the report content into the renderer UI.
   - Markdown rendered safely using `DOMPurify` + `marked`.

---

## 8. Data Types & IPC Channel Specification

### Shared Interfaces (`src/shared/types.ts`):

```typescript
export interface DiffReviewRequest {
  gitUrl: string;
  baseBranch: string;
  compareBranch: string;
  changeSpec: string;
}

export interface DiffReviewContext {
  repoUrl: string;
  baseBranch: string;
  baseCommitSha: string;
  compareBranch: string;
  compareCommitSha: string;
  changeSpec: string;
  stagedAt: string;
}

export type ReviewMode = 'single' | 'diff';
```

### IPC Communication Channels (Reused & Extended):

| Channel             | Direction        | Payload                        | Description                                  |
| ------------------- | ---------------- | ------------------------------ | -------------------------------------------- |
| `review:start-diff` | Renderer -> Main | `DiffReviewRequest`            | Trigger Flow 2 diff review pipeline          |
| `review:state`      | Main -> Renderer | `ReviewStateUpdate`            | Broadcast stage updates (Reused 1:1)         |
| `review:log`        | Main -> Renderer | `LogEntry`                     | Live stream process logs (Reused 1:1)        |
| `review:complete`   | Main -> Renderer | `{ reports: ReviewReport[] }`  | Send finalized report(s) (Reused 1:1)        |
| `review:abort`      | Renderer -> Main | `void`                         | Cancel running review subprocess (Reused 1:1)|

---

## 9. Error Handling & Edge Cases

| Edge Case                          | Handling Strategy                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Empty Diff** (`diff.patch` 0 B)  | Detect host-side during diff generation; abort early with warning message: "No differences found between base and compare". |
| **Large Diff (> 500 KB / 10K lines)** | Truncate patch in `diff.patch` with header note and instruct agent to inspect changed files directly in `./compare/`.       |
| **Missing Base Branch**            | Fallback to remote default branch auto-detected via `git ls-remote --symref HEAD`.                                         |
| **Empty Change Spec**              | Prompt agent to perform general diff code review focusing on API breaks, side effects, and code smells.                     |
| **Process Timeout / Abort**        | Send `SIGTERM` to `run-agent` subprocess; preserve partial logs and clean up staging folder on app exit.                   |
