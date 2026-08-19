# Code Review Desktop App — Spec

## Changelog

### 2026-08-15

- **Subprocess Invocation Simplification**: Removed `-r spec` role argument from `run-agent` invocation. The runner is executed as `run-agent . -p "<prompt>"` with working directory set to the staged workspace (`cwd: stagedDir`). Omitting `-r spec` allows read-write access so the container agent can create and write report files directly to `<stagedDir>/reports/`.
- **Storage Location**: Updated base app data and default staging directory location to `~/.agentic-code-review` (`~/.agentic-code-review/staged/`). The staging folder path remains configurable via settings, environment variables, or UI.

---

## Background & Context

This app builds on top of [agentflow](https://github.com/kfyh/agentflow), an existing multi-vendor agentic Docker framework that already implements the core sandbox, authentication, and prompt runner. agentflow is currently a personal project — Kevin is its only known user. The sandbox model, Docker images, guidelines system, and authentication patterns described here are derived from agentflow and should remain compatible with it.

**The app's primary job** is to automate what is currently done manually before invoking `run-agent.sh`:

- Checking out the repo(s) on the host
- Preparing the workspace (stripping `.git/`, writing context metadata)
- Selecting the right prompt and constructing the final invocation

Everything that happens inside the container is already handled by agentflow's Docker images and Claude Code CLI.

---

## Phasing & Portability Decision

Two architectural options were considered for how the app relates to agentflow:

- **Library-ify agentflow**: extract its core logic into a shared module both the CLI and the Electron app depend on
- **Standalone**: the app vendors its own Docker/sandbox logic independent of agentflow

Both were deferred. **agentflow's engine discovery model (scan sibling folders for `agent.conf`, default to a hardcoded engine) is a personal-tool convention** — it assumes the user has a matching folder structure and pre-configured, pre-authenticated CLIs for whichever engines are present. That assumption does not hold for a third party downloading this app: they may have none of Claude/Gemini/Mistral set up, or a different provider entirely. Solving that properly means redesigning engine discovery either way, which is most of the work of both options above.

**Decision: Phase 1 is Option C — shell out to agentflow's `run-agent.sh` as a subprocess.**

Rationale: agentflow already works, is security-reviewed (this document), and has exactly one user (Kevin) today. Building the app as a thin subprocess wrapper around it gets a working tool shipped fastest, without committing to a portability design before there's evidence anyone besides Kevin needs it.

**Known limitation accepted for Phase 1:** the app is not portable to other users without them separately setting up agentflow (cloning it, building the relevant engine image, authenticating). This is acceptable for a personal tool but blocks wider distribution.

**Deferred to Phase 2 (trigger: someone other than Kevin wants to run this):**

- Decide standalone vs. library-ified agentflow
- Design dynamic provider detection (no hardcoded default engine)
- Vendor or bundle Docker image definitions so a new user doesn't need a separate agentflow checkout

---

## Current Workflows (Manual)

### Flow 1 — Single Branch Review

```bash
# Manual today:
git checkout <branch>
# Load Docker container, mount repo workspace
run-agent.sh -c claude /path/to/repo -p "$(cat prompts/code-review-prompt.txt)"
```

### Flow 2 — Diff Review (Branch vs Main)

```bash
# Manual today:
git checkout main   # → /parent/main/
git checkout branch # → /parent/branch/
run-agent.sh -c claude /parent/ "ad hoc diff review prompt"
```

Flow 2's prompt is currently ad hoc. Standardising it is a goal of this project.

---

## App Goal

An Electron desktop app (TypeScript) that:

1. Takes a repo URL and branch selection as input
2. Performs git operations on the host (outside the sandbox)
3. Prepares the workspace (staging)
4. Invokes the agentflow Docker container with the correct prompt
5. Displays the output in the UI

It is not a reimplementation of agentflow — it is an orchestration layer on top of it.

---

## Threat Model & Security Realities

> [!NOTE]
> **Network Access**: The agent operates with full outbound network access via the container host to install required analysis packages (`madge`, `ts-morph`) or fetch public dependencies. Protecting against data exfiltration is explicitly out of scope.

The threat model focuses primarily on **host integrity and source safety** rather than data exfiltration. The company already trusts Claude as a model; jailbreaking and exfiltration protection are out of scope.

| Threat Vector                   | Mitigation Strategy                                                                                                                     |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **Host System Tampering**       | Agent runs inside non-root container (`node` user) with dropped capabilities (`--cap-drop ALL`, `--security-opt no-new-privileges`).   |
| **Codebase Corruption**         | Workspace is mounted in an isolated staging copy (`~/.agentic-code-review/staged/<commitSha>`); host repo remains untouched.            |
| **Unauthorised Git Commits**    | `git` binary is intentionally omitted from the container image, preventing unauthorised local or remote commits.                        |
| **Git History Leakage**         | `.git/` directory is explicitly excluded during staging prep before mounting into the sandbox.                                          |
| **File-Based Prompt Injection** | `CLAUDE.md` is stripped from the staged workspace to prevent instruction overriding; baseline constraints enforced by `guidelines.txt`. |
| **Credential Safety**           | Host credentials never reach the mount; OAuth tokens reside in named container volumes (`agentic-coder-claude`), keeping credentials out of `process.env`. |
| **Malicious npm Postinstall**   | `--ignore-scripts` recommended on LLM-triggered installs; pre-baking analysis tools into Docker image removes live install risks.      |
| **Renderer XSS**                | UI runs with `contextIsolation: true`, `nodeIntegration: false`, and renders Markdown via `marked` + `DOMPurify`.                       |

### Notes on Prompt Injection

The main viable vector is a malicious instruction embedded in a file inside the repo (e.g. a comment, a `README.md`, or a `CLAUDE.md`). The LLM may follow instructions it reads from files even when they conflict with the system prompt — this is a known behaviour ("follow the prompt.md file" style attacks). Claude Code automatically reads `CLAUDE.md` from the working directory before the system prompt is applied, making it a particularly direct vector.

Mitigations:

- Exclude `CLAUDE.md` from the staged workspace (see Staging Prep)
- Guidelines are appended to every prompt by the runner, establishing baseline constraints
- The sandbox limits what a successfully injected instruction can actually _do_

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Electron App (host)                                       │
│                                                            │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐   │
│  │  Auth    │   │  Git ops │   │  Prompt Builder      │   │
│  │  Manager │   │  (clone, │   │  (selects prompt,    │   │
│  │          │   │  diff)   │   │   appends guidelines)│   │
│  └────┬─────┘   └────┬─────┘   └──────────┬───────────┘   │
│       │              │                     │               │
│       │         ┌────▼──────────────────── ▼────────────┐  │
│       │         │  Staging Prep                         │  │
│       │         │  (rsync excl. .git/, CLAUDE.md)       │  │
│       │         └────────────────┬──────────────────────┘  │
│       │                          │                         │
└───────┼──────────────────────────┼─────────────────────────┘
        │                          │ mount
        │    ┌─────────────────────▼──────────────────────┐
        │    │  Docker Sandbox (agentflow image)          │
        │    │                                            │
        │    │  /workspace     (ro or rw per role)        │
        │    │  /home/node/.claude  ← named volume        │
        │    │                   (OAuth credentials)      │
        │    │                                            │
        │    │  ┌──────────────────────────────────────┐  │
        └────┼──►  claude --permission-mode             │  │
             │  │  bypassPermissions -p "{{PROMPT}}"   │  │
             │  └──────────────────────────────────────┘  │
             └────────────────────────────────────────────┘
```

---

## Authentication

Authentication design mirrors agentflow exactly.

### Anthropic (Claude)

Credentials are stored in a named Docker volume (`agentic-coder-claude`) mounted at `/home/node/.claude` inside the container. The OAuth flow runs interactively once; subsequent runs reuse the persisted token. No credential is passed as an environment variable in OAuth mode.

OAuth flow: user runs the container interactively once (`run-agent.sh -c claude .`), completes the browser login, and the token is saved in the volume. The Electron app triggers this same interactive flow if the volume has no valid credential.

API key mode: `ANTHROPIC_API_KEY` is passed as an env var (`-e ANTHROPIC_API_KEY=...`). This is less secure than the volume approach (postinstall scripts can read env vars) but is supported as a fallback.

**Preference: OAuth via named volume. Do not pass tokens as env vars.**

### Google Gemini

`GEMINI_API_KEY` env var, or interactive Google One OAuth (no API key set → container runs interactively). Credentials persisted in `agentic-coder-gemini` volume at `/home/node/.gemini`.

### Mistral

`MISTRAL_API_KEY` env var, or interactive setup. Credentials in `agentic-coder-vibe` volume.

---

## Workflows

### Flow 1 — Single Branch Review

1. User selects a repo URL and branch in the UI
2. App clones / fetches the branch on the host
3. Staging prep runs (see below)
4. App invokes agentflow runner with:
   - Invocation: `run-agent . -p "<prompt>"` (no role flags, executed with `cwd: stagedDir` for read-write access to create reports)
   - Prompt: `prompts/code-review-prompt.txt` (existing, mature prompt — see below)
   - Workspace: staged directory (`~/.agentic-code-review/staged/<commitSha>`)
5. Container output streamed to UI via the agentflow stream formatter
6. Review result displayed and optionally saved

### Flow 2 — Diff Review (Branch vs Main)

1. User selects repo URL, base branch (main), and compare branch
2. App clones both into sibling directories:
   ```
   staging/
     main/       ← base
     feature/    ← compare
   ```
3. Staging prep runs on both
4. App computes `git diff main..feature` on the host and writes `staging/diff.patch`
5. Invokes container with the parent `staging/` directory mounted
6. Prompt: `prompts/diff-review.txt` (to be standardised — see Open Questions)

---

## Staging Prep (host-side, before mount)

Produces a temporary copy of the checked-out code for mounting into the container.

**Excluded from staging copy:**

```
.git/        # prevents raw git object/history reads; git binary not in image anyway
CLAUDE.md    # Claude Code reads this automatically before system prompt; injection vector
```

Host credentials (`.npmrc`, `.ssh`, `.gitconfig`, `.env`, etc.) exist only on the host and are never present in a repo checkout — no scrubbing required.

**Process:**

1. `rsync` repo → `staging/`, excluding `.git/` and `CLAUDE.md`
2. Write `staging/context.json`: repo name, branch, commit SHA

---

## npm / Node Dependencies

This section reflects the actual pattern already established in agentflow's `guidelines.txt`:

> **Guideline 9 (agentflow):** If you encounter binary or environment mismatches for native dependencies due to host-to-container volume mounting, do NOT run `npm install` or `npm ci` in the container. Instead, run `npm rebuild` inside the container.

The pattern:

- `npm install` runs on the **host** before the review (resolves package graph, downloads deps)
- Inside the container, the LLM installs analysis tools (madge, ts-morph, dpdm, dependency-cruiser) via `npm install -g <pkg>`
- `npm rebuild` is used inside the container if native module binaries need recompilation for the Linux container environment
- Private scoped packages (`@aristocrattechnologiesinc`, `@roxorgaming`) cannot be installed inside the container — no `.npmrc` is present (by design, per agentflow guideline 7)

### Security: npm postinstall scripts

`npm install -g <pkg>` runs the package's `postinstall` lifecycle script with the same privileges as the installing process. This is a documented supply chain attack vector with active exploitation in the wild:

- **`radar-cms` (2021)**: postinstall used `wget` to exfiltrate `~/.kube/config`, `/etc/passwd`, and env vars to an external webhook ([Snyk research](https://snyk.io/blog/npm-security-malicious-code-in-oss-npm-packages/))
- **Redis/PostgreSQL campaign (Apr 2026)**: 36 packages with postinstall hooks that scanned disk for secrets and exfiltrated them ([The Hacker News](https://thehackernews.com/2026/04/36-malicious-npm-packages-exploited.html))
- **Hugging Face CDN campaign (Dec 2025)**: postinstall fetched malicious binaries from public model hosting, bypassing domain blocklists ([The Hacker News](https://thehackernews.com/2025/12/malicious-npm-package-uses-hidden.html))
- **Microsoft dependency confusion campaign (May 2026)**: 33 packages profiled developer environments via postinstall ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/2026/05/29/33-malicious-npm-packages-abuse-dependency-confusion-profile-developer-environments/))

In the context of this sandbox, a postinstall script triggered by a prompt-injected `npm install -g <malicious-pkg>` could:

1. Read `/workspace` (mounted read-only but fully readable) and exfiltrate source code
2. Read environment variables — which is why OAuth credentials should be stored in Docker volumes rather than passed as env vars
3. Write a trojan binary to the npm global prefix that runs later in the same session

**Mitigations:**

1. **`npm install -g <pkg> --ignore-scripts`** for LLM-triggered installs. Breaks packages that genuinely need build steps (e.g. native bindings), but eliminates postinstall execution. Document this trade-off.
2. **OAuth via named volume, not env var** — already the agentflow default. Ensures `process.env` contains no Anthropic credentials for a postinstall to steal.
3. **Pre-bake common tools into the Docker image** — madge, ts-morph, dpdm, dependency-cruiser are known tools used by the review prompt. Installing them at image build time removes the need for live `npm install -g` during a session, eliminating the postinstall risk for the common case.
4. **`--ignore-scripts` as default, with user opt-out** — for power users who know their tool needs a build step.

---

## Docker Sandbox

The Docker images are maintained in agentflow. The spec below documents the Claude image as a reference.

### Claude Image (from `agentflow/claude/Dockerfile`)

Key properties:

- Base: `node:20-bookworm-slim`
- **`git` intentionally not installed**
- Non-root user: `node`
- Python 3 + `/opt/venv` pre-configured (bypasses PEP 668)
- Pre-installed global tools: `typescript`, `ts-node`, `eslint`, `prettier`, `webpack`, `webpack-cli`
- Claude Code CLI installed via `curl -fsSL https://claude.ai/install.sh | bash` as `node` user
- `curl`, `wget`, `jq`, `ripgrep`, `build-essential` available

### Recommended run flags (additional to agentflow defaults)

agentflow's runner does not currently set `--cap-drop ALL` or `--security-opt no-new-privileges`. These should be added for the code review app:

```bash
docker run \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  # ... agentflow's existing flags
```

Verify that `--network none` does not leak DNS queries in the Colima/WSL2 environments. The default bridge network blocks TCP/UDP but DNS behaviour can vary.

### Writable surfaces inside container

| Path                 | Purpose            | Notes                                        |
| -------------------- | ------------------ | -------------------------------------------- |
| `/workspace`         | Repo code          | `ro` in spec/design role, `rw` in coder role |
| `/home/node/.claude` | OAuth credentials  | Named volume, persisted across runs          |
| `/home/node/.local`  | Claude Code binary | Installed at image build time                |
| `/opt/venv`          | Python packages    | Pre-created, writable by `node` user         |
| `/tmp`               | Scratch            | Ephemeral                                    |

---

## Existing Prompt: `code-review-prompt.txt`

The existing prompt in `agentflow/prompts/code-review-prompt.txt` is mature and should be the starting point for Flow 1. Key characteristics:

- Targets TypeScript source under `src/` (excludes tests, build output, `node_modules`)
- For monorepos: shallow package-level pass first, then deep per-package analysis
- **Circular dependencies**: mandates AST-based tooling (madge > dpdm > dependency-cruiser); explicitly forbids regex-based import scanning
- **Cyclomatic complexity**: threshold > 15; requires scripted analysis (ts-morph preferred)
- **SOLID violations**: SRP, OCP, LSP, ISP, DIP with specific patterns to detect
- **Clean architecture smells**: boundary violations, feature envy, temporal coupling, leaky abstractions, primitive obsession
- Deliverables: `reports/<package_name>_code_smells.md` per package
- Safety limits: abort if nodes visited > 5000; record partial results and continue

This prompt uses madge and ts-morph. If pre-baking tools into the image (recommended), these two are the minimum additions.

---

## Guidelines System

`agentflow/guidelines.txt` is appended to every prompt automatically by the runner. It defines hard safety constraints:

1. No foreground web servers or file-watchers
2. No Rust/Tauri compilation inside the container
3. Use fast, non-blocking verification (`tsc --noEmit`, `npm run lint`)
4. Track progress with `tasklist.md` in workspace root
5. Write outputs to workspace only (not `.gemini/`, `/tmp`, home dirs)
6. No git commands
7. No private npm registry installs (no `.npmrc`)
8. No sudo/root
9. Use `npm rebuild` not `npm install` for native module mismatches

The Electron app must preserve this append behaviour when constructing prompts.

---

## Electron App Structure

### Phase 1 — utilise agentflow (subprocess)

The app automates workspace prep and delegates execution to agentflow. It does not reimplement the Docker logic — `runAgentInvoker.ts` shells out to `run-agent.sh` (or `run-agent.ps1` on Windows) as a subprocess, passing the engine, role, workspace path, and assembled prompt as CLI args, and streams stdout/stderr back to the renderer.

```
code-review-app/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── auth/
│   │   │   ├── claude.ts        # Check agentic-coder-claude volume exists/valid
│   │   │   ├── gemini.ts        # Check agentic-coder-gemini volume exists/valid
│   │   │   └── mistral.ts       # Check agentic-coder-vibe volume exists/valid
│   │   ├── git.ts               # Clone, diff, branch ops (host-side)
│   │   ├── staging.ts           # rsync excl. .git/, CLAUDE.md; write context.json
│   │   ├── runAgentInvoker.ts    # Phase 1: spawn run-agent.sh, stream output
│   │   ├── prompt.ts            # Load prompt + guidelines, interpolate vars
│   │   └── review.ts            # Orchestrates a full review run
│   ├── renderer/                # Electron renderer (UI)
│   │   └── output.ts            # DOMPurify sanitization before render
│   └── shared/
│       └── types.ts
├── prompts/
│   ├── code-review-prompt.txt   # Symlink or copy from agentflow/prompts/
│   ├── diff-review-prompt.txt   # To be written (see Open Questions)
│   └── guidelines.txt           # Symlink or copy from agentflow/guidelines.txt
├── specs/
│   └── app-spec.md              # this file
└── package.json
```

`agentInvoker.ts` is a thin wrapper: it assumes a working agentflow checkout exists on disk (path configured in app settings) and constructs the simplified runner invocation with no extra role arguments:

```ts
spawn('/bin/bash', ['-i', '-c', `run-agent . -p ${escapeShellArg(promptContent)}`], {
  cwd: stagedDir,
});
```

This is the boundary that gets replaced in Phase 2 — everything else in the app (git ops, staging, prompt assembly, UI) should be written so it doesn't care how the invocation actually happens.

### Phase 2 — internalise agentflow (dependency + API)

Trigger: someone other than Kevin needs to run this app (see Phasing & Portability Decision above).

Most likely shape: agentflow's core logic (image build, volume/auth handling, mount flag selection, prompt+guidelines assembly, docker invocation) is extracted into a package that agentflow's own CLI _and_ this app both depend on, called via a function/API instead of a subprocess + string args. `runAgentInvoker.ts` is replaced by a direct call into that package — no shelling out, no CLI arg serialization, typed inputs/outputs.

This also removes the CLI-args-as-command-line-prompts pattern entirely, and is the natural point to solve dynamic provider detection and drop the "must have a matching agentflow checkout" requirement.

Not yet decided: whether this becomes a published npm package, a git submodule, or stays a monorepo-style local dependency. Deferred until Phase 2 is triggered.

### Electron Security

- `contextIsolation: true`, `nodeIntegration: false` in all `BrowserWindow` instances
- LLM output (from `/output/review.md` or stream) sanitized with [DOMPurify](https://github.com/cure53/DOMPurify) before rendering
- Review rendered as markdown (via a sanitizing renderer, e.g. `marked` + DOMPurify), not raw HTML
- No `eval()` or dynamic script execution in the renderer

---

## Colima / Docker Engine Compatibility

agentflow documents and supports:

- **macOS**: Colima (avoids Docker Desktop commercial licensing for orgs > 250 employees or > $10M revenue)
- **Windows**: WSL2 with native Docker Engine
- **Linux**: Native Docker Engine

The Electron app must detect the available container engine (Docker or Podman) and adapt flags accordingly, matching agentflow's existing detection logic in `run-agent.sh`.

---

## Open Questions

- **Diff review prompt**: Flow 2 currently uses ad hoc prompts. A standardised `diff-review-prompt.txt` needs to be written. Key decision: does the LLM receive the full diff, or the full file trees of both branches, or the diff + file lookup tool?
- **Diff size limits**: Very large diffs will exceed context windows. Chunking strategy needed for Flow 2.
- **Tool pre-baking**: Which tools to bake into the Docker image? Minimum: `madge`, `ts-morph`. Possibly also `dpdm`, `dependency-cruiser`.
- **`--ignore-scripts` trade-off**: Some tools genuinely need postinstall build steps. Document which known tools are affected and whether the pre-bake approach eliminates the need for live installs.
- **Output format**: Plain markdown review, or structured JSON (findings with file/line references) for UI features like jump-to-file?
- **Review persistence**: Store reviews locally (SQLite) for history, or always ephemeral?
- ~~**agentflow coupling**: Should the app call `run-agent.sh` directly or replicate the `docker run` invocation?~~ Decided: Phase 1 shells out to `run-agent.sh` directly. See Phasing & Portability Decision above.
- **Phase 2 trigger**: what's the actual signal that portability work is needed — a specific person asking to use it, or a decision to distribute proactively?

---

## References

- [agentflow README](../agentflow/README.md) — sandbox model, auth, runner design
- [agentflow guidelines.txt](../agentflow/guidelines.txt) — safety constraints appended to all prompts
- [agentflow claude/Dockerfile](../agentflow/claude/Dockerfile) — Claude sandbox image
- [Existing code review prompt](../agentflow/prompts/code-review-prompt.txt)
- [Claude Code authentication docs](https://docs.anthropic.com/en/docs/claude-code/iam)
- [Snyk: npm malicious code research](https://snyk.io/blog/npm-security-malicious-code-in-oss-npm-packages/)
- [The Hacker News: 36 malicious npm packages, Apr 2026](https://thehackernews.com/2026/04/36-malicious-npm-packages-exploited.html)
- [The Hacker News: Hugging Face CDN attack, Dec 2025](https://thehackernews.com/2025/12/malicious-npm-package-uses-hidden.html)
- [Microsoft Security Blog: dependency confusion campaign, May 2026](https://www.microsoft.com/en-us/security/blog/2026/05/29/33-malicious-npm-packages-abuse-dependency-confusion-profile-developer-environments/)
- [NPM ignore-scripts best practices](https://www.nodejs-security.com/blog/npm-ignore-scripts-best-practices-as-security-mitigation-for-malicious-packages)
- [DOMPurify](https://github.com/cure53/DOMPurify)
