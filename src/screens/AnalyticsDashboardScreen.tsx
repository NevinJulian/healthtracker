/**
 * AnalyticsDashboardScreen
 *
 * Verdure redesign: Unit 10 (#245)
 * Extended with strength progression + longer trends & streaks: #265
 * Extended with nutrition adherence + meal & recipe insights: #267
 *
 * Behaviour-preserving restyle only. All DB queries and metric calculations
 * are unchanged. Presentation updated to the Verdure calm-wellness system
 * per design/verdure/DESIGN.md and code.html §7 Analytics board.
 *
 * Layout:
 *   - ScreenHeader (Fraunces title, "Last 30 days" subtitle)
 *   - Metric cards row: Weight delta | Workout count | Fasting streak
 *   - Weight trend card: flat View-based chart (sage line, sageTint area, sageDeep dot)
 *                        with 30/90-day Pill toggle
 *   - Strength progression chart: step-line of gym weight over 90 days
 *   - Streaks card: current + longest for gym, walk, fasting
 *   - Consistency grid: 7-col rounded dot grid (sage/gold/canvasSunken) 30-day + legend
 *   - 7-day / 30-day rolling stats with ProgressBar rows
 *   - Nutrition section:
 *       · Daily calorie + protein trend (View-based chart, goal reference line)
 *       · Plan adherence ProgressBar
 *       · Most-eaten recipes ranked list
 *       · Average macros stat card
 *       · Most-cooked recipes (cook_log, builds over time) + inventory snapshot
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Typography, Radius } from '../theme/tokens';
import {
  getRollingWindow,
  getWeightHistory,
  getStartDate,
  toISODate,
  getConsumedMacrosByDay,
  getMealAdherence,
  getMostEatenRecipes,
  getAverageConsumedMacros,
  getMostCookedRecipes,
  getInventorySnapshot,
  getNutritionGoals,
  type NutritionGoals,
  type DailyMacroTotals,
  type MealAdherenceSummary,
  type EatenRecipeRow,
  type AverageConsumedMacros,
  type CookedRecipeRow,
  type InventorySnapshot,
} from '../db/database';
import { Card, ProgressBar, ScreenHeader, Pill } from '../components';
import {
  computeStreaks,
  computeStrengthProgression,
  progressionSteps,
  StreakSet,
  KG_PER_CYCLE,
  normaliseMacroSeries,
  macroChartDateLabel,
} from './analyticsHelpers';
import { NUTRITION_GOALS } from '../nutrition/goals';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RollingStats {
  walk: number;   // completion %
  gym: number;    // completion %
  extra: number;  // absolute count
  total: number;  // days in window
  fasting: number; // completion %
}

type DotState = 'complete' | 'partial' | 'missed';
type WeightWindow = 30 | 90;

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  microLabel,
  bigNumber,
  subLabel,
}: {
  microLabel: string;
  bigNumber: string;
  subLabel: string;
}) {
  return (
    <Card style={styles.metricCard}>
      <Text style={styles.metricMicroLabel}>{microLabel}</Text>
      <Text style={styles.metricBigNumber}>{bigNumber}</Text>
      <Text style={styles.metricSubLabel}>{subLabel}</Text>
    </Card>
  );
}

// ─── Weight trend (flat View-based chart with 30/90-day toggle) ───────────────

function WeightTrendCard({
  history30,
  history90,
}: {
  history30: { date: string; weight: number }[];
  history90: { date: string; weight: number }[];
}) {
  const [window, setWindow] = useState<WeightWindow>(30);
  const history = window === 30 ? history30 : history90;

  if (history30.length === 0 && history90.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardSectionTitle}>Body weight</Text>
        </View>
        <Text style={styles.emptyText}>No weight data logged yet.</Text>
      </Card>
    );
  }

  const weights = history.length > 0 ? history.map((w) => w.weight) : [0];
  const minW = Math.min(...weights) - 2;
  const maxW = Math.max(...weights) + 2;
  const current = history.length > 0 ? weights[weights.length - 1] : null;
  const range = maxW - minW || 1;

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardSectionTitle}>Body weight</Text>
        {current !== null && (
          <Text style={styles.currentWeightLabel}>{current.toFixed(1)} kg</Text>
        )}
      </View>

      {/* 30/90 day toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          onPress={() => setWindow(30)}
          style={[
            styles.togglePill,
            window === 30 && styles.togglePillActive,
          ]}
        >
          <Text
            style={[
              styles.togglePillText,
              window === 30 && styles.togglePillTextActive,
            ]}
          >
            30d
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setWindow(90)}
          style={[
            styles.togglePill,
            window === 90 && styles.togglePillActive,
          ]}
        >
          <Text
            style={[
              styles.togglePillText,
              window === 90 && styles.togglePillTextActive,
            ]}
          >
            90d
          </Text>
        </TouchableOpacity>
      </View>

      {history.length === 0 ? (
        <Text style={styles.emptyText}>No data for this period.</Text>
      ) : (
        <>
          {/* Flat chart: sage-tint area fill + sage bars + sageDeep dot on last point.
              Uses View-based rendering (no new chart dependency) per DESIGN.md §5. */}
          <View style={styles.chartContainer}>
            {/* sageTint area spans the full chart width at half-opacity */}
            <View style={styles.areaBackground} />

            {/* Bars + last-point dot */}
            <View style={styles.lineLayer}>
              {history.map((pt, i) => {
                const heightPct = Math.max(4, ((pt.weight - minW) / range) * 100);
                const isLast = i === history.length - 1;
                return (
                  <View key={`bar-${i}`} style={styles.barColumn}>
                    {isLast ? (
                      /* sageDeep dot for the most-recent data point */
                      <View style={styles.lastDot} />
                    ) : (
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${heightPct}%`,
                            backgroundColor: Colors.sage,
                          },
                        ]}
                      />
                    )}
                    {(i === 0 || isLast) && (
                      <Text style={styles.barDateLabel}>
                        {pt.date.substring(8, 10)}/{pt.date.substring(5, 7)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.chartMeta}>
            <Text style={styles.chartMetaText}>
              Min {(minW + 2).toFixed(1)} kg
            </Text>
            <Text style={styles.chartMetaText}>
              Max {(maxW - 2).toFixed(1)} kg
            </Text>
          </View>
        </>
      )}
    </Card>
  );
}

// ─── Strength progression chart ───────────────────────────────────────────────

interface StrengthProgressionCardProps {
  startDateISO: string;
  todayISO: string;
}

function StrengthProgressionCard({
  startDateISO,
  todayISO,
}: StrengthProgressionCardProps) {
  // Compute the 90-day window (or since start, whichever is shorter)
  const windowStart = (() => {
    const d = new Date(todayISO);
    d.setDate(d.getDate() - 89);
    const cutoff = toISODate(d);
    return cutoff > startDateISO ? cutoff : startDateISO;
  })();

  const fullPoints = computeStrengthProgression(windowStart, todayISO, 0);
  const steps = progressionSteps(fullPoints);

  // Current weight and cycle
  const lastPoint = fullPoints.length > 0 ? fullPoints[fullPoints.length - 1] : null;
  const currentCycle = lastPoint?.cycle ?? 0;
  const currentWeightAdded = lastPoint?.weightKg ?? 0;

  // Too early — first cycle not even started yet
  const isEarlyState = fullPoints.length > 0 && currentCycle === 0 && fullPoints.length < 7;

  if (fullPoints.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardSectionTitle}>Strength progression</Text>
        </View>
        <Text style={styles.emptyText}>
          Start your first session to begin tracking progression.
        </Text>
      </Card>
    );
  }

  const subtitleLabel =
    currentCycle === 0
      ? 'Baseline — first cycle in progress'
      : `Cycle ${currentCycle} · +${currentWeightAdded}kg added`;

  // Chart sizing
  const maxWeight = steps.length > 0 ? Math.max(...steps.map((s) => s.weightKg)) : 0;
  const chartMax = Math.max(maxWeight + KG_PER_CYCLE, KG_PER_CYCLE);

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardSectionTitle}>Strength progression</Text>
        <Text style={styles.cardSectionTrailing}>{subtitleLabel}</Text>
      </View>

      {isEarlyState ? (
        <Text style={styles.emptyText}>
          Progression builds over your first cycle (21 days).
        </Text>
      ) : (
        <>
          {/* Step-line chart rendered as View-based bars.
              Each step segment spans from its start date to the next step.
              We render one bar per step point, width proportional to duration. */}
          <View style={styles.strengthChartContainer}>
            <View style={styles.areaBackground} />
            <View style={styles.lineLayer}>
              {steps.map((pt, i) => {
                const heightPct = Math.max(
                  6,
                  chartMax > 0 ? ((pt.weightKg) / chartMax) * 100 : 6
                );
                const isLast = i === steps.length - 1;
                return (
                  <View key={`step-${i}`} style={styles.barColumn}>
                    {isLast ? (
                      <View
                        style={[
                          styles.strengthLastDot,
                          {
                            marginBottom:
                              `${heightPct}%` as unknown as number,
                          },
                        ]}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${heightPct}%`,
                          backgroundColor: isLast
                            ? Colors.sageDeep
                            : Colors.sage,
                        },
                      ]}
                    />
                    {(i === 0 || isLast) && (
                      <Text style={styles.barDateLabel}>
                        {pt.date.substring(8, 10)}/{pt.date.substring(5, 7)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Cycle labels */}
          <View style={styles.chartMeta}>
            <Text style={styles.chartMetaText}>Baseline</Text>
            {currentCycle > 0 && (
              <Text style={[styles.chartMetaText, { color: Colors.sageDeep }]}>
                +{currentWeightAdded}kg now
              </Text>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

// ─── Streaks card ─────────────────────────────────────────────────────────────

function StreaksCard({ streaks }: { streaks: StreakSet }) {
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.cardSectionTitle}>Streaks</Text>

      {/* Column headers */}
      <View style={[styles.streakRow, styles.streakHeaderRow]}>
        <Text style={[styles.streakLabel, styles.streakHeaderText]} />
        <Text style={[styles.streakValueLabel, styles.streakHeaderText]}>
          Current
        </Text>
        <Text style={[styles.streakValueLabel, styles.streakHeaderText]}>
          Best
        </Text>
      </View>

      {/* Gym */}
      <View style={styles.streakRow}>
        <Text style={styles.streakLabel}>Gym</Text>
        <View style={styles.streakValueCell}>
          <Pill
            label={`${streaks.gym.current}d`}
            accent={streaks.gym.current > 0 ? 'sage' : 'gold'}
          />
        </View>
        <View style={styles.streakValueCell}>
          <Pill label={`${streaks.gym.longest}d`} accent="sage" />
        </View>
      </View>

      {/* Walking */}
      <View style={styles.streakRow}>
        <Text style={styles.streakLabel}>Walking</Text>
        <View style={styles.streakValueCell}>
          <Pill
            label={`${streaks.walk.current}d`}
            accent={streaks.walk.current > 0 ? 'sage' : 'gold'}
          />
        </View>
        <View style={styles.streakValueCell}>
          <Pill label={`${streaks.walk.longest}d`} accent="sage" />
        </View>
      </View>

      {/* Fasting */}
      <View style={[styles.streakRow, { marginBottom: 0 }]}>
        <Text style={styles.streakLabel}>Fasting</Text>
        <View style={styles.streakValueCell}>
          <Pill
            label={`${streaks.fasting.current}d`}
            accent={streaks.fasting.current > 0 ? 'sky' : 'gold'}
          />
        </View>
        <View style={styles.streakValueCell}>
          <Pill label={`${streaks.fasting.longest}d`} accent="sky" />
        </View>
      </View>
    </Card>
  );
}

// ─── Consistency dot grid (30-day) ────────────────────────────────────────────

function ConsistencyGrid({ dots }: { dots: DotState[] }) {
  const DOT_COLORS: Record<DotState, string> = {
    complete: Colors.sage,
    partial: Colors.gold,
    missed: Colors.canvasSunken,
  };

  return (
    <Card style={styles.sectionCard}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardSectionTitle}>Consistency</Text>
        <Text style={styles.cardSectionTrailing}>Last 30 days</Text>
      </View>

      <View style={styles.dotGrid}>
        {dots.map((state, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: DOT_COLORS[state] }]}
          />
        ))}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.sage }]} />
          <Text style={styles.legendLabel}>Complete</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.gold }]} />
          <Text style={styles.legendLabel}>Partial</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.canvasSunken }]} />
          <Text style={styles.legendLabel}>Missed</Text>
        </View>
      </View>
    </Card>
  );
}

