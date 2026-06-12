/**
 * tdee.ts — Mifflin–St Jeor TDEE computation and goal suggestion.
 *
 * Pure module: no imports, no side effects, no database access.
 * All inputs are metric (kg, cm). All outputs are rounded to practical
 * precision. Guards against absurd inputs with clamping so the result
 * is always a positive, usable number.
 *
 * Issue #281 — Personalized nutrition goals + onboarding flow.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Sex = 'male' | 'female';

export type ActivityLevel =
  | 'sedentary'    // desk job, no exercise
  | 'light'        // light exercise 1–3 days/week
  | 'moderate'     // moderate exercise 3–5 days/week
  | 'active'       // hard exercise 6–7 days/week
  | 'very_active'; // physical job or twice-daily training

export type GoalType = 'cut' | 'maintain' | 'gain';

export interface UserProfile {
  sex: Sex;
  age: number;           // years
  heightCm: number;      // centimetres
  activityLevel: ActivityLevel;
  goalType: GoalType;
}

export interface SuggestedGoals {
  /** Recommended daily calorie intake in kcal, rounded to nearest 10. */
  calories: number;
  /** Recommended daily protein intake in grams, rounded to nearest 5. */
  protein: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Mifflin–St Jeor activity multipliers */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
};

/** Calorie delta applied to TDEE based on goal type (kcal/day). */
const GOAL_DELTAS: Record<GoalType, number> = {
  cut:      -500,
  maintain:    0,
  gain:      300,
};

/** Protein factor: 1.8 g per kg of body weight. */
const PROTEIN_G_PER_KG = 1.8;

// ─────────────────────────────────────────────────────────────────────────────
// Input clamping helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp a value to [min, max]. Returns min when value is NaN. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Round to the nearest multiple of `step`. */
function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core computation functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute Basal Metabolic Rate using the Mifflin–St Jeor equation.
 *
 * Men:   BMR = 10*kg + 6.25*cm − 5*age + 5
 * Women: BMR = 10*kg + 6.25*cm − 5*age − 161
 *
 * Inputs are clamped to sane physiological ranges before the calculation
 * so the result is always a positive finite number.
 *
 * @param sex       Biological sex used for the constant offset.
 * @param weightKg  Body weight in kilograms (clamped 30–300 kg).
 * @param heightCm  Height in centimetres (clamped 100–250 cm).
 * @param age       Age in years (clamped 10–120).
 * @returns BMR in kcal/day (always > 0).
 */
export function computeBMR(params: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
}): number {
  const { sex } = params;
  const weightKg = clamp(params.weightKg, 30, 300);
  const heightCm = clamp(params.heightCm, 100, 250);
  const age      = clamp(params.age, 10, 120);

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const offset = sex === 'male' ? 5 : -161;
  const bmr = base + offset;

  // Guard: should never happen with clamped values, but be defensive.
  return Math.max(1, bmr);
}

/**
 * Multiply BMR by the activity level multiplier to get Total Daily Energy
 * Expenditure (TDEE).
 *
 * @param bmr           Result of computeBMR().
 * @param activityLevel User's typical activity level.
 * @returns TDEE in kcal/day.
 */
export function computeTDEE(bmr: number, activityLevel: ActivityLevel): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.2;
  return Math.max(1, bmr * multiplier);
}

/**
 * Suggest daily calorie and protein goals from the user's profile and
 * current body weight.
 *
 * Calories = TDEE + goal delta (cut −500, maintain 0, gain +300),
 *            then rounded to nearest 10 kcal.
 *            Minimum enforced: 1000 kcal (never returns a dangerously low value).
 *
 * Protein  = 1.8 g/kg × weightKg, rounded to nearest 5 g.
 *            Minimum enforced: 50 g.
 *
 * @param profile  User profile (sex, age, height, activity, goal).
 * @param weightKg Current body weight in kg (used for both BMR and protein).
 * @returns Suggested { calories, protein }.
 */
export function suggestGoals(profile: UserProfile, weightKg: number): SuggestedGoals {
  const safeWeight = clamp(weightKg, 30, 300);

  const bmr  = computeBMR({
    sex:      profile.sex,
    weightKg: safeWeight,
    heightCm: profile.heightCm,
    age:      profile.age,
  });

  const tdee  = computeTDEE(bmr, profile.activityLevel);
  const delta = GOAL_DELTAS[profile.goalType] ?? 0;

  const rawCalories = tdee + delta;
  const calories    = Math.max(1000, roundTo(rawCalories, 10));

  const rawProtein = PROTEIN_G_PER_KG * safeWeight;
  const protein    = Math.max(50, roundTo(rawProtein, 5));

  return { calories, protein };
}
