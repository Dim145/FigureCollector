# Collectors (social)

FigureCollector has a light social layer — **follow other collectors**, browse a
public profile, and compare collections. It is entirely **opt-in**: your profile
is private until you turn it on.

## Public profile

Turn on **Profil public** in your settings to get a shareable `/u/<username>`
page showing your collection, your piece / series / manufacturer counts, and your
follower / following counts. Two sub-toggles decide what visitors see:

| Setting | Default | Controls |
|---|---|---|
| Public profile | off | Whether `/u/<username>` exists at all (404 when off). |
| Show NSFW | off | Whether NSFW figures count in your public collection + stats. |
| Show value | off | Whether your [collection value](cote.md) is shown publicly. |

NSFW and value never leak without the explicit toggle — the filtering happens
server-side, not just in the UI.

## Following

Follow any collector by handle. A follow is a one-way edge; when it's mutual the
profile shows a *vous suit* badge. The follower / following counts open a list
modal you can browse and follow from.

## Discover

`/collectionneurs` lists public collectors ranked by collection size, with a
search box. Each card shows a **shelf peek** (a few recent pieces), the counts,
the opt-in value, and a follow button.

## Compare

From a public profile, **Comparer** (`/compare/<username>`) diffs your collection
against theirs into three buckets — *yours only*, *in common*, *theirs only*.
