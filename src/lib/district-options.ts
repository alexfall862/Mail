/**
 * District field suggestions per office. These drive a datalist (suggestions
 * the vendor can always override by typing) and an auto-prefill for the
 * statewide races.
 */
import type { Office } from "./schemas/project";

export const KANSAS_COUNTIES = [
  "Allen", "Anderson", "Atchison", "Barber", "Barton", "Bourbon", "Brown",
  "Butler", "Chase", "Chautauqua", "Cherokee", "Cheyenne", "Clark", "Clay",
  "Cloud", "Coffey", "Comanche", "Cowley", "Crawford", "Decatur", "Dickinson",
  "Doniphan", "Douglas", "Edwards", "Elk", "Ellis", "Ellsworth", "Finney",
  "Ford", "Franklin", "Geary", "Gove", "Graham", "Grant", "Gray", "Greeley",
  "Greenwood", "Hamilton", "Harper", "Harvey", "Haskell", "Hodgeman",
  "Jackson", "Jefferson", "Jewell", "Johnson", "Kearny", "Kingman", "Kiowa",
  "Labette", "Lane", "Leavenworth", "Lincoln", "Linn", "Logan", "Lyon",
  "Marion", "Marshall", "McPherson", "Meade", "Miami", "Mitchell",
  "Montgomery", "Morris", "Morton", "Nemaha", "Neosho", "Ness", "Norton",
  "Osage", "Osborne", "Ottawa", "Pawnee", "Phillips", "Pottawatomie", "Pratt",
  "Rawlins", "Reno", "Republic", "Rice", "Riley", "Rooks", "Rush", "Russell",
  "Saline", "Scott", "Sedgwick", "Seward", "Shawnee", "Sheridan", "Sherman",
  "Smith", "Stafford", "Stanton", "Stevens", "Sumner", "Thomas", "Trego",
  "Wabaunsee", "Wallace", "Washington", "Wichita", "Wilson", "Woodson",
  "Wyandotte",
] as const;

const STATEWIDE_OFFICES: readonly Office[] = [
  "us_senate",
  "governor",
  "secretary_of_state",
  "attorney_general",
  "state_treasurer",
  "insurance_commissioner",
];

function range(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

export type DistrictOptions = {
  /** Value to auto-fill when the office is selected (still editable). */
  prefill: string | null;
  /** Datalist suggestions; empty means plain free text. */
  options: string[];
};

export function districtOptionsFor(office: Office | ""): DistrictOptions {
  if (office === "") return { prefill: null, options: [] };
  if (STATEWIDE_OFFICES.includes(office)) {
    return { prefill: "Statewide", options: ["Statewide"] };
  }
  switch (office) {
    case "state_board_of_education":
      return { prefill: null, options: range(10) };
    case "state_senate":
      return { prefill: null, options: range(40) };
    case "state_house":
      return { prefill: null, options: range(125) };
    case "county_party":
      return { prefill: null, options: [...KANSAS_COUNTIES] };
    default: // municipal_county_office, other
      return { prefill: null, options: [] };
  }
}
