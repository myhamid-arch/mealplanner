// F1 — reference household (owner-like, pseudonymous), 11-build-plan §2 (BLD-2).
// Weekdays: 0 = Monday … 6 = Sunday.
import type { FixtureInput } from "../../src/types/index.js";

const MON_FRI = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const F1: FixtureInput = {
  id: "F1",
  household: { name: "Household F1", regionNote: "Abu Dhabi" },
  users: [
    {
      key: "adult_a",
      email: "adult.a@f1.example",
      name: "Adult A",
      role: "admin",
      member: "adult_a",
    },
    {
      key: "adult_b",
      email: "adult.b@f1.example",
      name: "Adult B",
      role: "member",
      member: "adult_b",
    },
    { key: "c1", email: "c1@f1.example", name: "Child C1", role: "member", member: "c1" },
    { key: "kitchen", email: "kitchen@f1.example", name: "Kitchen", role: "kitchen" },
  ],
  members: [
    {
      key: "adult_a",
      displayName: "Adult A",
      color: "sea",
      birthYear: 1986,
      appetite: "large",
      targets: {
        default: {
          kcal: 2150,
          proteinG: 180,
          carbsG: 200,
          fatG: 70,
          satFatMaxG: 22,
          solubleFibreMinG: 10,
        },
        training: {
          kcal: 2390,
          proteinG: 180,
          carbsG: 260,
          fatG: 70,
          satFatMaxG: 22,
          solubleFibreMinG: 10,
        },
      },
      tolerance: { proteinG: 5, carbsG: 5, fatG: 2, kcal: 50, mode: "strict" },
      training: [
        { weekday: 0, sessionTime: "18:00:00" },
        { weekday: 2, sessionTime: "18:00:00" },
        { weekday: 4, sessionTime: "18:00:00" },
      ],
    },
    {
      key: "adult_b",
      displayName: "Adult B",
      color: "saffron",
      birthYear: 1989,
      appetite: "medium",
      targets: { default: { kcal: 1655, proteinG: 130, carbsG: 160, fatG: 55, satFatMaxG: 18 } },
      tolerance: { proteinG: 5, carbsG: 5, fatG: 2, kcal: 50, mode: "strict" },
      training: [
        { weekday: 1, sessionTime: "07:00:00" },
        { weekday: 3, sessionTime: "07:00:00" },
        { weekday: 5, sessionTime: "07:00:00" },
      ],
    },
    {
      key: "c1",
      displayName: "Child C1",
      color: "basil",
      birthYear: 2008,
      sex: "female",
      appetite: "large",
    },
    {
      key: "c2",
      displayName: "Child C2",
      color: "aubergine",
      birthYear: 2011,
      sex: "male",
      appetite: "large",
    },
    {
      key: "c3",
      displayName: "Child C3",
      color: "tomato",
      birthYear: 2016,
      sex: "male",
      appetite: "medium",
    },
  ],
  slots: {
    active: [
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "packed_school_lunch",
      "packed_work_lunch",
      "pre_workout",
      "post_workout",
    ],
  },
  // Coarse default: an active non-training slot is attended every day unless a row says otherwise
  // (02 §2), so the packed slots name who does not attend as well as who does.
  schedules: [
    // Children: packed school lunch Mon–Fri, replacing lunch (PLN-3).
    ...["c1", "c2", "c3"].flatMap((member) => [
      { member, slot: "packed_school_lunch", weekdays: MON_FRI, attends: true },
      { member, slot: "packed_school_lunch", weekdays: WEEKEND, attends: false },
      { member, slot: "lunch", weekdays: MON_FRI, attends: false },
      { member, slot: "packed_work_lunch", weekdays: ALL_DAYS, attends: false },
    ]),
    // Adult A: packed work lunch Mon–Fri, replacing lunch.
    { member: "adult_a", slot: "packed_work_lunch", weekdays: MON_FRI, attends: true },
    { member: "adult_a", slot: "packed_work_lunch", weekdays: WEEKEND, attends: false },
    { member: "adult_a", slot: "lunch", weekdays: MON_FRI, attends: false },
    { member: "adult_a", slot: "packed_school_lunch", weekdays: ALL_DAYS, attends: false },
    // Adult B: neither packed lunch.
    { member: "adult_b", slot: "packed_work_lunch", weekdays: ALL_DAYS, attends: false },
    { member: "adult_b", slot: "packed_school_lunch", weekdays: ALL_DAYS, attends: false },
  ],
  cuisines: { liked: ["italian", "levantine", "american", "british", "indian"], disliked: [] },
  exclusions: [{ member: "c3", kind: "dietary_flag", key: "contains_sesame", reason: "allergy" }],
};
