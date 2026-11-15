# Local scenario testing

Chromium used the Next.js app with local Supabase Auth and Postgres, and the Python Optimizer over HTTP. Scheduling used three synthetic 3-credit Monday sections. The instructor check used the public UW Fall 2026 sections for COMP SCI 300.

## Reproduced bugs

| Reproduction | Expected | Before the fix | Fix |
| --- | --- | --- | --- |
| Open Profile → Degree requirements → From DARS PDF, save a requirement with 3 credits remaining, and reload | The saved requirement is visible in the DARS view after reload | Reload switched to From my courses. The saved row appeared after manually reopening DARS. | Store the selected view in the URL. |
| Import Fall 2026 COMP SCI 300 sections, add the course as Completed, and open its detail from Schedule | A known section can be attached to the record so the detail shows its published instructor | The importer saved empty instructor lists for all three sections because it expected string names. The course form and section editor also gave completed records no way to select a section. | Read structured UW display names, regenerate older section batches, and allow an optional section on completed course records. |

## Verified scenarios

| Scenario | Observed result |
| --- | --- |
| Require QA 101 (10:00–10:50) and QA 103 (11:30–12:20) with a known 5-minute walk | DIG recommended the pair at 6 credits with 5 minutes of weekly walking. The saved plan reappeared after a reload under the selected semester’s Plans. |
| Require QA 101 and QA 102 (10:10–11:00) | DIG showed no recommendations and reported overlapping meetings. |
| Plan only QA 101, set the target and maximum to 6 credits, and enable same-subject suggestions | DIG found and added QA 103 from the catalog and labeled it as automatically added. |
| Require QA 102 and QA 103 with no walking edge between their buildings | DIG showed Needs review and flagged walking time as unverified. |
| Update the saved DARS requirement from 3 to 0 credits and reload | The DARS view reopened with one saved row showing 0 credits remaining. |
| Reimport the Fall 2026 sample and attach a section to an existing completed record | All three imported sections had an instructor name. The selected section’s name appeared in Schedule after reload. |
| Save an A in current-term STAT 240 and a B in past-term COMP SCI 300 | Spring 2027 showed a projected 4.00. Fall 2026 and the cumulative GPA showed 3.00. Supabase received the past grade as final and the current grade as projected. |
| Create a Tip, switch between Question and Tip, upvote it, and add a comment and a nested reply | The flair filter remained selected after reload. Reopening the thread showed the post, vote, comment, and nested reply. |
