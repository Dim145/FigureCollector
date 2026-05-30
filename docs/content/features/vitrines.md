# Vitrines (display cabinets)

`/vitrines` arranges your collection into **glass display cabinets** — one per
`location`. It's the spatial view of the same `owned_items` the
[collection](catalogue.md) lists; a piece's cabinet is simply its `location`
field.

## Cabinets

- **Named cabinets** you create ("Detolf salon", "Bureau", …) live in a small
  registry and keep a stable order.
- Any **pre-existing location** you typed on an item without formally creating it
  still shows up as a cabinet (matched case-insensitively), so nothing is lost.
- Pieces with no location collect in a dashed **« Non rangées »** (unshelved)
  group at the bottom.

Each cabinet header shows its piece count and an aggregate **value** (dominant
currency — the same effective value as [La Cote](cote.md)).

## Drag & drop

Pieces are draggable — mouse, touch (long-press) or keyboard:

- **Reorder** within a cabinet.
- **Move** a piece to another cabinet — it drops in and its location updates.
- Drag into « Non rangées » to un-shelve a piece.

A whole re-shuffle is persisted in a single request (`PUT /me/owned/arrange`),
which re-homes and re-orders every affected piece at once.

## « Où est… ? »

A search box highlights matching pieces in place (a jade ring) so you can locate
a figure across cabinets without scrolling.

## Managing cabinets

Create a cabinet from the header; rename or delete it from its menu. Deleting a
cabinet **un-shelves** its pieces (they fall back to « Non rangées ») — it never
deletes figures. Cabinet CRUD lives at `/me/locations`.
