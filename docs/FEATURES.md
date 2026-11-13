# Features

Current behavior of the app. Update this file whenever a feature is added, changed or removed.

## Look and feel
- Cozy "Peach Jam" theme: blush background, outlined cards with a flat shadow, rounded Fredoka headings. Tabs are in a floating dark bar at the bottom; the current tab shows its name. The Log tab shows a count badge when prepped or cooked recipes need a rating, and the Fridge tab one when leftovers are going bad (3 days or older).
- Theme picker in the Household panel: Peach Jam (default), Mint Garden, Blueberry, Lemon or Lilac. Each changes the page background, outlines, text and accent color instantly. The choice is per device, not per account or household. Shopping-section and rating pastels look the same in every theme.

## Install as an app
- Installable as a standalone app (Chrome on Android: menu > Install app). Opens full-screen with its own icon. Requires being online; there is no offline mode.

## Login
- Email and password sign-in (Supabase Auth).
- "New here? Create an account" on the sign-in card switches it to sign-up (password at least 8 characters). Supabase emails a confirmation link that returns to the app signed in; the card says "Check your email" meanwhile. While sign-ups are off in Supabase, it says new accounts aren't open yet.
- After signing in, an account with no household sees "Set up your household": join one with an invite code, or create one by name.
- **Approval:** only approved accounts can create a household. Accounts that existed before approval was added are approved; new ones are not until the owner ticks `approved` for them in Supabase (Table Editor > `profiles`). An unapproved account sees a note saying so with "Check again", and can still join a household with a code at once: a member's invite code counts as approval.

## Households
- Each login belongs to exactly one household. Everyone in a household shares its library, weekly plans, shopping list, pantry and history; other households can't see any of it.
- The household name sits next to the week label. Tapping it opens the Household panel: rename, see members (by email, yours marked "(you)", the creator marked "created it"), "Remove" another member (creator only), "Invite someone", the two sharing switches, the theme picker, "Sign out" and "Leave household".
- Only the household's creator sees "Remove". It asks "Yes, remove" first. The removed person loses access straight away and lands on "Set up your household" next time they open the app; everything they added stays with the household. To remove yourself, use "Leave household".
- "Invite someone" makes an 8-character code that works for 7 days and can be used by more than one person. They sign in, choose "Join household" and type it in (any case).
- "Leave household" asks to confirm. The last member to leave deletes the household and all its data; the panel says so first. After leaving, the account is back at "Set up your household".
- Any member can rename, invite, change sharing or leave. Only the creator can remove members. If the creator leaves, the longest-standing remaining member becomes the creator. "Our household" (made by the households migration) has its earliest account as creator.
- **Share our library** (per household, off by default): lets other households see our recipes, including cook times and the full recipe, and copy them. Ratings, when we last made a recipe, plans, lists and history stay private.
- **Show other households' libraries** (per person, off by default): adds Ours / Other households pills to the Library tab (see Library tab).

## Recipes: dinners and snacks
- Every recipe lives in the Library. A recipe tagged **Weekday dinner** is a dinner; every other recipe is a snack.
- Dinners are never offered as snack suggestions. Snacks are never offered when planning dinners.

## Week tab
"This week" / "Next week" pills at the top choose which week you're planning, so next week can be planned and shopped for over the weekend. Below them, a Dinners / Snacks toggle. The header badge shows "N of 7 planned" on Dinners and "N snacks chosen" on Snacks. A "See the shopping list" button appears once anything is chosen. The date line in the header shows the week being planned.

### Next week
- Planned the same way as this week: dinner tiles, picker, "Fill empty days", "Clear next week", snack suggestions and the Chosen filter. Its suggestions and picks are kept separately from this week's.
- Planning only: there's no Tonight card, no round "cooked" checks on tiles, and no "Start Cooking" on snack cards. Cooking and rating start once it becomes this week.
- On Monday, next week's plan (including its shopping list ticks and hand-added items) becomes this week and a fresh, empty next week starts. Last week is archived to History as before.
- The Library's add buttons follow the same choice (see Library tab).

