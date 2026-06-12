/**
 * tdee.test.ts
 *
 * Thorough unit tests for the TDEE computation module (src/nutrition/tdee.ts).
 * Covers: BMR (male/female), each activity multiplier, each goal delta,
 * protein calculation, clamping/edge cases, and the suggestGoals integration.
 *
 * Issue #281 — Personalized nutrition goals + onboarding flow.
 */

import {
  computeBMR,
  computeTDEE,
  suggestGoals,
  ACTIVITY_MULTIPLIERS,
  type Sex,
  type ActivityLevel,
  type GoalType,
  type UserProfile,
} from '../tdee';

// ─── computeBMR ──────────────────────────────────────────────────────────────

describe('computeBMR', () => {
  // Reference: 85 kg male, 180 cm, 30 years old
  // BMR = 10*85 + 6.25*180 - 5*30 + 5 = 850 + 1125 - 150 + 5 = 1830
  it('computes correct BMR for a male reference case', () => {
    expect(computeBMR({ sex: 'male', weightKg: 85, heightCm: 180, age: 30 })).toBe(1830);
  });

  // Reference: 65 kg female, 165 cm, 28 years old
  // BMR = 10*65 + 6.25*165 - 5*28 - 161 = 650 + 1031.25 - 140 - 161 = 1380.25
  it('computes correct BMR for a female reference case', () => {
    expect(computeBMR({ sex: 'female', weightKg: 65, heightCm: 165, age: 28 })).toBeCloseTo(1380.25, 1);
  });

  it('male offset is +5 relative to female for same inputs', () => {
    const shared = { weightKg: 70, heightCm: 170, age: 25 };
    const male   = computeBMR({ sex: 'male',   ...shared });
    const female = computeBMR({ sex: 'female', ...shared });
    // Male constant is +5, female is -161; difference = 166
    expect(male - female).toBeCloseTo(166, 5);
  });

  it('higher weight increases BMR', () => {
    const base = { sex: 'male' as Sex, heightCm: 175, age: 35 };
    expect(computeBMR({ ...base, weightKg: 100 })).toBeGreaterThan(
      computeBMR({ ...base, weightKg: 70 })
    );
  });

  it('taller person has higher BMR', () => {
    const base = { sex: 'female' as Sex, weightKg: 60, age: 30 };
    expect(computeBMR({ ...base, heightCm: 175 })).toBeGreaterThan(
      computeBMR({ ...base, heightCm: 155 })
    );
  });

  it('older person has lower BMR', () => {
    const base = { sex: 'male' as Sex, weightKg: 80, heightCm: 175 };
    expect(computeBMR({ ...base, age: 60 })).toBeLessThan(
      computeBMR({ ...base, age: 25 })
    );
  });

  // Clamping / edge cases
  it('clamps weight below 30 kg to 30 kg', () => {
    const clamped = computeBMR({ sex: 'male', weightKg: 5, heightCm: 175, age: 25 });
    const expected = computeBMR({ sex: 'male', weightKg: 30, heightCm: 175, age: 25 });
    expect(clamped).toBe(expected);
  });

  it('clamps weight above 300 kg to 300 kg', () => {
    const clamped = computeBMR({ sex: 'male', weightKg: 999, heightCm: 175, age: 25 });
    const expected = computeBMR({ sex: 'male', weightKg: 300, heightCm: 175, age: 25 });
    expect(clamped).toBe(expected);
  });

  it('clamps height below 100 cm to 100 cm', () => {
    const clamped = computeBMR({ sex: 'female', weightKg: 60, heightCm: 50, age: 25 });
    const expected = computeBMR({ sex: 'female', weightKg: 60, heightCm: 100, age: 25 });
    expect(clamped).toBe(expected);
  });

  it('clamps height above 250 cm to 250 cm', () => {
    const clamped = computeBMR({ sex: 'male', weightKg: 80, heightCm: 999, age: 25 });
    const expected = computeBMR({ sex: 'male', weightKg: 80, heightCm: 250, age: 25 });
    expect(clamped).toBe(expected);
  });

  it('clamps age below 10 to 10', () => {
    const clamped = computeBMR({ sex: 'male', weightKg: 50, heightCm: 160, age: 2 });
    const expected = computeBMR({ sex: 'male', weightKg: 50, heightCm: 160, age: 10 });
    expect(clamped).toBe(expected);
  });

  it('clamps age above 120 to 120', () => {
    const clamped = computeBMR({ sex: 'female', weightKg: 55, heightCm: 160, age: 999 });
    const expected = computeBMR({ sex: 'female', weightKg: 55, heightCm: 160, age: 120 });
    expect(clamped).toBe(expected);
  });

  it('handles NaN inputs by clamping to minimum', () => {
    const result = computeBMR({ sex: 'male', weightKg: NaN, heightCm: NaN, age: NaN });
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('always returns a positive value', () => {
    // Even with extreme low inputs after clamping
    const result = computeBMR({ sex: 'female', weightKg: 1, heightCm: 1, age: 999 });
    expect(result).toBeGreaterThan(0);
  });
});

// ─── computeTDEE ─────────────────────────────────────────────────────────────

describe('computeTDEE', () => {
  const BMR = 1800;

  it('sedentary multiplier: 1.2', () => {
    expect(computeTDEE(BMR, 'sedentary')).toBeCloseTo(BMR * 1.2, 5);
    expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.2);
  });

  it('light multiplier: 1.375', () => {
    expect(computeTDEE(BMR, 'light')).toBeCloseTo(BMR * 1.375, 5);
    expect(ACTIVITY_MULTIPLIERS.light).toBe(1.375);
  });

  it('moderate multiplier: 1.55', () => {
    expect(computeTDEE(BMR, 'moderate')).toBeCloseTo(BMR * 1.55, 5);
    expect(ACTIVITY_MULTIPLIERS.moderate).toBe(1.55);
  });

  it('active multiplier: 1.725', () => {
    expect(computeTDEE(BMR, 'active')).toBeCloseTo(BMR * 1.725, 5);
    expect(ACTIVITY_MULTIPLIERS.active).toBe(1.725);
  });

  it('very_active multiplier: 1.9', () => {
    expect(computeTDEE(BMR, 'very_active')).toBeCloseTo(BMR * 1.9, 5);
    expect(ACTIVITY_MULTIPLIERS.very_active).toBe(1.9);
  });

  it('activity levels are ordered: sedentary < light < moderate < active < very_active', () => {
    const levels: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
    const tdeeLevels = levels.map((l) => computeTDEE(BMR, l));
    for (let i = 1; i < tdeeLevels.length; i++) {
      expect(tdeeLevels[i]).toBeGreaterThan(tdeeLevels[i - 1]);
    }
  });

  it('always returns a positive value', () => {
    expect(computeTDEE(0, 'sedentary')).toBeGreaterThan(0);
  });
});

// ─── suggestGoals ─────────────────────────────────────────────────────────────

describe('suggestGoals', () => {
  // Reference profile: 30-year-old male, 180 cm, moderate activity
  // BMR = 1830, TDEE = 1830 * 1.55 = 2836.5
  const maleProfile: UserProfile = {
    sex: 'male',
    age: 30,
    heightCm: 180,
    activityLevel: 'moderate',
    goalType: 'maintain',
  };

  const femaleProfile: UserProfile = {
    sex: 'female',
    age: 28,
    heightCm: 165,
    activityLevel: 'light',
    goalType: 'maintain',
  };

  it('returns positive calories and protein', () => {
    const { calories, protein } = suggestGoals(maleProfile, 85);
    expect(calories).toBeGreaterThan(0);
    expect(protein).toBeGreaterThan(0);
  });

  it('calories are rounded to nearest 10', () => {
    const { calories } = suggestGoals(maleProfile, 85);
    expect(calories % 10).toBe(0);
  });

  it('protein is rounded to nearest 5', () => {
    const { protein } = suggestGoals(maleProfile, 85);
    expect(protein % 5).toBe(0);
  });

  // ── Goal type deltas ──────────────────────────────────────────────────────

  it('cut goal produces ~500 fewer kcal than maintain', () => {
    const maintain = suggestGoals({ ...maleProfile, goalType: 'maintain' }, 85);
    const cut      = suggestGoals({ ...maleProfile, goalType: 'cut' },      85);
    // Delta is -500, but rounding may shift by up to ±5
    expect(maintain.calories - cut.calories).toBeGreaterThanOrEqual(490);
    expect(maintain.calories - cut.calories).toBeLessThanOrEqual(510);
  });

  it('gain goal produces ~300 more kcal than maintain', () => {
    const maintain = suggestGoals({ ...maleProfile, goalType: 'maintain' }, 85);
    const gain     = suggestGoals({ ...maleProfile, goalType: 'gain' },     85);
    expect(gain.calories - maintain.calories).toBeGreaterThanOrEqual(290);
    expect(gain.calories - maintain.calories).toBeLessThanOrEqual(310);
  });

  it('cut goal calories are always lower than gain goal calories', () => {
    const cut  = suggestGoals({ ...femaleProfile, goalType: 'cut' },  65);
    const gain = suggestGoals({ ...femaleProfile, goalType: 'gain' }, 65);
    expect(gain.calories).toBeGreaterThan(cut.calories);
  });

  // ── Protein calculation ───────────────────────────────────────────────────

  it('protein equals 1.8 g/kg × weightKg, rounded to nearest 5', () => {
    // 80 kg: 80 * 1.8 = 144 → round to nearest 5 → 145
    const { protein } = suggestGoals(maleProfile, 80);
    expect(protein).toBe(145);
  });

  it('protein scales with body weight', () => {
    const light  = suggestGoals(maleProfile, 60);
    const heavy  = suggestGoals(maleProfile, 100);
    expect(heavy.protein).toBeGreaterThan(light.protein);
  });

  it('protein is not affected by goal type', () => {
    const cut      = suggestGoals({ ...maleProfile, goalType: 'cut' },      80);
    const gain     = suggestGoals({ ...maleProfile, goalType: 'gain' },     80);
    const maintain = suggestGoals({ ...maleProfile, goalType: 'maintain' }, 80);
    expect(cut.protein).toBe(gain.protein);
    expect(cut.protein).toBe(maintain.protein);
  });

  // ── Minimum enforcement ───────────────────────────────────────────────────

  it('calories minimum is 1000 kcal even for extreme cut', () => {
    // Very low BMR scenario: small female, sedentary, cutting
    const smallProfile: UserProfile = {
      sex: 'female',
      age: 25,
      heightCm: 150,
      activityLevel: 'sedentary',
      goalType: 'cut',
    };
    const { calories } = suggestGoals(smallProfile, 40);
    expect(calories).toBeGreaterThanOrEqual(1000);
  });

  it('protein minimum is 50 g even for very low weight', () => {
    const { protein } = suggestGoals(maleProfile, 1); // absurdly low weight
    expect(protein).toBeGreaterThanOrEqual(50);
  });

  // ── Clamping / edge cases ─────────────────────────────────────────────────

  it('clamps absurdly low weight to 30 kg for protein calculation', () => {
    // 30 kg * 1.8 = 54 → rounds to 55
    const { protein } = suggestGoals(maleProfile, 5);
    expect(protein).toBeGreaterThanOrEqual(50); // minimum guard
    // Should match result with 30 kg (clamped floor)
    const clamped = suggestGoals(maleProfile, 30);
    expect(protein).toBe(clamped.protein);
  });

  it('clamps absurdly high weight to 300 kg', () => {
    const { calories, protein } = suggestGoals(maleProfile, 9999);
    const clamped = suggestGoals(maleProfile, 300);
    expect(calories).toBe(clamped.calories);
    expect(protein).toBe(clamped.protein);
  });

  it('handles NaN weight gracefully (no NaN in output)', () => {
    const { calories, protein } = suggestGoals(maleProfile, NaN);
    expect(Number.isFinite(calories)).toBe(true);
    expect(Number.isFinite(protein)).toBe(true);
    expect(calories).toBeGreaterThan(0);
    expect(protein).toBeGreaterThan(0);
  });

  // ── Real-world sanity checks ──────────────────────────────────────────────

  it('realistic moderate male (85 kg, 180 cm, 30) maintain produces ~2800–2900 kcal', () => {
    // BMR = 1830, TDEE = 1830 * 1.55 = 2836.5 → rounded to nearest 10 → 2840
    const { calories } = suggestGoals(maleProfile, 85);
    expect(calories).toBeGreaterThanOrEqual(2800);
    expect(calories).toBeLessThanOrEqual(2900);
  });

  it('realistic moderate male (85 kg) has protein around 150–155 g', () => {
    // 85 * 1.8 = 153 → rounds to 155
    const { protein } = suggestGoals(maleProfile, 85);
    expect(protein).toBeGreaterThanOrEqual(150);
    expect(protein).toBeLessThanOrEqual(160);
  });

  it('realistic active female (60 kg, 165 cm, 28) gain produces sensible range', () => {
    const profile: UserProfile = {
      sex: 'female',
      age: 28,
      heightCm: 165,
      activityLevel: 'active',
      goalType: 'gain',
    };
    const { calories, protein } = suggestGoals(profile, 60);
    // BMR ≈ 1380, TDEE = 1380.25 * 1.725 ≈ 2381, gain +300 = ~2681 → ~2680
    expect(calories).toBeGreaterThanOrEqual(2500);
    expect(calories).toBeLessThanOrEqual(2800);
    // 60 * 1.8 = 108 → rounds to 110
    expect(protein).toBeGreaterThanOrEqual(105);
    expect(protein).toBeLessThanOrEqual(115);
  });
});
