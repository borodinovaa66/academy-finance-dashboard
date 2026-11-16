# Interactive November budget implementation plan

Goal: add a protected Budget section to the existing financial cabinet, opening at income and four expense blocks, with charts, percentages, drill-down, exact source links and visible provisional amounts.

Architecture: reuse the existing Node server and owner/accountant/viewer authentication. A separately validated private budget snapshot is served by a read-only endpoint. An independent browser module adds a cabinet tab without changing the monthly/daily report generators. Existing cash-plan work is preserved. Only owner receives individual payroll detail; other current financial roles receive aggregated payroll nodes.

Authorised scope: user requested the Budget section on the existing published financial site. No new site, permissions, passwords, banks, accountant outreach, payment actions, original-sheet edits, automated sync or production database writes.

1. [x] Source and data contract: refresh exact master ranges and build a private hierarchical snapshot from the verified v3 reconciliation, actual expense lines and current person model. Every non-leaf total must reconcile with its children in cents; unknown amounts stay null and outside known totals. Source date and draft status remain visible. Prior-period reserves472000 are an explicit subset, not an extra expense.
2. [x] Server/API and UI: GET /api/cabinet/budget?month=2026-11, role checks, no-store, strict month and schema validation. Add independent budget assets via the protected cabinet response. Summary, breadcrumbs, nested rows, clickable composition charts, percentages, source details, responsive layout and a labelled scenario excluding prior-period reserves.
3. [x] Verify: financial sum/percentage/duplicate tests; owner and viewer access/redaction; anonymous/admin rejection; null/missing month, malformed snapshot and source links. Run existing access/daily/cash-plan checks and test with a temporary SQLite database. Use CUA for desktop/mobile visual and interaction checks.
4. [x] Publish only this module: backup affected production files and compare hashes immediately before patching the server; preserve current cabinet, cash plan, bank updater and SQLite. Atomic new snapshot; rollback changed files only on failure. Verify published API and UI without resetting credentials. Provide /cabinet#budget and verified limitations.

Presentation: keep the existing understated finance-cabinet style. Expenses7194381; income11755000; named conditional compensation959650; prior-period subset472000; general taxes1095365; full payroll4116060. Figures are planning limits with reservations, not confirmed accruals or a cash calendar. Scenario without prior-period reserves6722381. Salary taxes follow the later user decision in Expenses and are included in payroll.

Verified publication: see BUDGET_PUBLICATION.md and ignored local-state evidence. Independent review found no Critical/Important issues; an additional check removed financial constants from public JS. Existing linked worktree reused; redundant native-worktree request did not return and was stopped, no new worktree observed.
