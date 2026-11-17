# Google budget automatic synchronization

Goal: the existing protected Budget tab updates its totals, drill-down and diagrams after valid source changes, without Codex or an open browser. No accounting outreach.

Architecture: a dedicated service account in the existing Academy CEO Dashboard Google project receives reader access to exactly the approved master and restricted payroll workbook. Its private key is generated and encrypted on the finance server; only the public certificate is uploaded to Google. A least-privilege server timer fetches bounded Sheets API ranges every two minutes with spreadsheets.readonly scope, builds a candidate from live values, checks hierarchy/controls, and publishes a generation atomically. The API/browser show sync status and preserve the last valid generation on errors. Existing roles, bank jobs, source documents and financial DB rows are preserved.

1. [x] Validate source metadata and provision the reader-only identity; verify granted file permissions. No broad IAM role or domain/public sharing.
2. [x] Implement a source-driven transformer and tests: changed totals and labels; inserted/deleted plan rows; payroll amounts, conditional reserves and tax detail; unknown values and conflicting sources. No static monetary assumptions in the synchronizer. Reject mismatches, stale or partial reads and missing expected structure rather than inventing balancing expense lines.
3. [x] Server collector/publisher: pinned workbook IDs and scopes, auth/retry limits, safe generation directory, last-good pointer, source hashes, optional cash-plan generation, no database writes. Protect credentials from the web process. Timer every two minutes with recovery after reboot.
4. [x] API/browser: dynamic sync timestamp/error state; visible tab refreshes automatically and preserves selected drill-down/scenario. Hide personal detail for non-owner as before. Return to the available root if a selected node disappears.
5. [x] Verify with isolated tests and a reversible non-financial source marker; observe actual scheduled execution and real-source/site readback. Deploy exact file set with backups/hash guard, preserve source amounts and history; document successful/failing behavior and one operational next step.

Rule: authorization to set up this synchronization includes its necessary dedicated reader identity and two source permissions, not write access, public exposure, new colleague requests or revival of stopped automations. This is application runtime scheduling, not an additional Codex heartbeat.

Verified: 42 tests pass; actual timer cycles 10:54 / 10:56 / 10:58 / 11:00 UTC observed. Non-financial source marker appeared and was removed after restoring the exact cell. Current protected API totals agree with Google. No accounting outreach. See BUDGET_SYNC.md and ignored local-state/budget-sync-verification.json.
