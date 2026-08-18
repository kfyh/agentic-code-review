# Plan: Code Review App Refactoring & Test Coverage Specification (`specs/prompt_mvp_review.md`)

This document outlines the execution plan for refactoring the `code-review-app` codebase and achieving 100% test coverage based on the automated code review analysis report.

---

## Execution Phases Overview

### Phase 0: 100% Code Coverage Baseline

- **Goal**: Configure Jest code coverage reporting and expand unit test suites across all main services, configuration modules, and IPC handlers to achieve 100% branch, statement, function, and line coverage.
- **Tasks**:
  1. Configure `jest.config.js` with `collectCoverage: true` and 100% `coverageThreshold`.
  2. Write comprehensive unit tests for `AgentInvoker`, `GitService`, `HistoryService`, `InstallService`, `ReportService`, `StagingService`, `Config`, and IPC handler logic.
  3. Verify coverage with `npx jest --coverage`.

### Phase 1: High Priority Complexity & Single Responsibility Refactoring

- **Goal**: Reduce high cyclomatic complexity in `AgentInvoker` (Complexity: 18) and `StatusTimeline` (Complexity: 17), and eliminate Single Responsibility Principle (SRP) violations.
- **Tasks**:
  1. Extract stdout report stream parsing out of `AgentInvoker` into `ReportService`.
  2. Simplify `StatusTimeline` step state evaluation using a `getStepStatus` helper function.
  3. Fix Law of Demeter violations in `config.ts` using safe optional chaining (`process.env.STAGING_DIR?.trim()`).

### Phase 2: Pipeline Orchestration & Decoupling

- **Goal**: Decouple IPC routing from execution pipeline orchestration and enforce the Interface Segregation Principle (ISP).
- **Tasks**:
  1. Create `ReviewPipelineRunner` (`src/main/services/reviewPipelineRunner.ts`) to encapsulate end-to-end review pipeline steps (`gitService` -> `historyService` -> `installService` -> `stagingService` -> `agentInvoker`).
  2. Delegate pipeline execution from `ipc.ts` to `ReviewPipelineRunner`.
  3. Segregate monolithic `WindowApi` interface into focused sub-interfaces (`ReviewExecutionApi`, `HistoryApi`, `ReportApi`, `SettingsApi`).

### Phase 3: Strict Type Guards & Subclass Safety

- **Goal**: Eliminate Liskov Substitution Principle (LSP) violations and raw type casting.
- **Tasks**:
  1. Replace `as Node` in `RepoInputForm.tsx` with runtime `instanceof Node` guards.
  2. Replace `as HTMLElement` in `main.tsx` with non-null assertion or element verification.
  3. Replace `as string` in `ReportViewer.tsx` with explicit type checks.

---

## Verification Strategy

- Run Jest coverage suite: `npx jest --coverage`
- Run TypeScript type check: `npm run typecheck`
- Run production build: `npm run build`