// ─── Rolling stats card ───────────────────────────────────────────────────────

function RollingStatsCard({
  title,
  stats,
}: {
  title: string;
  stats: RollingStats;
}) {
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.cardSectionTitle} numberOfLines={1}>
        {title}
      </Text>

      {/* Walk */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Walking</Text>
        <ProgressBar
          progress={stats.walk / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.walk}%`} accent="sage" />
      </View>

      {/* Gym */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Gym</Text>
        <ProgressBar
          progress={stats.gym / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.gym}%`} accent="sage" />
      </View>

      {/* Fasting */}
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Fasting</Text>
        <ProgressBar
          progress={stats.fasting / 100}
          height={7}
          style={styles.statBar}
        />
        <Pill label={`${stats.fasting}%`} accent="sky" />
      </View>

      {/* Extra workouts count */}
      <View style={[styles.statRow, { marginBottom: 0 }]}>
        <Text style={styles.statLabel}>Extra workouts</Text>
        <View style={styles.statBarSpacer} />
        <Pill label={`${stats.extra} done`} accent="clay" />
      </View>
    </Card>
  );
}

// ─── Nutrition: Daily macro trend chart ───────────────────────────────────────

function MacroTrendChart({
  macros,
  macroKey,
  goal,
  label,
  accentColor,
}: {
  macros: DailyMacroTotals[];
  macroKey: 'calories' | 'protein';
  goal: number;
  label: string;
  accentColor: string;
}) {
  if (macros.length === 0) return null;

  const normalised = normaliseMacroSeries(
    macros.map((m) => ({ date: m.date, calories: m.calories, protein: m.protein })),
    macroKey,
    goal
  );
  const total = macros.length;
  const latest = macros[total - 1][macroKey];

  return (
    <View style={styles.macroChartBlock}>
      <View style={styles.macroChartHeader}>
        <Text style={styles.macroChartLabel}>{label}</Text>
        <Text style={styles.macroChartValue}>
          {latest} {macroKey === 'calories' ? 'kcal' : 'g'} today
        </Text>
      </View>

      {/* Bar chart area */}
      <View style={styles.macroChartContainer}>
        {/* Soft tint background */}
        <View style={[styles.macroChartBg, { backgroundColor: accentColor + '18' }]} />

        {/* Goal reference line — positioned at 100% height (top) */}
        <View style={styles.macroGoalLine} />

        {/* Bars */}
        <View style={styles.macroBarsLayer}>
          {normalised.map((ratio, i) => {
            const heightPct = Math.max(4, ratio * 100);
            const isLast = i === total - 1;
            const dateLabel = macroChartDateLabel(i, total, macros[i].date);
            return (
              <View key={`mbar-${macroKey}-${i}`} style={styles.macroBarCol}>
                <View
                  style={[
                    styles.macroBar,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: isLast ? accentColor : accentColor + 'AA',
                    },
                  ]}
                />
                {dateLabel !== '' && (
                  <Text style={styles.macroBarDateLabel}>{dateLabel}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* Goal annotation */}
      <Text style={styles.macroGoalAnnotation}>
        Goal: {goal} {macroKey === 'calories' ? 'kcal' : 'g'}
      </Text>
    </View>
  );
}

// ─── Nutrition: Section card ──────────────────────────────────────────────────

function NutritionSectionCard({
  macros,
  adherence,
  mostEaten,
  avgMacros,
  mostCooked,
  inventory,
  nutritionGoals,
}: {
  macros: DailyMacroTotals[];
  adherence: MealAdherenceSummary;
  mostEaten: EatenRecipeRow[];
  avgMacros: AverageConsumedMacros;
  mostCooked: CookedRecipeRow[];
  inventory: InventorySnapshot;
  nutritionGoals: NutritionGoals;
}) {
  const hasConsumedHistory = macros.length > 0;
  const hasMostEaten = mostEaten.length > 0;
  const hasCookLog = mostCooked.length > 0;

  return (
    <>
      {/* Section divider header */}
      <View style={styles.sectionDivider}>
        <Text style={styles.sectionDividerText}>Nutrition</Text>
      </View>

      {/* 1. Nutrition adherence card */}
      <Card style={styles.sectionCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardSectionTitle}>Nutrition adherence</Text>
          <Text style={styles.cardSectionTrailing}>Last 30 days</Text>
        </View>

        {!hasConsumedHistory ? (
          <Text style={styles.emptyText}>
            Log meals as consumed to see adherence.
          </Text>
        ) : (
          <>
            {/* Calorie trend chart */}
            <MacroTrendChart
              macros={macros}
              macroKey="calories"
              goal={nutritionGoals.calories}
              label="Calories"
              accentColor={Colors.clay}
            />

            {/* Protein trend chart */}
            <MacroTrendChart
              macros={macros}
              macroKey="protein"
              goal={nutritionGoals.protein}
              label="Protein"
              accentColor={Colors.sage}
            />
          </>
        )}

        {/* Plan adherence bar — available whenever there are any planned meals */}
        {adherence.planned > 0 ? (
          <View style={styles.adherenceRow}>
            <Text style={styles.adherenceLabel}>Plan adherence</Text>
            <ProgressBar
              progress={adherence.adherenceRatio}
              height={7}
              style={styles.adherenceBar}
            />
            <Pill
              label={`${Math.round(adherence.adherenceRatio * 100)}%`}
              accent="clay"
            />
          </View>
        ) : (
          <Text style={[styles.emptyText, hasConsumedHistory ? { marginTop: Spacing.md } : {}]}>
            Plan meals to track adherence.
          </Text>
        )}
      </Card>

      {/* 2. Recipe insights card */}
      <Card style={styles.sectionCard}>
        <Text style={styles.cardSectionTitle}>Meal insights</Text>

        {/* Most-eaten recipes */}
        <Text style={styles.insightSubheading}>Most eaten</Text>
        {!hasMostEaten ? (
          <Text style={styles.emptyText}>
            Mark meals as consumed to see your top recipes.
          </Text>
        ) : (
          <View style={styles.recipeRankList}>
            {mostEaten.map((r, i) => (
              <View key={r.recipe_id} style={styles.recipeRankRow}>
                <View style={styles.recipeRankBadge}>
                  <Text style={styles.recipeRankNum}>{i + 1}</Text>
                </View>
                <Text style={styles.recipeRankTitle} numberOfLines={1}>
                  {r.title}
                </Text>
                <Pill label={`${r.count}x`} accent="clay" />
              </View>
            ))}
          </View>
        )}

        {/* Average macros */}
        {avgMacros.sampleSize > 0 && (
          <>
            <Text style={[styles.insightSubheading, { marginTop: Spacing.md }]}>
              Average per meal
            </Text>
            <View style={styles.avgMacrosRow}>
              <View style={styles.avgMacroCell}>
                <Text style={styles.avgMacroValue}>{avgMacros.calories}</Text>
                <Text style={styles.avgMacroUnit}>kcal</Text>
              </View>
              <View style={styles.avgMacroCell}>
                <Text style={[styles.avgMacroValue, { color: Colors.sage }]}>
                  {avgMacros.protein}g
                </Text>
                <Text style={styles.avgMacroUnit}>protein</Text>
              </View>
              <View style={styles.avgMacroCell}>
                <Text style={[styles.avgMacroValue, { color: Colors.gold }]}>
                  {avgMacros.carbs}g
                </Text>
                <Text style={styles.avgMacroUnit}>carbs</Text>
              </View>
              <View style={styles.avgMacroCell}>
                <Text style={[styles.avgMacroValue, { color: Colors.sky }]}>
                  {avgMacros.fat}g
                </Text>
                <Text style={styles.avgMacroUnit}>fat</Text>
              </View>
            </View>
            <Text style={styles.avgMacroSample}>
              Based on {avgMacros.sampleSize} consumed{' '}
              {avgMacros.sampleSize === 1 ? 'meal' : 'meals'}
            </Text>
          </>
        )}
      </Card>

      {/* 3. Cook history & inventory card */}
      <Card style={styles.sectionCard}>
        <Text style={styles.cardSectionTitle}>Cook history & stock</Text>

        {/* Most cooked — only once cook_log has data */}
        <Text style={styles.insightSubheading}>Most cooked</Text>
        {!hasCookLog ? (
          <Text style={styles.emptyText}>
            Builds as you cook — finish cooking tasks to start tracking.
          </Text>
        ) : (
          <View style={styles.recipeRankList}>
            {mostCooked.map((r, i) => (
              <View key={r.recipe_id} style={styles.recipeRankRow}>
                <View style={[styles.recipeRankBadge, styles.recipeRankBadgeSage]}>
                  <Text style={[styles.recipeRankNum, styles.recipeRankNumSage]}>
                    {i + 1}
                  </Text>
                </View>
                <Text style={styles.recipeRankTitle} numberOfLines={1}>
                  {r.title}
                </Text>
                <Pill label={`${r.totalPortions}p`} accent="sage" />
              </View>
            ))}
          </View>
        )}

        {/* Current inventory snapshot — always shown */}
        <Text style={[styles.insightSubheading, { marginTop: Spacing.md }]}>
          Current stock
        </Text>
        {inventory.recipesInStock === 0 ? (
          <Text style={styles.emptyText}>No meals in stock right now.</Text>
        ) : (
          <>
            <View style={styles.inventorySummaryRow}>
              <View style={styles.inventoryStatCell}>
                <Text style={styles.inventoryStatValue}>
                  {inventory.recipesInStock}
                </Text>
                <Text style={styles.inventoryStatLabel}>recipes</Text>
              </View>
              <View style={styles.inventoryStatCell}>
                <Text style={[styles.inventoryStatValue, { color: Colors.sageDeep }]}>
                  {inventory.totalPortions}
                </Text>
                <Text style={styles.inventoryStatLabel}>portions</Text>
              </View>
            </View>
            {inventory.items.slice(0, 4).map((item) => (
              <View key={item.recipe_id} style={styles.inventoryItemRow}>
                <Text style={styles.inventoryItemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Pill label={`${item.portionsAvailable}p`} accent="sage" />
              </View>
            ))}
            {inventory.items.length > 4 && (
              <Text style={styles.inventoryMoreLabel}>
                +{inventory.items.length - 4} more
              </Text>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AnalyticsDashboardScreen() {
  const [loading, setLoading] = useState(false);
  const [stats7Day, setStats7Day] = useState<RollingStats>({
    walk: 0, gym: 0, extra: 0, total: 0, fasting: 0,
  });
  const [stats30Day, setStats30Day] = useState<RollingStats>({
    walk: 0, gym: 0, extra: 0, total: 0, fasting: 0,
  });
  const [weightHistory30, setWeightHistory30] = useState<{ date: string; weight: number }[]>([]);
  const [weightHistory90, setWeightHistory90] = useState<{ date: string; weight: number }[]>([]);
  const [consistencyDots, setConsistencyDots] = useState<DotState[]>([]);
  const [startDateISO, setStartDateISO] = useState<string>('');
  const [todayISO, setTodayISO] = useState<string>('');
  const [streaks, setStreaks] = useState<StreakSet>({
    gym: { current: 0, longest: 0 },
    walk: { current: 0, longest: 0 },
    fasting: { current: 0, longest: 0 },
  });

  // Metrics derived from 30-day window
  const [weightDelta, setWeightDelta] = useState<number | null>(null);
  const [workoutCount30, setWorkoutCount30] = useState(0);
  const [fastingStreak, setFastingStreak] = useState(0);

  // ── Nutrition analytics state ────────────────────────────────────────────────
  const [nutritionGoals, setNutritionGoals] = useState<NutritionGoals>(NUTRITION_GOALS);
  const [consumedMacros, setConsumedMacros] = useState<DailyMacroTotals[]>([]);
  const [mealAdherence, setMealAdherence] = useState<MealAdherenceSummary>({
    planned: 0,
    consumed: 0,
    adherenceRatio: 0,
  });
  const [mostEatenRecipes, setMostEatenRecipes] = useState<EatenRecipeRow[]>([]);
  const [avgMacros, setAvgMacros] = useState<AverageConsumedMacros>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    sampleSize: 0,
  });
  const [mostCookedRecipes, setMostCookedRecipes] = useState<CookedRecipeRow[]>([]);
  const [inventorySnapshot, setInventorySnapshot] = useState<InventorySnapshot>({
    recipesInStock: 0,
    totalPortions: 0,
    items: [],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await getRollingWindow();
      const weightData30 = await getWeightHistory(30);
      const weightData90 = await getWeightHistory(90);
      const startDate = await getStartDate();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = toISODate(today);

      setStartDateISO(startDate);
      setTodayISO(todayStr);

      const computeStats = (days: number): RollingStats => {
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffIso = toISODate(cutoff);

        const relevant = logs.filter(
          (l) => l.date >= cutoffIso && l.date <= todayStr
        );
        const total = relevant.length;
        if (total === 0) return { walk: 0, gym: 0, extra: 0, total: 0, fasting: 0 };

        const walkCount = relevant.filter((l) => l.walk_completed).length;
        const gymCount = relevant.filter((l) => l.hammer_completed).length;
        const fastingCount = relevant.filter((l) => l.fasting_completed).length;
        const extraCount = relevant.reduce(
          (sum, l) =>
            sum + (l.additional_workouts?.filter((aw) => aw.completed).length ?? 0),
          0
        );

        return {
          walk: Math.round((walkCount / total) * 100),
          gym: Math.round((gymCount / total) * 100),
          fasting: Math.round((fastingCount / total) * 100),
          extra: extraCount,
          total,
        };
      };

      const s7 = computeStats(7);
      const s30 = computeStats(30);
      setStats7Day(s7);
      setStats30Day(s30);
      setWeightHistory30(weightData30);
      setWeightHistory90(weightData90);

      // ── Metric card values ──────────────────────────────────────────────────

      // Weight delta (first vs last in 30-day window)
      if (weightData30.length >= 2) {
        const delta = weightData30[weightData30.length - 1].weight - weightData30[0].weight;
        setWeightDelta(delta);
      } else {
        setWeightDelta(null);
      }

      // Total workouts (gym sessions + extra) in 30 days
      const gymDays30 = s30.total > 0 ? Math.round((s30.gym / 100) * s30.total) : 0;
      setWorkoutCount30(gymDays30 + s30.extra);

      // Fasting streak — consecutive days from today going back
      const sortedDesc = [...logs]
        .filter((l) => l.date <= todayStr)
        .sort((a, b) => (a.date > b.date ? -1 : 1));
      let streak = 0;
      for (const l of sortedDesc) {
        if (l.fasting_completed) streak++;
        else break;
      }
      setFastingStreak(streak);

      // ── Streaks (gym, walk, fasting) ────────────────────────────────────────
      const computedStreaks = computeStreaks(logs, todayStr);
      setStreaks(computedStreaks);

      // ── Consistency dots (last 30 days) ────────────────────────────────────
      const dots: DotState[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = toISODate(d);
        const log = logs.find((l) => l.date === iso);
        if (!log) {
          dots.push('missed');
        } else {
          const allComplete = log.walk_completed && log.hammer_completed;
          const anyComplete = log.walk_completed || log.hammer_completed;
          if (allComplete) dots.push('complete');
          else if (anyComplete) dots.push('partial');
          else dots.push('missed');
        }
      }
      setConsistencyDots(dots);

      // ── Nutrition analytics (#267) ──────────────────────────────────────────
      const [macrosByDay, adherence, topEaten, avgM, topCooked, invSnapshot, storedGoals] =
        await Promise.all([
          getConsumedMacrosByDay(30),
          getMealAdherence(30),
          getMostEatenRecipes(5),
          getAverageConsumedMacros(),
          getMostCookedRecipes(5),
          getInventorySnapshot(),
          getNutritionGoals(),
        ]);

      setConsumedMacros(macrosByDay);
      setMealAdherence(adherence);
      setMostEatenRecipes(topEaten);
      setAvgMacros(avgM);
      setMostCookedRecipes(topCooked);
      setInventorySnapshot(invSnapshot);
      setNutritionGoals(storedGoals);
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Format weight delta for metric card
  const weightDeltaStr =
    weightDelta === null
      ? '—'
      : weightDelta > 0
      ? `+${weightDelta.toFixed(1)}`
      : weightDelta.toFixed(1);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadData}
            tintColor={Colors.sage}
          />
        }
      >
        <ScreenHeader title="Progress" subtitle="Last 30 days" />

        {/* Metric cards row */}
        <View style={styles.metricsRow}>
          <MetricCard
            microLabel="Weight"
            bigNumber={weightDeltaStr}
            subLabel="kg this month"
          />
          <MetricCard
            microLabel="Workouts"
            bigNumber={String(workoutCount30)}
            subLabel={`of ${stats30Day.total} days`}
          />
          <MetricCard
            microLabel="Fasting"
            bigNumber={String(fastingStreak)}
            subLabel="day streak"
          />
        </View>

        {/* Weight trend (30/90-day toggle) */}
        <WeightTrendCard
          history30={weightHistory30}
          history90={weightHistory90}
        />

        {/* Strength progression */}
        {startDateISO !== '' && todayISO !== '' && (
          <StrengthProgressionCard
            startDateISO={startDateISO}
            todayISO={todayISO}
          />
        )}

        {/* Streaks */}
        <StreaksCard streaks={streaks} />

        {/* Consistency grid (30 days) */}
        <ConsistencyGrid dots={consistencyDots} />

        {/* Rolling stats */}
        <RollingStatsCard title="7-Day Rolling Stats" stats={stats7Day} />
        <RollingStatsCard title="30-Day Rolling Stats" stats={stats30Day} />

        {/* Nutrition adherence + meal & recipe insights */}
        <NutritionSectionCard
          macros={consumedMacros}
          adherence={mealAdherence}
          mostEaten={mostEatenRecipes}
          avgMacros={avgMacros}
          mostCooked={mostCookedRecipes}
          inventory={inventorySnapshot}
          nutritionGoals={nutritionGoals}
        />

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  scrollContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },

  // ── Metric cards ────────────────────────────────────────────────────────────
  metricsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  metricCard: {
    flex: 1,
    padding: Spacing.md,
  },
  /** DESIGN.md §3 micro-label: Jakarta 700, 10px, uppercase, +0.12em tracking, mute */
  metricMicroLabel: {
    fontFamily: Typography.label,
    fontSize: 8,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginBottom: Spacing.xs + 2,
  },
  /** Fraunces 600 21px — matches code.html .metric b spec */
  metricBigNumber: {
    fontFamily: Typography.display,
    fontSize: 21,
    fontWeight: Typography.weights.semibold,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  /** sageDeep sub-caption: 9px bold per code.html .metric .mt */
  metricSubLabel: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.sageDeep,
    marginTop: Spacing.xs,
  },

  // ── Shared card layout ───────────────────────────────────────────────────────
  sectionCard: {
    marginHorizontal: Spacing.lg,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  cardSectionTitle: {
    fontFamily: Typography.title,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
  },
  cardSectionTrailing: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.textMuted,
    flexShrink: 1,
    marginLeft: Spacing.sm,
    textAlign: 'right',
  },

  // ── 30/90-day toggle ─────────────────────────────────────────────────────────
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
    alignSelf: 'flex-start',
  },
  togglePill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.canvasSunken,
  },
  togglePillActive: {
    backgroundColor: Colors.sage,
  },
  togglePillText: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  togglePillTextActive: {
    color: Colors.textOnAccent,
  },

  // ── Weight chart ─────────────────────────────────────────────────────────────
  currentWeightLabel: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
    color: Colors.sageDeep,
  },
  chartContainer: {
    height: 80,
    marginBottom: Spacing.lg,
  },
  strengthChartContainer: {
    height: 80,
    marginBottom: Spacing.lg,
  },
  /** Full-width sage-tint background — represents the area fill under the line */
  areaBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    opacity: 0.55,
  },
  lineLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
    marginHorizontal: 1,
  },
  bar: {
    width: '80%',
    maxWidth: 8,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  /** sageDeep circle — the last/current data point dot per DESIGN.md §5 */
  lastDot: {
    width: 9,
    height: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.sageDeep,
    marginBottom: Spacing.xs,
  },
  strengthLastDot: {
    width: 9,
    height: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.sageDeep,
    position: 'absolute',
    top: Spacing.sm,
  },
  barDateLabel: {
    position: 'absolute',
    bottom: -16,
    fontFamily: Typography.body,
    fontSize: 9,
    color: Colors.textMuted,
  },
  chartMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
  },
  chartMetaText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },

  // ── Consistency grid ─────────────────────────────────────────────────────────
  dotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm - 2,
    marginBottom: Spacing.md,
  },
  dot: {
    width: 30,
    aspectRatio: 1,
    borderRadius: Radius.sm - 4,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendSwatch: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
  },

  // ── Streaks card ─────────────────────────────────────────────────────────────
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  streakHeaderRow: {
    marginBottom: Spacing.xs,
  },
  streakLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    flex: 1,
  },
  streakHeaderText: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  streakValueLabel: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.textMuted,
    width: 56,
    textAlign: 'center',
  },
  streakValueCell: {
    width: 56,
    alignItems: 'center',
  },

  // ── Rolling stats card ────────────────────────────────────────────────────────
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  statLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    width: 90,
  },
  statBar: {
    flex: 1,
  },
  statBarSpacer: {
    flex: 1,
  },

  // ── Nutrition section divider ──────────────────────────────────────────────
  sectionDivider: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  sectionDividerText: {
    fontFamily: Typography.label,
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },

  // ── Macro trend chart ──────────────────────────────────────────────────────
  macroChartBlock: {
    marginBottom: Spacing.md,
  },
  macroChartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  macroChartLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
  },
  macroChartValue: {
    fontFamily: Typography.label,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.textMuted,
  },
  macroChartContainer: {
    height: 56,
    position: 'relative',
    marginBottom: Spacing.xs,
  },
  macroChartBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.sm,
  },
  /** Hairline reference at the top of the chart = 100% of goal */
  macroGoalLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.line2,
  },
  macroBarsLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  macroBarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
    marginHorizontal: 1,
  },
  macroBar: {
    width: '75%',
    maxWidth: 10,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  macroBarDateLabel: {
    position: 'absolute',
    bottom: -14,
    fontFamily: Typography.body,
    fontSize: 8,
    color: Colors.textMuted,
  },
  macroGoalAnnotation: {
    fontFamily: Typography.body,
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: Spacing.lg,
  },

  // ── Plan adherence row ─────────────────────────────────────────────────────
  adherenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  adherenceLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    width: 90,
  },
  adherenceBar: {
    flex: 1,
  },

  // ── Insight subheading ─────────────────────────────────────────────────────
  insightSubheading: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },

  // ── Recipe rank list ───────────────────────────────────────────────────────
  recipeRankList: {
    gap: Spacing.xs,
  },
  recipeRankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recipeRankBadge: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: Colors.clayTint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recipeRankBadgeSage: {
    backgroundColor: Colors.sageTint,
  },
  recipeRankNum: {
    fontFamily: Typography.label,
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.clayDeep,
  },
  recipeRankNumSage: {
    color: Colors.sageDeep,
  },
  recipeRankTitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    flex: 1,
  },

  // ── Average macros stat row ────────────────────────────────────────────────
  avgMacrosRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  avgMacroCell: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.canvasSunken,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  avgMacroValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.semibold,
    color: Colors.clay,
    lineHeight: 18,
  },
  avgMacroUnit: {
    fontFamily: Typography.label,
    fontSize: 8,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: Colors.textMuted,
    marginTop: 2,
  },
  avgMacroSample: {
    fontFamily: Typography.body,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    textAlign: 'right',
  },

  // ── Inventory snapshot ─────────────────────────────────────────────────────
  inventorySummaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  inventoryStatCell: {
    flex: 1,
    backgroundColor: Colors.sageTint,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
  },
  inventoryStatValue: {
    fontFamily: Typography.display,
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.semibold,
    color: Colors.sageDeep,
    lineHeight: 20,
  },
  inventoryStatLabel: {
    fontFamily: Typography.label,
    fontSize: 8,
    fontWeight: Typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: Colors.textMuted,
    marginTop: 2,
  },
  inventoryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  inventoryItemTitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textSecondary,
    flex: 1,
  },
  inventoryMoreLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizes.xs,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: Spacing.xs,
  },
});
