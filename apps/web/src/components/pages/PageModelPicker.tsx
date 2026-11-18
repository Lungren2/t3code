import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { pickModelSelection } from "@t3tools/shared/model";
import { resolvePagesModelSelection } from "@t3tools/shared/serverSettings";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";

/** The model Ask AI runs with: the one last picked in a page, else the text generation model. */
export function usePagesModelSelection(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = (useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS).filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const targets = useTextGenerationTargets({
    environmentId,
    settings,
    providers,
    projectId: null,
    selections: [settings.pagesModelSelection, settings.textGenerationModelSelection],
  });
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolvePagesModelSelection(settings, targets.providers),
    },
    targets.providers,
  );
  return { settings, targets, selection };
}

export function PageModelPicker({
  environmentId,
  selection,
}: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection;
}) {
  const { settings, targets } = usePagesModelSelection(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const entries = targets.entries;
  if (!entries.some((entry) => entry.enabled && entry.isAvailable)) {
    return <span className="text-muted-foreground text-xs">No model available</span>;
  }
  return (
    <ProviderModelPicker
      environmentId={environmentId}
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={getTextGenerationModelOptionsByInstance(
        settings,
        targets.providers,
        selection.instanceId,
        selection.model,
      )}
      triggerAriaLabel="Model for Ask AI"
      onInstanceModelChange={(instanceId, model) =>
        updateSettings({ pagesModelSelection: pickModelSelection(selection, instanceId, model) })
      }
    />
  );
}
