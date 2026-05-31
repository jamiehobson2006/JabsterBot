function getRequiredXP(level) {

  return Math.floor(

    5 * Math.pow(level, 2) +

    50 * level +

    100
  );
}

function calculateLevel(totalXP) {

  let level = 0;
  let remainingXP = totalXP;

  while (
    remainingXP >=
    getRequiredXP(level)
  ) {

    remainingXP -=
      getRequiredXP(level);

    level++;
  }

  return level;
}

function getProgressXP(totalXP) {

  let level = 0;
  let remainingXP = totalXP;

  while (
    remainingXP >=
    getRequiredXP(level)
  ) {

    remainingXP -=
      getRequiredXP(level);

    level++;
  }

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

  let xp = 0;

  for (
    let level = 0;
    level < targetLevel;
    level++
  ) {

    xp +=
      getRequiredXP(level);
  }

  return xp;
}

module.exports = {

  getRequiredXP,

  calculateLevel,

  getProgressXP,

  createProgressBar,

  getTotalXPForLevel
};