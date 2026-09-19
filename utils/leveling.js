const MAX_LEVEL = 100000;

function normalizeLevel(level) {
  const parsed = Number(level);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_LEVEL) {
    throw new RangeError(`Level must be between 0 and ${MAX_LEVEL.toLocaleString()}.`);
  }
  return parsed;
}

function getRequiredXP(level) {

  level = normalizeLevel(level);

  return Math.floor(

    5 * Math.pow(level, 2) +

    50 * level +

    100
  );
}

function calculateLevel(totalXP) {
  const xp = Math.max(0, Math.min(Number(totalXP) || 0, MAX_TOTAL_XP));
  let low = 0;
  let high = MAX_LEVEL;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getTotalXPForLevel(middle) <= xp) low = middle;
    else high = middle - 1;
  }

  return low;
}

function getProgressXP(totalXP) {
  const safeXP = Math.max(0, Math.min(Number(totalXP) || 0, MAX_TOTAL_XP));
  const level = calculateLevel(safeXP);
  const remainingXP = safeXP - getTotalXPForLevel(level);

  return {

    level,

    currentXP:
      remainingXP,

    requiredXP:
      getRequiredXP(level)
  };
}

function createProgressBar(
  current,
  required,
  size = 20
) {

  const progress =

    Math.min(
      current / required,
      1
    );

  const filled =
    Math.round(
      progress * size
    );

  return (

    '█'.repeat(filled) +

    '░'.repeat(
      size - filled
    )
  );
}

function getTotalXPForLevel(
  targetLevel
) {
  const level = normalizeLevel(targetLevel);
  const squareSum = (level - 1) * level * ((2 * level) - 1) / 6;
  const linearSum = level * (level - 1) / 2;
  const xp = (5 * squareSum) + (50 * linearSum) + (100 * level);

  if (!Number.isSafeInteger(xp)) {
    throw new RangeError('The calculated XP exceeds JavaScript safe integer limits.');
  }

  return xp;
}

const MAX_TOTAL_XP = getTotalXPForLevel(MAX_LEVEL);

module.exports = {

  MAX_LEVEL,

  MAX_TOTAL_XP,

  getRequiredXP,

  calculateLevel,

  getProgressXP,

  createProgressBar,

  getTotalXPForLevel
};