### Dinners
- One slot per day, Monday to Sunday. A dinner planned on a day is also chosen for the week, so it feeds the shopping list and the Log.
- **Tonight** card (shown every day) highlights today's dinner with "Swap dinner" and "Start Cooking" (see Cooking below; it reads "Cooked" once done, and tapping that unmarks it). If nothing is planned for today it offers "Pick a dinner".
- The other days are tiles. Tap a tile's title to pick or swap its dinner, or tap an empty tile ("Add a dinner"). The round check marks that dinner cooked; a logged rating shows on the tile.
- The picker lists the library's dinners. Dinners already on another day are listed last with that day's name. "Clear <day>" empties the slot.
- "Fill empty days from my library" fills every empty day using the same cooldown and variety rules as snack suggestions (below). It may fill fewer days if too few dinners qualify, and says so.
- "Clear week" (below the tiles, shown when at least one dinner is planned) empties all seven days after a confirm step. Cleared dinners also leave the shopping list and the Log; ratings already logged stay in History and on the recipes. Snacks chosen for the week are not touched.
- With no dinners in the library, the tab points to the Library to add one and tag it Weekday dinner.
- Dinners are planned from the library only; there are no AI-generated dinner ideas yet.

### Snacks
- "Suggest snacks" builds six suggestions: half from the library, half generated by Claude. "More ideas" appends three; "New set" replaces the list.
- "Library only" toggle skips the AI and picks only from saved snacks.
- Filters: "Chosen (N)" sits at the right of the This week / Next week row (Snacks only) and shows only the snacks chosen for that week, including any a later "New set" dropped from the suggestions (it hides "More ideas" while on); the tier filters Grab and go, 2-3 min and Weekend batch sit on one line below "Library only" and combine with it. Filter rows never scroll sideways; on a screen too narrow for a row, its pills wrap.
- Cards expand to show steps and ingredients. Selecting a card adds it to the week; a selected card shows "Start Cooking" (see Cooking below), which becomes "Prepped" once finished (tap it to unmark). Selected AI ideas are saved to the library automatically.

### Suggestion rules (`pickFromLibrary`)
- Cooldown: a recipe is skipped for 3 weeks after it was made, or 1 week if its average rating is 2.6+ (loved).
- Previously refused recipes resurface after 3 weeks with a "Worth another try" note.
- Untried recipes get a score boost; longer gaps raise the odds.
- Vegetables are spread out so one vegetable isn't suggested twice in a set when avoidable.

