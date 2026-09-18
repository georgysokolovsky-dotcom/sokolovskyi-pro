export const INTERNAL_PRE_CONVERSION_RULES = Object.freeze([
  'webinar_reminder_15m',
  'webinar_reminder_3h',
  'continue_watching_6h',
  'application_follow_up_2h',
]);

const internalRules = new Set(INTERNAL_PRE_CONVERSION_RULES);

export function stopsAfterApplication(operation) {
  return operation?.messageType === 'warming'
    && (operation.descriptor?.stopAfterApplication === true
      || internalRules.has(operation.descriptor?.ruleName));
}

export function ruleStopsAfterApplication(rule) {
  return rule?.actionConfig?.stopAfterApplication === true || internalRules.has(rule?.name);
}

export function isInternalWebinarRule(rule) {
  return internalRules.has(rule?.name);
}

export function isInternalWebinarWarmingOperation(operation) {
  return operation?.messageType === 'warming' && internalRules.has(operation.descriptor?.ruleName);
}
