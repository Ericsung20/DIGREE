/** L&S breadth designations shown by the UW–Madison Guide. */
export const BREADTH_OPTIONS = [
  {code: 'H', label: 'Humanities'},
  {code: 'L', label: 'Literature'},
  {code: 'S', label: 'Social Science'},
  {code: 'N', label: 'Natural Science'},
  {code: 'B', label: 'Biological Science'},
  {code: 'P', label: 'Physical Science'},
] as const;

export type BreadthCode = (typeof BREADTH_OPTIONS)[number]['code'];
