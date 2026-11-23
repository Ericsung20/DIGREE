# DB revision checklist

Branch: `db_fix`. Preserve existing shared users, grades, messages, course IDs and optimizer contract.

- [x] Reconcile deployed migrations and document checked object/history differences.
- [x] Reproducible isolated local regression DB and explicit shared deployment target.
- [x] Canonical course aliases, term offerings, import provenance and instructor read interface.
- [x] Unified program/requirement interfaces; remove hard-coded CS requirement calculation.
- [x] Separate planning/history interfaces and atomic active schedule saving.
- [x] Accepted-friend sharing and coherent blocks; obsolete permission data is retained only for compatibility.
- [x] Database uniqueness for normalized account email, friendly duplicate signup feedback.
- [x] Owner-managed transfer credit UI; equivalents in requisites/degree estimates, excluded GPA/chat.
- [x] Generated database types, SQL/web/optimizer tests, build and browser verification.

The team explicitly chose the existing DIGREE hosted project as shared development after the free account's two-project limit prevented another project. No paid upgrade or new remote project was created. Separate production is deferred to public launch. The local stack is for isolated regression checks, not everyday shared data. See `shared-development.md` for both developers' startup steps.

Git delivery uses branch `db_fix` and the existing repository user identity, without an added co-author trailer. The final handoff records the pushed commit.
