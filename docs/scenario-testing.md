# Local scenario testing

Chromium used the Next.js app with local Supabase Auth and Postgres, and the Python Optimizer over HTTP. Scheduling used three synthetic 3-credit Monday sections. The instructor check used the public UW Fall 2026 sections for COMP SCI 300.

## Design reference

Use the attached `DIGREE.html` board export for screen order, actions, and display states. Its 26 boards include the logo and four variations of Recommendations. Mobile boards are 390 × 844. The course codes, people, counts, grades, and DARS differences in the prototype are examples. Exercise equivalent states with local records and use the selected user, term, course, and section to verify where each displayed value comes from.

| Reference boards | App data and navigation | Remaining differences |
| --- | --- | --- |
| Logo, Log In / Sign Up, Academic Profile Setup, Course History Setup | Brand and main navigation use the shared app frame. Supabase Auth signs the user in. Onboarding persists the college/program/catalog selection and course records before opening Schedule. | The design includes name and UW email at signup, password recovery, and separate Taking now and Taken views. The app has email/password auth and a shared course-history form. |
| My Schedule, Add / Edit Course, Course Detail | Schedule selects a term and switches between owner course records and the saved DIG plan. Course search reads catalog courses, then resolves section, meetings, building name and instructor for the selected term. The detail can open Community for that course. | The design opens a timetable summary before Details and includes a section placement/conflict preview, related post cards and Class chat on the detail. The app opens Details directly from a timetable block and links to the filtered Community feed. |
| Generate Setup, Recommendations and its four variants, Schedule Preview | Setup reads the selected term's planned courses. Generate loads course bundles, meetings, walking edges and any related catalog candidates before calling the Optimizer. Preview uses the chosen result. Save Plan writes the plan and items, shows Planted in Plans on the preview, then View in Schedule opens that term's Plans. | The reference uses one credit target, combinable preferences including a lunch break, swipeable timetable cards and one-click constraint changes after an empty result. The app has a credit range, one preference at a time, stacked summaries and Change filters. The design shows the longest single walk. The app shows the known weekly walking total. |
| Friends, Friend’s Schedule, Sharing Settings | Accepted friends and sharing permissions determine access. Friend Schedule reads current-term saved plans or free/busy time according to visibility. | The design overlays the viewer's calendar with Compare with mine. The app displays the shared view by itself. |
| GPA Dashboard, Edit Grades | The browser reads owner course records and grade entries. Current courses show a projection. Completed grades feed the cumulative GPA. | The design has an explicit Projected/Final control and a Save grades action. The app derives status from the course record and saves each edit as it happens. |
| Community Feed, Post Detail, New Post | Community uses the alias-based post and comment views. Flair filtering is in the URL. Posts, votes and threaded replies are persisted. | The design shows vote and comment summaries in the feed, supports multiple course tags and asks for a report reason. The app shows vote totals in the thread, stores one course tag and sends a generic report reason. |
| Room List, Chat Room | Room eligibility uses current-term self-reported courses. Room messages are loaded for members and updated live. | The design includes a last-message preview, unread and online counts, and alias reroll. The app shows its participant count and assigned alias. |
| Edit Profile & Course History, Degree Requirements | Profile reads and saves the academic profile and course history. Degree Requirements derives a course-based estimate, previews a local PDF and reloads manually entered DARS rows for the selected program. | The design groups requirements and routes selected needs into DIG. Its PDF flow presents differences with Keep mine / Use DARS before Update my requirements. The app has a local PDF preview and per-row Save requirement. |

For each rerun, follow the board's button sequence and then reload the destination to confirm what persisted. Change terms when testing Schedule, DIG, and GPA. Check missing data using an absent row or relationship so that fixture values cannot mask the gap. For a server-error check, fail one browser request and confirm that Try again submits the same conditions to the live Optimizer.

## Reproduced bugs

| Reproduction | Expected | Before the fix | Fix |
| --- | --- | --- | --- |
| Open a DIG recommendation, then select Save Plan | The preview confirms Planted in Plans. View in Schedule leads to the saved plan's semester. | Save Plan immediately navigated to Schedule. | Keep the confirmation in the preview and link to the saved term's Plans. |
| Submit DIG conditions and simulate a server failure | Try again immediately resubmits the same conditions. | Try again reopened setup and required another submission. | Retry the original request. Cancel during loading returns to the same setup. |
| In Spring 2027 DIG, add COMP SCI 400 with no prior COMP SCI 300 credit or current earlier enrollment. Try it as required, as unchecked in planned courses, and as a catalog suggestion for more credits. | A required selection shows the missing prerequisite. Optional and catalog-suggested COMP SCI 400 are excluded. | The optimizer could include the course when its eligibility was sent as unknown, including when DIG added it automatically. | Check owner course history for the published COMP SCI 400 prerequisite on 2026–27 undergraduate plans. Same-term selections and failed attempts do not satisfy it. |
| Open Profile → Degree requirements → From DARS PDF, save a requirement with 3 credits remaining, and reload | The saved requirement is visible in the DARS view after reload | Reload switched to From my courses. The saved row appeared after manually reopening DARS. | Store the selected view in the URL. |
| Import Fall 2026 COMP SCI 300 sections, add the course as Completed, and open its detail from Schedule | A known section can be attached to the record so the detail shows its published instructor | The importer saved empty instructor lists for all three sections because it expected string names. The course form and section editor also gave completed records no way to select a section. | Read structured UW display names, regenerate older section batches, and allow an optional section on completed course records. |

## Verified scenarios

| Scenario | Observed result |
| --- | --- |
| Require QA 101 (10:00–10:50) and QA 103 (11:30–12:20) with a known 5-minute walk | DIG recommended the pair at 6 credits with 5 minutes of weekly walking. The saved plan reappeared after a reload under the selected semester’s Plans. |
| Require QA 101 and QA 102 (10:10–11:00) | DIG showed no recommendations and reported overlapping meetings. |
| Plan only QA 101, set the target and maximum to 6 credits, and enable same-subject suggestions | DIG found and added QA 103 from the catalog. Its preview displayed a dashed block and the building's catalog name. |
| Require QA 102 and QA 103 with no walking edge between their buildings | DIG showed Needs review and flagged walking time as unverified. |
| Simulate a 503, retry, then cancel a separate pending request | Retry sent the same input to the live Optimizer and returned recommendations. Cancel returned to setup with the draft intact. |
| Update the saved DARS requirement from 3 to 0 credits and reload | The DARS view reopened with one saved row showing 0 credits remaining. |
| Reimport the Fall 2026 sample and attach a section to an existing completed record | All three imported sections had an instructor name. The selected section’s name appeared in Schedule after reload. |
| Save an A in current-term STAT 240 and a B in past-term COMP SCI 300 | Spring 2027 showed a projected 4.00. Fall 2026 and the cumulative GPA showed 3.00. Supabase received the past grade as final and the current grade as projected. |
| Create a Tip, switch between Question and Tip, upvote it, and add a comment and a nested reply | The flair filter remained selected after reload. Reopening the thread showed the post, vote, comment, and nested reply. |
