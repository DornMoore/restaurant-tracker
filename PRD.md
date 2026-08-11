# Restaurant Tracker — PRD (Draft v1)

## What this is

This is a personal restaurant log for Dorn and Sara. Not a public review app, not something we're putting in the App Store. The point is to stop losing track of two things: places we've heard about and want to try, and places we've actually been, with our own honest notes on what we ate, whether we liked it, and whether either of us felt bad afterward. Right now that list lives in our heads and an informal note somewhere, and it leaks. This fixes that.

Scope is our community — Lake Delton / Baraboo / Fitchburg area, basically wherever we actually eat regularly. If we happen to use it on a trip and come back to that city again someday, fine, but we're not building for travel use.

## Who uses it

Two people: Dorn and Sara. Both should be able to add and edit entries. We're not worried about conflict resolution being fancy here — if we both edit the same place at the same time, worst case one of us re-types a note. Not building for anyone else.

## Core entities

Two main things, and it's worth keeping them separate rather than jamming everything into one record:

**Restaurant** — the place itself. Name, location (captured via GPS when we add it, or searched/entered manually), cuisine type, price tier ($ / $$ / $$$), status (want to try / been there), and a running set of tags that apply to the place generally rather than to one visit.

**Visit** — a specific time we ate there. Tied to a restaurant. Date, what we ordered, star rating for that visit, notes, and a "wouldn't go back" flag — a general do-not-repeat signal rather than something specifically about feeling sick. If the reason is that we felt unwell, that goes in the notes as free text rather than its own structured field; we're not expecting to use this often, so it doesn't need its own taxonomy. A restaurant can rack up multiple visits over time, which is really the "blog" part of this — a running record of that place, not just a single verdict.

Rating is a 1–5 star scale per visit for the general "would we go back" read, plus freeform tags (great patio, slow service, good for groups, etc.) so we're not stuck fitting everything into a rigid category. Cost is a rough $/$$/$$$ tier on the restaurant, not itemized totals or per-person math — we don't need the accounting, just a sense of what we're walking into.

## Key flows

Adding a place we want to try: quick entry — just the name, status set to want-to-try, no visit yet. We're not bothering with a "how did we hear about it" field; if that context matters we can always drop it in as a freeform tag, but it's not part of the quick-add flow.

Logging a visit: pick a restaurant (existing or new), add date, what we ate, star rating, notes, wouldn't-go-back flag if it applies. If it's a new restaurant we're logging on the spot, this should also create the restaurant record in the same flow rather than making us do two separate steps.

Browsing: two obvious views — a want-to-try list and a been-there list. Sorting matters more than filtering here — the main thing is being able to sort the been-there list by highest rated, so we can scan down and go "oh right, that place" and jog our memory on how we actually felt about it last time, or get a quick "yeah, skip that one" signal. Distance from current location should also be available as a sort option. A cuisine filter is worth having but low priority — realistically we'll remember the kind of food a place serves without needing to filter for it; it's more of a "nice to have it in there" than something we'll lean on.

Location: this needs to be the phone's actual GPS, not a coarse IP-based location — the whole point of "restaurants near me" is knowing what's actually nearby right now, and IP-based location can be miles off or tied to a home address instead of wherever we're standing. Used both for the proximity sort/filter on the want-to-try list and to auto-fill location when adding a new place. No in-app routing — tapping a restaurant should hand off to Apple Maps or Google Maps for directions or hours, not try to reproduce that ourselves.

## Platform and architecture

This is the part where your constraints actually push the decision pretty clearly. No Mac, Windows desktop machine, want real typing/note-editing at a desk, want it on the phone too, and want it to work with zero signal — standing in a restaurant or a parking garage with no bars, still need to save a note.

A true native iOS app is off the table as the *only* front end, because it flatly won't run on Windows. Something CloudKit-based has the same problem in spirit — CloudKit JS exists and would technically work in a Windows browser, but it's an awkward, Apple-centric way to solve what is fundamentally a "I want one app, two screens" problem.

So: build this as a web app. One codebase, runs on your phone (saved to the home screen, feels close enough to native for what this needs to do) and runs in a browser on the Windows machine for the sit-down-and-type sessions. No App Store, no $99/year account, no sideloading headaches.

The offline requirement is the one piece that takes real thought, because a plain web app talking straight to a cloud database breaks the moment you lose signal. The fix is building this "local-first" — the app writes to storage on your device first (so it works with zero signal, no exceptions), and syncs up to a shared backend whenever a connection is available. Practically that means picking a stack built for this from day one rather than bolting it on later — something like a local database in the browser/phone (IndexedDB) paired with a lightweight backend (Supabase is the leading candidate — free at this scale, straightforward to set up) and a sync layer that reconciles the two. This is the one area I'd want to prototype early rather than assume, since "works offline and syncs cleanly later" is where a lot of apps like this get janky.

## Visual direction

Modern, clean feel — card-based layout for restaurants rather than a plain list, something in the neighborhood of what Yelp does without trying to be a clone of it. Each restaurant shows up as a card with the basics visible at a glance (name, price tier, star rating, maybe a tag or two), and tapping in gets you the full visit history and notes. Filtering and sorting controls should feel light and out of the way — this isn't a data entry tool, it should feel more like flipping through a well-organized personal guide than filling out a form. Given this is a two-person app with no public-facing polish requirement, we've got room to keep it simple rather than over-designing it, but it shouldn't feel like a spreadsheet with buttons either.

## What's in v1

- Add/edit restaurant (name, location via GPS or manual entry, cuisine, price tier, status)
- Add visit (date, items ordered, star rating, notes, wouldn't-go-back flag) — a restaurant can have any number of visit entries over time, so going back a year later and logging a fresh take (new dish, new server, place has changed) is a new entry, not an edit to the old one
- Want-to-try list and been-there list, sortable by rating and by distance, filterable by cuisine
- Tags, freeform, applied at either the restaurant or visit level
- Offline entry with background sync
- Real device GPS for location and proximity, not IP-based location
- Shared between two accounts (you and Sara), no fancy permissions needed

## What's explicitly out of v1

- Photos — you said not critical, worth revisiting later once the core workflow is solid
- Travel mode / multi-region organization beyond just tagging a city if it comes up
- Any social or sharing features — this stays private between the two of you
- Routing or map display beyond a simple hand-off to Maps
- Desktop native app (Mac or Windows) — the web app covers this

## Decisions locked for v1

- No existing informal list to import — starting from scratch, so there's no import path to build.
- The "wouldn't go back" flag is a general do-not-repeat signal, not sickness-specific. If we felt unwell, that's a note, not a structured field.
- Want-to-try entries capture name only — no "how did we hear about it" field in the quick-add flow.
