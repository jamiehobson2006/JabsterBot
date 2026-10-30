const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const context = new AsyncLocalStorage();

function withConfigurationActor(interaction, work) {
  if(!interaction?.user?.id) return context.run(undefined,work);
  return context.run({ actorId: interaction?.user?.id || null,
    revisionId: interaction?.id || randomUUID() }, work);
}

function registerConfigurationFunctions(db) {
  db.function('configuration_actor', () => context.getStore()?.actorId || null);
  db.function('configuration_revision', () => context.getStore()?.revisionId || randomUUID());
}

module.exports = { registerConfigurationFunctions, withConfigurationActor };
