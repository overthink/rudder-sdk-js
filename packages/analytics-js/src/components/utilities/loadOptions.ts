/* eslint-disable sonarjs/deprecation */
import { clone } from 'ramda';
import {
  getNormalizedObjectValue,
  isNonEmptyObject,
  mergeDeepRight,
  removeUndefinedAndNullValues,
} from '@rudderstack/analytics-js-common/utilities/object';
import type {
  LoadOptions,
  UaChTrackLevel,
} from '@rudderstack/analytics-js-common/types/LoadOptions';
import type { StorageOpts, CookieSameSite } from '@rudderstack/analytics-js-common/types/Storage';
import { isString } from '@rudderstack/analytics-js-common/utilities/checks';
import { defaultOptionalPluginsList } from '../pluginsManager/defaultPluginsList';
import { isNumber } from './number';

const normalizeLoadOptions = (
  loadOptionsFromState: LoadOptions,
  loadOptions: Partial<LoadOptions>,
): LoadOptions => {
  // TODO: Maybe add warnings for invalid values
  const normalizedLoadOpts = clone(loadOptions);

  if (!isString(normalizedLoadOpts.setCookieDomain)) {
    normalizedLoadOpts.setCookieDomain = undefined;
  }

  const cookieSameSiteValues = ['Strict', 'Lax', 'None'];
  if (!cookieSameSiteValues.includes(normalizedLoadOpts.sameSiteCookie as CookieSameSite)) {
    normalizedLoadOpts.sameSiteCookie = undefined;
  }

  normalizedLoadOpts.secureCookie = normalizedLoadOpts.secureCookie === true;

  normalizedLoadOpts.sameDomainCookiesOnly = normalizedLoadOpts.sameDomainCookiesOnly === true;

  const uaChTrackLevels = ['none', 'default', 'full'];
  if (!uaChTrackLevels.includes(normalizedLoadOpts.uaChTrackLevel as UaChTrackLevel)) {
    normalizedLoadOpts.uaChTrackLevel = undefined;
  }

  normalizedLoadOpts.integrations = getNormalizedObjectValue(normalizedLoadOpts.integrations);

  normalizedLoadOpts.plugins = normalizedLoadOpts.plugins ?? defaultOptionalPluginsList;

  normalizedLoadOpts.useGlobalIntegrationsConfigInEvents =
    normalizedLoadOpts.useGlobalIntegrationsConfigInEvents === true;

  normalizedLoadOpts.bufferDataPlaneEventsUntilReady =
    normalizedLoadOpts.bufferDataPlaneEventsUntilReady === true;

  normalizedLoadOpts.sendAdblockPage = normalizedLoadOpts.sendAdblockPage === true;

  normalizedLoadOpts.useServerSideCookies = normalizedLoadOpts.useServerSideCookies === true;

  if (!isString(normalizedLoadOpts.dataServiceEndpoint)) {
    normalizedLoadOpts.dataServiceEndpoint = undefined;
  }

  normalizedLoadOpts.sendAdblockPageOptions = getNormalizedObjectValue(
    normalizedLoadOpts.sendAdblockPageOptions,
  );

  normalizedLoadOpts.loadIntegration = normalizedLoadOpts.loadIntegration === true;

  if (!isNonEmptyObject(normalizedLoadOpts.storage)) {
    normalizedLoadOpts.storage = undefined;
  } else {
    normalizedLoadOpts.storage = removeUndefinedAndNullValues(normalizedLoadOpts.storage);
    (normalizedLoadOpts.storage as StorageOpts).migrate =
      normalizedLoadOpts.storage?.migrate === true;

    normalizedLoadOpts.storage.cookie = getNormalizedObjectValue(normalizedLoadOpts.storage.cookie);
  }

  normalizedLoadOpts.destinationsQueueOptions = getNormalizedObjectValue(
    normalizedLoadOpts.destinationsQueueOptions,
  );

  normalizedLoadOpts.queueOptions = getNormalizedObjectValue(normalizedLoadOpts.queueOptions);

  normalizedLoadOpts.lockIntegrationsVersion = normalizedLoadOpts.lockIntegrationsVersion === true;

  normalizedLoadOpts.lockPluginsVersion = normalizedLoadOpts.lockPluginsVersion === true;

  if (!isNumber(normalizedLoadOpts.dataPlaneEventsBufferTimeout)) {
    normalizedLoadOpts.dataPlaneEventsBufferTimeout = undefined;
  }

  normalizedLoadOpts.beaconQueueOptions = getNormalizedObjectValue(
    normalizedLoadOpts.beaconQueueOptions,
  );

  normalizedLoadOpts.preConsent = getNormalizedObjectValue(normalizedLoadOpts.preConsent);

  const mergedLoadOptions: LoadOptions = mergeDeepRight(
    loadOptionsFromState,
    removeUndefinedAndNullValues(normalizedLoadOpts),
  );

  return mergedLoadOptions;
};

export { normalizeLoadOptions };
