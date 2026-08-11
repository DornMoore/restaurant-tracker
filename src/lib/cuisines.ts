// Curated list for the cuisine/category dropdown when editing a
// restaurant — see PRD.md follow-up ("pull from a list of category
// types"). Deliberately short enough to scan, not an exhaustive taxonomy.
// Mapbox's auto-filled category (see categoryLabel in mapbox/searchBox.ts)
// often won't match one of these exactly — the edit form handles that by
// falling back to "Other" with the existing value preserved as free text,
// rather than silently discarding it.
export const CUISINE_OPTIONS = [
  'American',
  'Italian',
  'Mexican',
  'Chinese',
  'Japanese',
  'Thai',
  'Indian',
  'Mediterranean',
  'French',
  'Greek',
  'Vietnamese',
  'Korean',
  'Pizza',
  'Seafood',
  'Steakhouse',
  'BBQ',
  'Bakery / Dessert',
  'Cafe / Coffee',
  'Bar / Pub',
  'Breakfast / Brunch',
  'Fast Food',
  'Vegetarian / Vegan',
]
