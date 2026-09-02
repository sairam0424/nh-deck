# Branches.md — Not-Humans-Lab (canonical template)

This is the source-of-truth branch/release strategy. Copy it **verbatim** into each of daily-dose/nh-deck/nh-skills once scaffolded (each is its own independent git repo — no symlink option). Any per-project deviation must be called out inline in that project's own copy, not left to silently drift.

## Branching Model

Trunk-based / GitHub Flow: `main` is always releasable. All work happens on short-lived branches off `main`. No `develop`/`release/*` hierarchy — a solo maintainer with AI-agent assistance doesn't need one.

## Branch Naming Convention

`type/scope-slug` — e.g. `feat/deck-json-export`, `fix/skills-frontmatter-validation`.

## Attribution of Agent-Originated Work

Tracked via a commit-trailer or PR-description convention, **not** a branch-name prefix, so there's an audit trail of agent-written vs. hand-written work without polluting branch names.

## Commit Convention

[Conventional Commits](https://www.conventionalcommits.org) — required regardless of solo status, since it drives automated semver bumps and changelog generation, not code review.

## Pull Request Discipline

A PR is opened even for solo work. It is the maintainer's single review checkpoint against agent output, and the point where CI must go green before merge — not a social-review artifact.

## Merge Strategy

Squash-merge only. Linear history on `main`. The squash-merge commit message must itself be a valid Conventional Commit.

## Protected Main

Required status checks, no force-push, no direct commits — including by the maintainer, to remove the temptation to bypass CI "just this once."

## Release Automation

Conventional Commits drive automatic semver bump + changelog + publish + git tag off `main`. Zero manual release steps.

- For **nh-deck** and **nh-skills** (npm-published packages): a merge to `main` triggers `npm publish` — strict Conventional Commits adherence matters most here since external consumers may pin versions.
- For **daily-dose** (a deployed content site, not a published library): a merge to `main` triggers a deploy, not a package publish; version tags can be date-based rather than strict semver.

## Parallel-Agent Worktrees

One git worktree per concurrently-running agent/task branch — never let two agents share a working tree.

## Branch Lifetime & Cleanup

Days, not weeks. Auto-delete on merge. Periodic sweep of abandoned agent branches.

## Hotfix Path

Same flow as any other fix — no separate release/hotfix branch hierarchy, because trunk-based means `main` is already always deployable.