### Cooking
- "Start Cooking" (Tonight card and selected snack cards) or "Cook Now" (any Library card) opens a full-screen cooking view: a running timer, the ingredients at the top, then the full method as numbered steps. Recipe cards only show a short summary; this view shows the whole recipe.
- The only ways out are **Finished** and **Cook Later**. Finished marks the recipe cooked (prepped, for snacks) and records the time since Start Cooking as one cook time. Cook Later closes the view and forgets the start time, so only uninterrupted start-to-finish sessions are timed.
- Once a recipe has cook times, the time shown for it everywhere (Tonight card, dinner tiles, snack cards, dinner picker, Library) is the average of all its cook times, rounded to whole minutes (minimum 1). Until then it shows the estimate entered or imported. The Edit form says when the average is in use; its "Time to prepare" field stays as the estimate.
- The session is remembered on the device that started it, so reloading the page mid-cook returns to the cooking view with the timer still running. A session older than 12 hours is dropped as abandoned. Other devices don't see it.
- Recipes imported by URL or photo keep the complete method. For older imports, or recipes with only a short description, the cooking view shows the short text and, when the recipe has a link, a "Load the full recipe" button that has Claude read the page and saves the result. The full recipe can also be typed or edited in the Library Edit form ("Full recipe", one step per line).
- "Cook Now" on a Library card cooks a recipe that isn't in the week's plan. It works the same way: Finished records the cook time and marks it cooked/prepped this week, so it shows up in the Log to rate (and in History). It isn't added to a day, the Snacks view or the shopping list. Unmarking it in the Log removes it from the Log again.
- The round check on the other days' dinner tiles and the Log tab still mark a recipe cooked without timing it.
- **When it counts as cooked** (for the Fridge): Finished is the moment you tap it. A round check on a dinner planned on a day dates it 6pm that day (or now, if that's earlier), so a dinner cooked on another day should be moved to that day on the Week tab; moving a ticked dinner later re-dates it. A round check on anything else (snacks, Cook Now recipes) is the moment it's ticked.

## Fridge tab
- Shows the leftovers in the fridge, oldest first. Each card shows the recipe, Dinner or Snack, the day it was made and how old it is ("21 h old", "2 days old").
- After 2 days (48 hours) a card turns yellow with "Eat soon"; after 3 days (72 hours) it turns red with "Going bad". Ages refresh every few minutes and when the app comes back to the foreground.
- "Eaten" and "Tossed" take a leftover out of the fridge. The app keeps a record of which it was (the latest 200) for food-waste stats later; nothing shows it yet.
- Dinners and Weekend batch snacks go into the fridge when they're marked cooked or prepped. Other snacks don't, unless "Leftovers in the fridge" is ticked in the Log.
- Unmarking a recipe as cooked, or taking it out of the week, takes its leftovers out of the fridge too. Leftovers stay when the week rolls over on Monday.
- The fridge is shared by everyone in the household. It only tracks cooked recipes; groceries aren't tracked.

## List tab
- One combined list built from the chosen recipes (dinners and snacks) of the weeks shown. Duplicate ingredients (same name and unit) are summed across recipes and weeks, and rows used by several recipes say "for N recipes". A recipe chosen in both weeks counts twice. A line under the filters shows the recipe count.
- Filter pills at the top: "This week" and "Next week" choose which weeks feed the list (at least one stays on), and "Hide bought" hides checked-off items (the summary line then says how many are hidden). These choices are remembered on the device. If the weeks shown have nothing chosen, the list says so and offers "Plan it".
- Grouped by produce, dairy, pantry, frozen, other.
- Sections for hand-typed ingredients (Add by hand, or new lines in Edit): saved first with a keyword guess, then Claude sorts any names it hasn't seen and the app remembers the answer, so each name is asked about once. If Claude can't be reached the keyword guess stays. Recipes from AI ideas, a link or a photo get their sections from Claude when they're created.
- Check items off, mark "have it" (remembered in the pantry list), and add manual items. Behind the scenes each week keeps its own ticks, "have it" marks and manual items, so they roll over with the week: ticking a combined row ticks it in every shown week that needs it, and a row shows as ticked only when all of those weeks have it ticked. Hiding a week keeps its ticks. "Add something else" adds to the earliest week shown (this week when both are on).
- "Copy" (next to the Shopping list title) copies what's still to buy on the combined list as text.

## Log tab
- Lists the week's chosen recipes plus anything cooked off-plan with "Cook Now". Prepped snacks and cooked dinners can be rated Loved it, Ate some, or Refused. Ratings drive future suggestions. Dinner cards show their day ("Tue dinner") and say "cooked" instead of "prepped".
- Cooked or prepped cards have a "Leftovers in the fridge" box under the rating buttons. It starts ticked for dinners and Weekend batch snacks and unticked for other snacks; ticking or unticking it puts the leftovers in or takes them out of the Fridge tab. Once they've been eaten or tossed, the card says so, with "Put back" to undo a mistaken tap.

## Library tab
- 14 seeded snacks (no seeded dinners). Search by title, vegetable or ingredient. Filter pills: All, Weekday dinner, Snacks. Delete recipes.
- Tap a recipe to expand it: shows the description (steps), ingredients and recipe link.
- "Edit" (shown when a recipe is expanded) changes its name, recipe link, snack timing, description, full recipe, time to prepare in minutes, and ingredients (one per line, e.g. "2 tbsp olive oil"; unchanged lines keep their shopping-list section, new ones are sorted by Claude, see List tab). Changes show on the Week tab and shopping list too; past weeks in History keep the name the recipe had then.
- Add from a photo: "From a photo" on the Add a recipe sheet takes up to 4 photos (camera or gallery) of a cookbook page, recipe card or handwritten note. Photos are shrunk on the phone, then Claude transcribes the recipe with its quantities. The same "Weekday dinner" pill applies.
- Add by URL: Claude reads the page and extracts ingredients and quantities. A "Weekday dinner" pill on that sheet tags the import as a dinner and starts it without a snack timing.
- Add by hand: name, optional recipe link (a link typed on the first screen carries over; a bare "example.com/x" gets https:// added), main vegetable, optional "Weekday dinner" tag, snack timing, description (how to make it) and one ingredient per line.
- Snack timing (Grab and go, 2-3 min, Weekend batch) is required for snacks and optional for dinners: turning the Weekday dinner tag on clears it, and for a dinner tapping the selected timing again clears it (also in Edit). A dinner with no timing simply shows no timing label.
- Add, edit and picker popups open centered on the screen, scroll inside themselves when taller than the screen, and close with the X or the Escape key.
- "Weekday dinner" tag: toggle it on any recipe from the library list. The toggle shows only when the card is expanded (like Edit); collapsed cards still show "Add to a day" on dinners.
- "Cook Now" on every recipe opens the cooking screen straight away, without planning it (see Cooking).
- The add buttons target the week chosen on the Week tab. With "Next week" chosen, the Library says so at the top, buttons read "Add to next week" / "In next week", and the day picker asks "Which day next week?". "Cook Now" always cooks today, whichever week is chosen.
- "Add to this week" on a snack selects it for the current week (it appears on the Snacks view and feeds the shopping list). On a dinner the button reads "Add to a day" and asks which day. Tap "In this week" to take either back out (a dinner also leaves its day). A new set of snack suggestions replaces the Snacks cards but a pinned snack stays selected and on the list and log.

### Other households
- Shown when "Show other households' libraries" is on. "Other households" lists the libraries of every household sharing theirs, grouped by household name and read fresh each time the view opens, so edits they make show up. Search and the All / Weekday dinner / Snacks pills apply.
- Cards show the vegetable, Weekday dinner tag, snack timing and their cook time (their average of timed sessions, or their estimate). Expanded, they show the description, ingredients, full recipe steps and link.
- "Copy to our library" saves our own copy; the button then reads "In our library". A copy never changes when theirs does. It starts with no ratings and no timed sessions of its own; their cook time becomes its estimate until we time it ourselves.

## History tab
- Exposure meter per vegetable, out to 10 tries, with a "warming up" flag when recent ratings improve.
- Past weeks with each verdict. Weeks roll over automatically on Monday: next week's plan (if any) becomes the current week, otherwise it starts empty.

## AI limits
- AI features only work for accounts in a household.
- Recipe imports are capped at 10 per person in any 24 hours (not per calendar day). Imports are anything that has Claude read a web page or photos: "Pull it in" from a link, "From a photo", and "Load the full recipe" in the cooking view. Each attempt counts, even one that fails to find a recipe. Over the cap, the Add sheet or cooking view says so and suggests adding by hand.
- Snack ideas from Claude ("Suggest snacks", "More ideas", "New set" with Library only off) are capped at 5 requests per person in any 24 hours. Over the cap, the error says so; the library picks still appear and "Library only" keeps working.
- Sorting typed ingredients into shopping-list sections is not capped.

## Known limits
- One household per login; a login can't belong to two.
- Each household's data is a few shared rows, so simultaneous edits from two members' devices are last-write-wins.
- No approval queue in the app: approving an account is done by hand in the Supabase Table Editor.
- Dinners are one per day, Monday to Sunday. The "Weekday dinner" tag keeps its name even though dinners can now be planned for the weekend.
- No automated tests.
