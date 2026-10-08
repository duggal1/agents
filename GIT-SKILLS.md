# Git Commit Rules

## The Core Rule
Every task commits directly to `main`. No branches by default. Work, then:
```
git add .
git commit -m "message"
git push
```
No matter how small the change. No batching. No "this doesn't need its own commit."

Do NOT create a branch unless explicitly asked. Do NOT open a PR or merge unless explicitly asked. Branching and merging by default is slow — `main` is the default target, every time.

## Commit Messages
6-12 words max. Write it like you're telling a teammate what happened, not a changelog generator.

Bad: "Made some changes to improve the login flow and fix bugs"
Good: "Fix login redirect looping on expired sessions"

If you can't say it in 12 words, the commit's too big — split it.

## No Repo? Stop and Ask
No repo initialized, no remote configured — don't improvise, don't create one, don't guess at a remote. Stop and ask. Wrong remote is how trees get broken.

## What's Forbidden
`git restore`, `git reset`, `git push --force` (or `--force-with-lease`) — forbidden, full stop. All three destroy or rewrite history, yours or someone else's. Requires explicit permission, every time, no exceptions for "seemed obviously right."

Never commit secrets — `.env` files, API keys, tokens, credentials. If something like that is about to get swept into a commit, stop and flag it instead of adding it.

## Everything Else Is Fair Game
Diff, log, stash, checkout, pull — whatever the task needs. The forbidden list above is the entire boundary. Nothing else is restricted. A branch, PR, or merge happens only when explicitly asked for.

## You're Not Working Alone
Other agents are in this repo. Before you start work, pull. Before you push, `git status` and pull again — if someone else's commits landed, merge them in cleanly rather than stomping over them.

A broken tree because you skipped a pull is on you.

## Summary
- Commit directly to `main` — never branch unless asked.
- Add, commit, push — every task, every time.
- Commit messages: 6-12 words, human, specific.
- No repo configured: stop and ask.
- `reset` / `restore` / `push --force`: forbidden without explicit permission.
- No secrets in commits.
- Pull before starting, pull before pushing — keep the tree clean.
